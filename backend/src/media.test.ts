import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { S3Client } from "@aws-sdk/client-s3";
import { afterEach, expect, it, vi } from "vitest";
import { loadConfig } from "./config.js";
import { logMediaStorage, persistMedia } from "./media.js";

afterEach(() => vi.restoreAllMocks());

it.each([true, false])("traces remote completion=%s and never falls back to local", async (success) => {
  const log = vi.spyOn(console, "info").mockImplementation(() => {});
  const error = Object.assign(new Error("mock failure"), { $metadata: { httpStatusCode: 403 } });
  const send = vi.spyOn(S3Client.prototype, "send").mockImplementation(async (command: any) => {
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
    else await expect(persistMedia(config, "qa.png", staged, "image/png")).rejects.toBe(error);
    expect(send).toHaveBeenCalledOnce();
    expect(fs.existsSync(staged)).toBe(false);
    const records = log.mock.calls.map(call => JSON.parse(String(call[1])));
    expect(records[0]).toMatchObject({ event: "put_object_invoked", adapter: "@aws-sdk/client-s3.S3Client", storageKey: "qa.png", endpointHost: "example.invalid", fallback: "none" });
    expect(records[1].event).toBe(success ? "put_object_completed" : "put_object_failed");
    if (!success) expect(records[1].httpStatusCode).toBe(403);
    expect(records.every(record => !Object.keys(record).some(key => /credential|accessKey|secret|authorization/i.test(key)))).toBe(true);
    expect(JSON.stringify(records)).not.toContain("mock failure");
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

it("identifies local storage without invoking PutObject", async () => {
  const log = vi.spyOn(console, "info").mockImplementation(() => {});
  const send = vi.spyOn(S3Client.prototype, "send");
  const config = loadConfig({ mediaStorageMode: "local" });
  logMediaStorage(config, "startup");
  await persistMedia(config, "qa.png", "unused", "image/png");
  expect(send).not.toHaveBeenCalled();
  expect(JSON.parse(String(log.mock.calls[1]![1]))).toMatchObject({ event: "local_storage_completed", putObjectInvoked: false, adapter: "local filesystem branch", fallback: "none" });
});
