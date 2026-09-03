import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { Request, Response } from "express";
import type { AppConfig } from "./config.js";

// Deliberately whitelist diagnostic fields: never serialize config, requests, or SDK errors.
export function logMediaStorage(config: AppConfig, event: string, storageKey?: string, details: Record<string, string | number | boolean | null> = {}): void {
  let endpointHost = "AWS SDK default";
  if (config.s3Endpoint) {
    try { endpointHost = new URL(config.s3Endpoint).hostname; }
    catch { endpointHost = "invalid endpoint"; }
  }
  console.info("TaskCore media", JSON.stringify({
    event, mediaStorageMode: config.mediaStorageMode, nodeEnv: config.nodeEnv,
    adapter: config.mediaStorageMode === "s3" ? "@aws-sdk/client-s3.S3Client" : "local filesystem branch",
    endpointHost, bucket: config.s3Bucket ?? null, storageKey: storageKey ?? null,
    fallback: "none", ...details
  }));
}

const allowedTypes = new Map([
  ["image/jpeg", ".jpg"], ["image/png", ".png"], ["image/webp", ".webp"], ["image/heic", ".heic"],
  ["video/mp4", ".mp4"], ["video/quicktime", ".mov"], ["video/webm", ".webm"]
]);

export function uploadExtension(mimeType: string): string | undefined {
  return allowedTypes.get(mimeType);
}

export async function receiveUpload(request: Request, destination: string, maximumBytes: number): Promise<number> {
  console.info("TaskCore media", JSON.stringify({ event: "local_write_invoked", fileId: path.basename(destination), route: request.route?.path ?? "unknown" }));
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  let bytes = 0;
  const limiter = new Transform({
    transform(chunk, _encoding, callback) {
      bytes += chunk.length;
      if (bytes > maximumBytes) callback(new Error("UPLOAD_TOO_LARGE"));
      else callback(null, chunk);
    }
  });
  try {
    await pipeline(request, limiter, fs.createWriteStream(destination, { flags: "wx" }));
    if (bytes === 0) throw new Error("UPLOAD_EMPTY");
    console.info("TaskCore media", JSON.stringify({ event: "local_write_completed", fileId: path.basename(destination), bytes }));
    return bytes;
  } catch (error) {
    await fs.promises.rm(destination, { force: true });
    throw error;
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
  logMediaStorage(config, "upload_path_selected", storageKey, { localWritePurpose: config.mediaStorageMode === "s3" ? "temporary staging only" : "local media storage" });
  const root = config.mediaStorageMode === "s3" ? path.join(os.tmpdir(), "taskcore-inspection-uploads") : config.uploadDirectory;
  return safeMediaPath(root, storageKey);
}

export async function persistMedia(config: AppConfig, storageKey: string, stagedPath: string, mimeType: string): Promise<void> {
  if (config.mediaStorageMode === "local") {
    logMediaStorage(config, "local_storage_completed", storageKey, { putObjectInvoked: false });
    return;
  }
  try {
    logMediaStorage(config, "put_object_invoked", storageKey, { putObjectInvoked: true });
    await s3Client(config).send(new PutObjectCommand({ Bucket: config.s3Bucket!, Key: storageKey, Body: fs.createReadStream(stagedPath), ContentType: mimeType }));
    logMediaStorage(config, "put_object_completed", storageKey, { success: true });
  } catch (error) {
    const status = (error as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;
    logMediaStorage(config, "put_object_failed", storageKey, { success: false, httpStatusCode: typeof status === "number" ? status : null, errorPropagated: true });
    throw error;
  } finally {
    await fs.promises.rm(stagedPath, { force: true });
  }
}

export async function deleteMedia(config: AppConfig, storageKey: string): Promise<void> {
  if (config.mediaStorageMode === "s3") {
    await s3Client(config).send(new DeleteObjectCommand({ Bucket: config.s3Bucket!, Key: storageKey }));
    return;
  }
  const file = safeMediaPath(config.uploadDirectory, storageKey);
  if (file) await fs.promises.rm(file, { force: true });
}

export async function sendMedia(config: AppConfig, storageKey: string, mimeType: string, response: Response, range?: string): Promise<void> {
  logMediaStorage(config, "retrieval_path_selected", storageKey);
  response.type(mimeType);
  response.set("Cache-Control", "private, no-store");
  if (config.mediaStorageMode === "local") {
    const file = safeMediaPath(config.uploadDirectory, storageKey);
    if (!file || !fs.existsSync(file)) throw new Error("MEDIA_NOT_FOUND");
    response.sendFile(file);
    return;
  }
  const object = await s3Client(config).send(new GetObjectCommand({ Bucket: config.s3Bucket!, Key: storageKey, Range: range }));
  if (!object.Body) throw new Error("MEDIA_NOT_FOUND");
  response.set("Accept-Ranges", "bytes");
  if (object.ContentLength !== undefined) response.set("Content-Length", String(object.ContentLength));
  if (object.ContentRange) {
    response.status(206);
    response.set("Content-Range", object.ContentRange);
  }
  const stream = object.Body as NodeJS.ReadableStream;
  stream.on("error", () => { if (!response.headersSent) response.status(404).end(); else response.destroy(); });
  stream.pipe(response);
}
