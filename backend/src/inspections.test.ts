import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Kysely, PostgresDialect } from "kysely";
import { newDb } from "pg-mem";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { initializeDatabase } from "./database.js";
import type { TaskCoreDatabase } from "./types.js";

const temporaryDirectories: string[] = [];

async function portalApp() {
  const memoryPostgres = newDb({ noAstCoverageCheck: true });
  const adapter = memoryPostgres.adapters.createPg();
  const db = new Kysely<TaskCoreDatabase>({ dialect: new PostgresDialect({ pool: new adapter.Pool() }) });
  await initializeDatabase(db);
  const uploadDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "taskcore-inspection-test-"));
  temporaryDirectories.push(uploadDirectory);
  const config = loadConfig({
    nodeEnv: "test", databaseUrl: "postgresql://test", adminUsername: "jay", adminPassword: "test-password-long-enough",
    corsOrigins: ["http://localhost:8000"], publicBaseUrl: "https://reports.taskcore.test", uploadDirectory, mediaStorageMode: "local"
  });
  return { app: createApp(config, db), db, auth: "Basic " + Buffer.from("jay:test-password-long-enough").toString("base64") };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

describe("inspection portal", () => {
  it("keeps technician findings internal until owner review and supports client decisions", async () => {
    const { app, db, auth } = await portalApp();
    try {
      const client = await request(app).post("/api/admin/clients").set("Authorization", auth).send({ companyName: "Desert Stays", contactName: "Morgan", email: "morgan@example.com", phone: "7605550199" }).expect(201);
      const property = await request(app).post("/api/admin/properties").set("Authorization", auth).send({ clientId: client.body.id, name: "Cactus House", address: "100 Palm Way, Indio, CA" }).expect(201);
      await request(app).post("/api/admin/technicians").set("Authorization", auth).send({ name: "Alex Tech", email: "alex@example.com", password: "temporary-pass-123" }).expect(201);

      const login = await request(app).post("/api/tech/login").send({ email: "alex@example.com", password: "temporary-pass-123" }).expect(200);
      const rawCookie = login.headers["set-cookie"];
      const cookie = (Array.isArray(rawCookie) ? rawCookie[0] : rawCookie)?.split(";")[0];
      expect(cookie).toBeTruthy();
      const sessionCookie = cookie!;
      const created = await request(app).post("/api/tech/inspections").set("Cookie", sessionCookie).send({ propertyId: property.body.id, inspectionType: "Arrival" }).expect(201);
      const inspectionId = created.body.id;
      await request(app).put(`/api/tech/inspections/${inspectionId}`).set("Cookie", sessionCookie).send({
        summary: "Property is ready except for a loose bathroom faucet.",
        checklist: [{ key: "bathroom", section: "Bathrooms", label: "Bathroom fixtures", answer: "Issue", note: "Faucet is loose." }],
        findings: [{ title: "Secure bathroom faucet", details: "Faucet body moves at the vanity.", priority: "Routine" }]
      }).expect(200);
      for (const category of ["entry", "thermostat", "kitchen", "bathroom"]) {
        await request(app).post(`/api/tech/inspections/${inspectionId}/media?category=${category}`).set("Cookie", sessionCookie).set("Content-Type", "image/jpeg").set("X-File-Name", `${category}.jpg`).send(Buffer.from("fake-image")).expect(201);
      }
      await request(app).post(`/api/tech/inspections/${inspectionId}/media?category=walkthrough`).set("Cookie", sessionCookie).set("Content-Type", "video/mp4").set("X-File-Name", "walkthrough.mp4").send(Buffer.from("fake-video")).expect(201);
      await request(app).post(`/api/tech/inspections/${inspectionId}/submit`).set("Cookie", sessionCookie).expect(200);

      const queue = await request(app).get("/api/admin/inspections").set("Authorization", auth).expect(200);
      expect(queue.body.unreadNotifications).toBe(1);
      expect(queue.body.inspections[0].status).toBe("Submitted");
      const detail = await request(app).get(`/api/admin/inspections/${inspectionId}`).set("Authorization", auth).expect(200);
      const findingId = detail.body.inspection.findings[0].id;
      await request(app).patch(`/api/admin/inspections/${inspectionId}/review`).set("Authorization", auth).send({
        status: "Ready", reviewNote: "", findings: [{ id: findingId, title: "Secure bathroom faucet", details: "Faucet body moves at the vanity.", priority: "Routine", requiresApproval: true, quoteDescription: "Tighten and test faucet mounting hardware", quoteAmount: 75 }]
      }).expect(200);
      const published = await request(app).post(`/api/admin/inspections/${inspectionId}/publish`).set("Authorization", auth).expect(200);
      const token = new URL(published.body.reportUrl).pathname.split("/").pop()!;
      await request(app).get(`/report/${token}`).expect(200).expect(/Approve repair/);
      await request(app).post(`/api/reports/${token}/findings/${findingId}/decision`).send({ decision: "Approved", comment: "Please schedule this week." }).expect(200);
      const finding = await db.selectFrom("inspection_findings").selectAll().where("id", "=", findingId).executeTakeFirstOrThrow();
      expect(finding).toMatchObject({ decision: "Approved", quote_amount_cents: 7500, client_comment: "Please schedule this week." });
      const decisionHistory = await db.selectFrom("inspection_decision_events").selectAll().where("finding_id", "=", findingId).execute();
      expect(decisionHistory).toHaveLength(1);
      expect(decisionHistory[0]).toMatchObject({ decision: "Approved", client_comment: "Please schedule this week." });
    } finally {
      await db.destroy();
    }
  });
});
