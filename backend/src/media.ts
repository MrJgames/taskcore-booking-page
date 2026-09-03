import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { Request, Response } from "express";
import type { AppConfig } from "./config.js";

type MediaEvent = "startup" | "upload_completed" | "upload_failed" | "retrieval_failed" | "delete_failed" | "staging_cleanup_failed";

// Fixed fields only. Correlate objects without recording keys, URLs, paths or SDK errors.
export function logMediaStorage(config: AppConfig, event: MediaEvent, storageKey?: string, httpStatusCode?: number): void {
  const record = JSON.stringify({ event, provider: config.mediaStorageMode,
    ...(storageKey ? { objectRef: createHash("sha256").update(storageKey).digest("hex").slice(0, 16) } : {}),
    ...(Number.isInteger(httpStatusCode) && httpStatusCode! >= 100 && httpStatusCode! <= 599 ? { httpStatusCode } : {}) });
  if (event.endsWith("failed")) console.error("TaskCore media", record);
  else console.info("TaskCore media", record);
}

function storageFailure(config: AppConfig, event: MediaEvent, storageKey: string, error: unknown): Error {
  const status = (error as { $metadata?: { httpStatusCode?: number } } | null)?.$metadata?.httpStatusCode;
  logMediaStorage(config, event, storageKey, status);
  // The global API error handler logs thrown errors: never forward raw SDK errors to it.
  return new Error("MEDIA_STORAGE_FAILED");
}

const allowedTypes = new Map([
  ["image/jpeg", ".jpg"], ["image/png", ".png"], ["image/webp", ".webp"], ["image/heic", ".heic"],
  ["video/mp4", ".mp4"], ["video/quicktime", ".mov"], ["video/webm", ".webm"]
]);

export function uploadExtension(mimeType: string): string | undefined {
  return allowedTypes.get(mimeType);
}

export async function receiveUpload(request: Request, destination: string, maximumBytes: number): Promise<number> {
  let bytes = 0;
  const limiter = new Transform({
    transform(chunk, _encoding, callback) {
      bytes += chunk.length;
      if (bytes > maximumBytes) callback(new Error("UPLOAD_TOO_LARGE"));
      else callback(null, chunk);
    }
  });
  try {
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    await pipeline(request, limiter, fs.createWriteStream(destination, { flags: "wx" }));
    if (bytes === 0) throw new Error("UPLOAD_EMPTY");
    return bytes;
  } catch (error) {
    try { await fs.promises.rm(destination, { force: true }); }
    catch { console.error("TaskCore media", JSON.stringify({ event: "staging_cleanup_failed" })); }
    if (error instanceof Error && ["UPLOAD_TOO_LARGE", "UPLOAD_EMPTY"].includes(error.message)) throw error;
    console.error("TaskCore media", JSON.stringify({ event: "staging_write_failed" }));
    throw new Error("MEDIA_STORAGE_FAILED");
  }
}

export function safeMediaPath(uploadDirectory: string, storageKey: string): string | undefined {
  const target = path.resolve(uploadDirectory, storageKey);
  return target.startsWith(`${path.resolve(uploadDirectory)}${path.sep}`) ? target : undefined;
}

function s3Client(config: AppConfig): S3Client {
  return new S3Client({
    region: config.s3Region,
    endpoint: config.s3Endpoint,
    forcePathStyle: config.s3ForcePathStyle,
    credentials: { accessKeyId: config.s3AccessKeyId!, secretAccessKey: config.s3SecretAccessKey! }
  });
}

export function stagedMediaPath(config: AppConfig, storageKey: string): string | undefined {
  const root = config.mediaStorageMode === "s3" ? path.join(os.tmpdir(), "taskcore-inspection-uploads") : config.uploadDirectory;
  return safeMediaPath(root, storageKey);
}

export async function persistMedia(config: AppConfig, storageKey: string, stagedPath: string, mimeType: string): Promise<void> {
  if (config.mediaStorageMode === "local") {
    return;
  }
  try {
    await s3Client(config).send(new PutObjectCommand({ Bucket: config.s3Bucket!, Key: storageKey, Body: fs.createReadStream(stagedPath), ContentType: mimeType }));
    logMediaStorage(config, "upload_completed", storageKey);
  } catch (error) {
    throw storageFailure(config, "upload_failed", storageKey, error);
  } finally {
    try { await fs.promises.rm(stagedPath, { force: true }); }
    catch (error) { throw storageFailure(config, "staging_cleanup_failed", storageKey, error); }
  }
}

export async function deleteMedia(config: AppConfig, storageKey: string): Promise<void> {
  if (config.mediaStorageMode === "s3") {
    try { await s3Client(config).send(new DeleteObjectCommand({ Bucket: config.s3Bucket!, Key: storageKey })); }
    catch (error) { throw storageFailure(config, "delete_failed", storageKey, error); }
    return;
  }
  const file = safeMediaPath(config.uploadDirectory, storageKey);
  if (file) await fs.promises.rm(file, { force: true });
}

export async function sendMedia(config: AppConfig, storageKey: string, mimeType: string, response: Response, range?: string): Promise<void> {
  response.type(mimeType);
  response.set("Cache-Control", "private, no-store");
  if (config.mediaStorageMode === "local") {
    const file = safeMediaPath(config.uploadDirectory, storageKey);
    if (!file || !fs.existsSync(file)) throw new Error("MEDIA_NOT_FOUND");
    response.sendFile(file);
    return;
  }
  const object = await s3Client(config).send(new GetObjectCommand({ Bucket: config.s3Bucket!, Key: storageKey, Range: range }))
    .catch((error: unknown) => { throw storageFailure(config, "retrieval_failed", storageKey, error); });
  if (!object.Body) throw storageFailure(config, "retrieval_failed", storageKey, null);
  response.set("Accept-Ranges", "bytes");
  if (object.ContentLength !== undefined) response.set("Content-Length", String(object.ContentLength));
  if (object.ContentRange) {
    response.status(206);
    response.set("Content-Range", object.ContentRange);
  }
  const stream = object.Body as NodeJS.ReadableStream;
  stream.on("error", () => { logMediaStorage(config, "retrieval_failed", storageKey); if (!response.headersSent) response.status(404).end(); else response.destroy(); });
  stream.pipe(response);
}
