import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { Readable } from "node:stream";
import express from "express";
import request from "supertest";
import { afterEach, expect, it, vi } from "vitest";
import { loadConfig } from "./config.js";
import { logMediaStorage, persistMedia, sendMedia, stagedMediaPath } from "./media.js";

afterEach(() => vi.restoreAllMocks());

it.each([true, false])("traces remote completion=%s and never falls back to local", async (success) => {
  const log = vi.spyOn(console, "info").mockImplementation(() => {});
  const failureLog = vi.spyOn(console, "error").mockImplementation(() => {});
  const error = Object.assign(new Error("mock failure"), { $metadata: { httpStatusCode: 403 } });
  const send = vi.spyOn(S3Client.prototype, "send").mockImplementation(async (command: any) => {
    expect(command).toBeInstanceOf(PutObjectCommand);
    expect(command.input.Bucket).toBe("test-only-bucket");
    expect(command.input.Key).toBe("qa.png");
    for await (const _ of command.input.Body) { /* drain the staged stream */ }
    if (!success) throw error;
    return {};
  });
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "taskcore-media-test-"));
  const staged = path.join(root, "qa.png");
  fs.writeFileSync(staged, "qa");
  const config = loadConfig({ mediaStorageMode: "s3", s3Endpoint: "https://example.invalid", s3Bucket: "test-only-bucket" });
  try {
    if (success) await persistMedia(config, "qa.png", staged, "image/png");
    else await expect(persistMedia(config, "qa.png", staged, "image/png")).rejects.toThrow("MEDIA_STORAGE_FAILED");
    expect(send).toHaveBeenCalledOnce();
    expect(fs.existsSync(staged)).toBe(false);
    const records = [...log.mock.calls, ...failureLog.mock.calls].map(call => JSON.parse(String(call[1])));
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ event: success ? "upload_completed" : "upload_failed", provider: "s3" });
    if (!success) expect(records[0].httpStatusCode).toBe(403);
    expect(records.every(record => !Object.keys(record).some(key => /credential|accessKey|secret|authorization/i.test(key)))).toBe(true);
    expect(JSON.stringify(records)).not.toContain("mock failure");
    expect(JSON.stringify(records)).not.toContain("qa.png");
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

it("identifies local storage without invoking PutObject", async () => {
  const log = vi.spyOn(console, "info").mockImplementation(() => {});
  const send = vi.spyOn(S3Client.prototype, "send");
  const config = loadConfig({ mediaStorageMode: "local" });
  logMediaStorage(config, "startup");
  await persistMedia(config, "qa.png", "unused", "image/png");
  expect(send).not.toHaveBeenCalled();
  expect(log).toHaveBeenCalledOnce();
  expect(JSON.parse(String(log.mock.calls[0]![1]))).toEqual({ event: "startup", provider: "local" });
});

it.each([true, false])("uses remote retrieval (success=%s), never a local copy", async (success) => {
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "taskcore-media-read-"));
  fs.writeFileSync(path.join(root, "qa.png"), "local-copy-must-not-be-used");
  const config = loadConfig({ mediaStorageMode: "s3", s3Bucket: "test-only-bucket", uploadDirectory: root });
  const send = vi.spyOn(S3Client.prototype, "send").mockImplementation(async (command: any) => {
    expect(command).toBeInstanceOf(GetObjectCommand);
    expect(command.input).toMatchObject({ Bucket: "test-only-bucket", Key: "qa.png", Range: "bytes=0-5" });
    if (!success) throw Object.assign(new Error("mock remote detail must not escape"), { $metadata: { httpStatusCode: 404 } });
    return { Body: Readable.from(["remote"]), ContentLength: 6, ContentRange: "bytes 0-5/6" };
  });
  const app = express();
  app.get("/media", (req, res, next) => { sendMedia(config, "qa.png", "text/plain", res, req.get("range")).catch(next); });
  app.use((error: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => { res.status(500).send(error.message); });
  try {
    const result = await request(app).get("/media").set("Range", "bytes=0-5").expect(success ? 206 : 500);
    expect(result.text).toBe(success ? "remote" : "MEDIA_STORAGE_FAILED");
    expect(send).toHaveBeenCalledOnce();
    if (success) expect(log).not.toHaveBeenCalled();
    else {
      expect(JSON.parse(String(log.mock.calls[0]![1]))).toMatchObject({ event: "retrieval_failed", provider: "s3", httpStatusCode: 404 });
      expect(JSON.stringify(log.mock.calls)).not.toContain("mock remote detail");
    }
    expect(stagedMediaPath(config, "qa.png")).not.toBe(path.join(root, "qa.png"));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
