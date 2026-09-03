import fs from "node:fs";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { Kysely, PostgresDialect } from "kysely";
import { newDb } from "pg-mem";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import type { AppConfig } from "./config.js";
import { initializeDatabase } from "./database.js";
import type { TaskCoreDatabase } from "./types.js";
import { checklistTemplate } from "./inspectionTemplates.js";

const temporaryDirectories: string[] = [];

async function portalApp(overrides: Partial<AppConfig> = {}) {
  const memoryPostgres = newDb({ noAstCoverageCheck: true });
  const adapter = memoryPostgres.adapters.createPg();
  const db = new Kysely<TaskCoreDatabase>({ dialect: new PostgresDialect({ pool: new adapter.Pool() }) });
  await initializeDatabase(db);
  const uploadDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "taskcore-inspection-test-"));
  temporaryDirectories.push(uploadDirectory);
  const config = loadConfig({
    nodeEnv: "test", databaseUrl: "postgresql://test", adminUsername: "jay", adminPassword: "test-password-long-enough",
    corsOrigins: ["http://localhost:8000"], publicBaseUrl: "https://reports.taskcore.test", uploadDirectory, mediaStorageMode: "local", ...overrides
  });
  return { app: createApp(config, db), db, auth: "Basic " + Buffer.from("jay:test-password-long-enough").toString("base64") };
}

afterEach(() => {
  vi.useRealTimers();
  for (const directory of temporaryDirectories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

describe("inspection portal", () => {
  it("serves normal session timers without public QA test controls", async () => {
    const { app, db } = await portalApp();
    try {
      const script = await request(app).get("/tech/session.js?sessionTest=1").expect(200);
      expect(script.text).not.toMatch(/TaskCoreSessionTest|sessionTest|accelerated/);
      expect(script.text).toContain("INACTIVE_MS=45*60*1000,WARNING_MS=5*60*1000");
      expect(script.text).toContain("function preserve()");
      expect(script.text).toContain("function restore()");
      expect(script.text).toContain("../api/tech/session/renew");
    } finally { await db.destroy(); }
  });
  for (const mode of ["owner", "technician"] as const) it(`rejects ${mode} cross-inspection finding/history writes atomically`, async () => {
    const { app, db, auth } = await portalApp();
    try {
      const contexts: Array<{ inspectionId: string; findingId: string; cookie: string }> = [];
      for (const suffix of ["a", "b"]) {
        const client = await request(app).post("/api/admin/clients").set("Authorization", auth).send({ companyName: `Client ${suffix}`, contactName: "QA", email: `${suffix}@example.test`, phone: "7605550199" }).expect(201);
        const property = await request(app).post("/api/admin/properties").set("Authorization", auth).send({ clientId: client.body.id, name: `Property ${suffix}`, address: `100 ${suffix} Street, Indio, CA` }).expect(201);
        const credentials = { email: `tech-${suffix}@example.test`, password: "temporary-pass-123" };
        await request(app).post("/api/admin/technicians").set("Authorization", auth).send({ name: `Tech ${suffix}`, ...credentials }).expect(201);
        const login = await request(app).post("/api/tech/login").send(credentials).expect(200);
        const cookie = login.headers["set-cookie"]![0]!.split(";")[0]!;
        const created = await request(app).post("/api/tech/inspections").set("Cookie", cookie).send({ propertyId: property.body.id, inspectionType: "Maintenance Documentation" }).expect(201);
        const saved = await request(app).put(`/api/tech/inspections/${created.body.id}`).set("Cookie", cookie).send({ checklist: [], findings: [{ category: "Plumbing", title: "Original finding", details: "Original details", priority: "Routine" }] }).expect(200);
        contexts.push({ inspectionId: created.body.id, findingId: saved.body.inspection.findings[0].id, cookie });
      }
      const [a, b] = contexts as [typeof contexts[number], typeof contexts[number]];
      if (mode === "owner") await db.updateTable("inspections").set({ status: "Submitted" }).execute();
      const snapshot = async () => ({
        inspections: await db.selectFrom("inspections").selectAll().orderBy("id").execute(),
        findings: await db.selectFrom("inspection_findings").selectAll().orderBy("id").execute(),
        details: await db.selectFrom("maintenance_finding_details").selectAll().orderBy("finding_id").execute(),
        history: await db.selectFrom("maintenance_finding_events").selectAll().orderBy("id").execute(),
        decisions: await db.selectFrom("inspection_decision_events").selectAll().orderBy("id").execute()
      });
      const before = await snapshot();
      const item = (id: string) => ({ id, category: "Plumbing", title: "Changed finding", details: "Changed details", priority: "Routine", requiresApproval: true, quoteDescription: "Repair", quoteAmount: 25 });
      // Valid first item proves the entire batch is rejected before any write.
      for (const badId of [b.findingId, randomUUID(), before.history[0]!.id, a.findingId]) {
        const response = mode === "owner"
          ? await request(app).patch(`/api/admin/inspections/${a.inspectionId}/review`).set("Authorization", auth).send({ status: "Ready", findings: [item(a.findingId), item(badId)] })
          : await request(app).put(`/api/tech/inspections/${a.inspectionId}`).set("Cookie", a.cookie).send({ checklist: [], findings: [item(a.findingId), item(badId)] });
        expect(response.status).toBe(400);
        expect(response.body).toEqual({ error: "Invalid inspection finding reference." });
        expect(await snapshot()).toEqual(before);
      }
      const missingInspection = mode === "owner"
        ? await request(app).patch(`/api/admin/inspections/${randomUUID()}/review`).set("Authorization", auth).send({ status: "Ready", findings: [item(a.findingId)] })
        : await request(app).put(`/api/tech/inspections/${b.inspectionId}`).set("Cookie", a.cookie).send({ checklist: [], findings: [item(b.findingId)] });
      expect(missingInspection.status).toBe(409);
      expect(await snapshot()).toEqual(before);
      if (mode === "owner") {
        const password = "role-test-password-123";
        await request(app).post("/api/admin/operations/organizations").set("Authorization", auth).send({ name: "Role QA", contactName: "QA", email: "org@example.test", managerName: "QA Manager", managerEmail: "manager@example.test", managerPassword: password }).expect(201);
        await request(app).post("/api/admin/operations/vendors").set("Authorization", auth).send({ businessName: "QA Vendor", contactName: "QA", email: "vendor@example.test", password }).expect(201);
        const manager = await request(app).post("/api/manager/login").send({ email: "manager@example.test", password }).expect(200);
        const contractor = await request(app).post("/api/contractor/login").send({ email: "vendor@example.test", password }).expect(200);
        for (const cookie of [a.cookie, manager.headers["set-cookie"]![0]!.split(";")[0]!, contractor.headers["set-cookie"]![0]!.split(";")[0]!, ""]) {
          const denied = await request(app).patch(`/api/admin/inspections/${a.inspectionId}/review`).set("Cookie", cookie).send({ status: "Ready", findings: [item(a.findingId)] }).expect(401);
          expect(denied.body).toEqual({ error: "Administrator authentication is required." });
          expect(await snapshot()).toEqual(before);
        }
        // History IDs are never accepted as writable resource targets.
        await request(app).patch(`/api/admin/inspections/${a.inspectionId}/history/${before.history[0]!.id}`).set("Authorization", auth).send({ action: "tamper" }).expect(404);
        expect(await snapshot()).toEqual(before);
      }
      if (mode === "technician") {
        await request(app).post(`/api/tech/inspections/${a.inspectionId}/media?findingId=${b.findingId}`).set("Cookie", a.cookie).set("Content-Type", "image/png").send(Buffer.from("test")).expect(400);
        expect(await db.selectFrom("inspection_media").selectAll().execute()).toHaveLength(0);
        const linked = await request(app).put(`/api/tech/inspections/${a.inspectionId}`).set("Cookie", a.cookie).send({ checklist: [{ key: "qa", section: "QA", label: "QA", answer: "Pass", findingId: b.findingId }], findings: [item(a.findingId)] }).expect(400);
        expect(linked.body.error).toBe("Invalid inspection finding reference.");
        expect(await snapshot()).toEqual(before);
      }
      const valid = mode === "owner"
        ? await request(app).patch(`/api/admin/inspections/${a.inspectionId}/review`).set("Authorization", auth).send({ status: "Ready", findings: [item(a.findingId)] })
        : await request(app).put(`/api/tech/inspections/${a.inspectionId}`).set("Cookie", a.cookie).send({ checklist: [], findings: [item(a.findingId)] });
      expect(valid.status).toBe(200);
      expect(await db.selectFrom("maintenance_finding_events").selectAll().where("finding_id", "=", a.findingId).execute()).toHaveLength(2);
      expect(await db.selectFrom("maintenance_finding_events").selectAll().where("finding_id", "=", b.findingId).execute()).toHaveLength(1);
      expect((await db.selectFrom("inspection_findings").selectAll().where("id", "=", b.findingId).executeTakeFirstOrThrow()).title).toBe("Original finding");
      if (mode === "owner") {
        const published = await request(app).post(`/api/admin/inspections/${a.inspectionId}/publish`).set("Authorization", auth).expect(200);
        const token = new URL(published.body.reportUrl).pathname.split("/").pop()!;
        const priorDecision = await snapshot();
        for (const wrong of [b.findingId, randomUUID(), before.history[0]!.id]) {
          const rejected = await request(app).post(`/api/reports/${token}/findings/${wrong}/decision`).send({ decision: "Approved" }).expect(404);
          expect(rejected.body).toEqual({ error: "Repair item not found." });
          expect(await snapshot()).toEqual(priorDecision);
        }
        await request(app).post(`/api/reports/${token}/findings/${a.findingId}/decision`).send({ decision: "Approved" }).expect(200);
        expect(await db.selectFrom("inspection_decision_events").selectAll().where("finding_id", "=", a.findingId).execute()).toHaveLength(1);
        expect(await db.selectFrom("inspection_decision_events").selectAll().where("finding_id", "=", b.findingId).execute()).toHaveLength(0);
      }
    } finally { await db.destroy(); }
  });
  it("sets secure production cookies on login and renewal and rejects revoked sessions", async () => {
    const { app, db, auth } = await portalApp({ nodeEnv: "production", trustProxy: 1 });
    try {
      const credentials = { email: "secure-qa@example.test", password: "temporary-pass-123" };
      await request(app).post("/api/admin/technicians").set("Authorization", auth).send({ name: "Secure QA", ...credentials }).expect(201);
      await request(app).get("/admin/").expect(401);
      await request(app).get("/admin/").set("Authorization", auth).expect(200);
      const login = await request(app).post("/api/tech/login").send(credentials).expect(200);
      const cookies = login.headers["set-cookie"] as unknown as string[];
      expect(cookies[0]).toMatch(/; Secure/);
      expect(cookies[0]).toMatch(/; HttpOnly/);
      expect(cookies[0]).toMatch(/; SameSite=Strict/);
      const cookie = cookies[0]!.split(";")[0]!;
      const renewed = await request(app).post("/api/tech/session/renew").set("Cookie", cookie).send({}).expect(200);
      expect(renewed.headers["set-cookie"]?.[0]).toMatch(/; Secure/);
      await request(app).post("/api/tech/logout").set("Cookie", cookie).expect(204);
      await request(app).get("/api/tech/session").set("Cookie", cookie).expect(401);
    } finally { await db.destroy(); }
  });
  it("slides active technician sessions, records renewal, and enforces the absolute limit", async () => {
    const { app, db, auth } = await portalApp({ technicianIdleSessionMs: 10 * 60 * 1000, technicianAbsoluteSessionMs: 60 * 60 * 1000 });
    try {
      await request(app).post("/api/admin/technicians").set("Authorization", auth).send({ name: "Shift Tech", email: "shift@example.com", password: "temporary-pass-123" }).expect(201);
      const login = await request(app).post("/api/tech/login").send({ email: "shift@example.com", password: "temporary-pass-123" }).expect(200);
      const rawCookie = login.headers["set-cookie"]; const cookie = (Array.isArray(rawCookie) ? rawCookie[0] : rawCookie)!.split(";")[0];
      const before = await db.selectFrom("technician_sessions").selectAll().executeTakeFirstOrThrow();
      await request(app).get("/api/tech/session").set("Cookie", cookie).expect(200);
      let session = await db.selectFrom("technician_sessions").selectAll().executeTakeFirstOrThrow();
      expect(new Date(session.expires_at).getTime()).toBeGreaterThanOrEqual(new Date(before.expires_at).getTime());
      await request(app).post("/api/tech/session/renew").set("Cookie", cookie).send({ inspectionId: null }).expect(200);
      expect((await db.selectFrom("technician_activity_events").select("event_type").execute()).map((event) => event.event_type)).toContain("Session renewed");
      await db.updateTable("technician_sessions").set({ created_at: new Date(Date.now() - 61 * 60 * 1000).toISOString(), expires_at: new Date(Date.now() + 60_000).toISOString() }).execute();
      await request(app).get("/api/tech/session").set("Cookie", cookie).expect(401);
    } finally { await db.destroy(); }
  });
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
        checklist: checklistTemplate("Arrival").map((item) => ({ ...item, answer: item.key === "arrival-bathrooms" ? "Issue Found" : "Pass", note: item.key === "arrival-bathrooms" ? "Faucet is loose." : "" })),
        findings: [{ category: "Plumbing", title: "Secure bathroom faucet", details: "Faucet body moves at the vanity.", priority: "Routine" }]
      }).expect(200);
      for (const item of checklistTemplate("Arrival")) {
        await request(app).post(`/api/tech/inspections/${inspectionId}/media?category=question&questionKey=${item.key}`).set("Cookie", sessionCookie).set("Content-Type", "image/jpeg").set("X-File-Name", `${item.key}.jpg`).send(Buffer.from("fake-image")).expect(201);
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

  it("rejects incomplete checklist answers, missing question photos, and Issue Found answers without explanations", async () => {
    const { app, db, auth } = await portalApp();
    try {
      const client = await request(app).post("/api/admin/clients").set("Authorization", auth).send({ companyName: "Validation PM", contactName: "Owner", email: "owner@example.com" }).expect(201);
      const property = await request(app).post("/api/admin/properties").set("Authorization", auth).send({ clientId: client.body.id, name: "Validation House", address: "1 Test Way, Indio, CA" }).expect(201);
      await request(app).post("/api/admin/technicians").set("Authorization", auth).send({ name: "Field Tech", email: "field@example.com", password: "temporary-pass-123" }).expect(201);
      const login = await request(app).post("/api/tech/login").send({ email: "field@example.com", password: "temporary-pass-123" }).expect(200);
      const rawCookie = login.headers["set-cookie"]; const cookie = (Array.isArray(rawCookie) ? rawCookie[0] : rawCookie)!.split(";")[0];
      const created = await request(app).post("/api/tech/inspections").set("Cookie", cookie).send({ propertyId: property.body.id, inspectionType: "Departure" }).expect(201);
      const items = checklistTemplate("Departure");
      await request(app).put(`/api/tech/inspections/${created.body.id}`).set("Cookie", cookie).send({ summary: "", checklist: items.slice(1).map((item) => ({ ...item, answer: "Pass", note: "" })), findings: [] }).expect(200);
      await request(app).post(`/api/tech/inspections/${created.body.id}/submit`).set("Cookie", cookie).expect(400).expect(/Complete every applicable/);
      await request(app).put(`/api/tech/inspections/${created.body.id}`).set("Cookie", cookie).send({ summary: "", checklist: items.map((item, index) => ({ ...item, answer: index ? "Pass" : "Issue Found", note: "" })), findings: [] }).expect(200);
      await request(app).post(`/api/tech/inspections/${created.body.id}/submit`).set("Cookie", cookie).expect(400).expect(/written explanation/);
      await request(app).put(`/api/tech/inspections/${created.body.id}`).set("Cookie", cookie).send({ summary: "", checklist: items.map((item) => ({ ...item, answer: "Pass", note: "" })), findings: [] }).expect(200);
      await request(app).post(`/api/tech/inspections/${created.body.id}/submit`).set("Cookie", cookie).expect(400).expect(/Attach at least one photo/);
    } finally { await db.destroy(); }
  });

  it("requires complete maintenance findings and a photo linked to every finding", async () => {
    const { app, db, auth } = await portalApp();
    try {
      const client = await request(app).post("/api/admin/clients").set("Authorization", auth).send({ companyName: "Maintenance PM", contactName: "Owner", email: "owner2@example.com" }).expect(201);
      const property = await request(app).post("/api/admin/properties").set("Authorization", auth).send({ clientId: client.body.id, name: "Maintenance House", address: "2 Test Way, Indio, CA" }).expect(201);
      await request(app).post("/api/admin/technicians").set("Authorization", auth).send({ name: "Field Tech", email: "field2@example.com", password: "temporary-pass-123" }).expect(201);
      const login = await request(app).post("/api/tech/login").send({ email: "field2@example.com", password: "temporary-pass-123" }).expect(200); const rawCookie = login.headers["set-cookie"]; const cookie = (Array.isArray(rawCookie) ? rawCookie[0] : rawCookie)!.split(";")[0];
      const created = await request(app).post("/api/tech/inspections").set("Cookie", cookie).send({ propertyId: property.body.id, inspectionType: "Maintenance Documentation" }).expect(201);
      const saved = await request(app).put(`/api/tech/inspections/${created.body.id}`).set("Cookie", cookie).send({ summary: "", checklist: [], findings: [{ category: "HVAC", title: "Filter restricted", details: "Filter is visibly loaded.", priority: "Routine", recommendedNextSteps: "Replace filter" }] }).expect(200);
      const findingId = saved.body.inspection.findings[0].id;
      await request(app).post(`/api/tech/inspections/${created.body.id}/submit`).set("Cookie", cookie).expect(400).expect(/at least one photo/);
      await request(app).post(`/api/tech/inspections/${created.body.id}/media?category=finding&findingId=${findingId}`).set("Cookie", cookie).set("Content-Type", "image/jpeg").send(Buffer.from("photo")).expect(201);
      await request(app).post(`/api/tech/inspections/${created.body.id}/submit`).set("Cookie", cookie).expect(200);
      expect(await db.selectFrom("maintenance_finding_events").selectAll().where("finding_id", "=", findingId).execute()).toHaveLength(1);
    } finally { await db.destroy(); }
  });

  it("lets a technician add a validated property for an existing client and immediately starts an inspection", async () => {
    const { app, db, auth } = await portalApp();
    try {
      const client = await request(app).post("/api/admin/clients").set("Authorization", auth).send({ companyName: "Desert Stays", contactName: "Morgan", email: "morgan@example.com", phone: "7605550199" }).expect(201);
      await request(app).post("/api/admin/technicians").set("Authorization", auth).send({ name: "Alex Tech", email: "alex@example.com", password: "temporary-pass-123" }).expect(201);
      const login = await request(app).post("/api/tech/login").send({ email: "alex@example.com", password: "temporary-pass-123" }).expect(200);
      const rawCookie = login.headers["set-cookie"];
      const sessionCookie = (Array.isArray(rawCookie) ? rawCookie[0] : rawCookie)!.split(";")[0];

      const clientList = await request(app).get("/api/tech/clients").set("Cookie", sessionCookie).expect(200);
      expect(clientList.body.clients).toEqual([{ id: client.body.id, company_name: "Desert Stays" }]);
      expect(clientList.text).not.toMatch(/email|phone|billing|contact_name/i);

      const created = await request(app).post("/api/tech/properties").set("Cookie", sessionCookie).send({
        clientId: client.body.id, name: "Canyon House", streetAddress: "123 Main Street", city: "Palm Desert", state: "ca", postalCode: "92260", inspectionType: "Arrival"
      }).expect(201);
      expect(created.body).toMatchObject({ propertyId: expect.any(String), inspectionId: expect.any(String) });

      const property = await db.selectFrom("properties").selectAll().where("id", "=", created.body.propertyId).executeTakeFirstOrThrow();
      expect(property).toMatchObject({ client_id: client.body.id, name: "Canyon House", address: "123 Main Street, Palm Desert, CA 92260", active: 1 });
      const inspection = await db.selectFrom("inspections").selectAll().where("id", "=", created.body.inspectionId).executeTakeFirstOrThrow();
      expect(inspection).toMatchObject({ property_id: property.id, status: "Draft", inspection_type: "Arrival" });
      const audit = await db.selectFrom("property_audit_events").selectAll().where("property_id", "=", property.id).executeTakeFirstOrThrow();
      expect(audit).toMatchObject({ actor_type: "Technician", action: "Created" });
      const notification = await db.selectFrom("property_notifications").selectAll().where("property_id", "=", property.id).executeTakeFirstOrThrow();
      expect(notification.message).toMatch(/Alex Tech added Canyon House/);

      const setup = await request(app).get("/api/admin/inspection-setup").set("Authorization", auth).expect(200);
      expect(setup.body.unreadPropertyNotifications).toBe(1);
      expect(setup.body.propertyAudits[0]).toMatchObject({ property_id: property.id, actor_type: "Technician", action: "Created" });

      await request(app).post("/api/tech/properties").set("Cookie", sessionCookie).send({ clientId: client.body.id, name: "Duplicate", streetAddress: "123 Main St.", city: "Palm Desert", state: "CA", postalCode: "92260", inspectionType: "Departure" }).expect(409);
      await request(app).post("/api/tech/properties").set("Cookie", sessionCookie).send({ clientId: client.body.id, name: "Bad ZIP", streetAddress: "55 Test Road", city: "Indio", state: "California", postalCode: "92", inspectionType: "Arrival" }).expect(400);
    } finally { await db.destroy(); }
  });

  it("creates an unassigned property and inspection, exposes owner review context, and supports later assignment", async () => {
    const { app, db, auth } = await portalApp();
    try {
      const client = await request(app).post("/api/admin/clients").set("Authorization", auth).send({ companyName: "Future Owner", contactName: "Morgan", email: "future@example.com" }).expect(201);
      await request(app).post("/api/admin/technicians").set("Authorization", auth).send({ name: "Field Scout", email: "scout@example.com", password: "temporary-pass-123" }).expect(201);
      const login = await request(app).post("/api/tech/login").send({ email: "scout@example.com", password: "temporary-pass-123" }).expect(200);
      const rawCookie = login.headers["set-cookie"];
      const cookie = (Array.isArray(rawCookie) ? rawCookie[0] : rawCookie)!.split(";")[0];

      const created = await request(app).post("/api/tech/properties").set("Cookie", cookie).send({
        clientId: "", name: "Private Home", streetAddress: "900 New Avenue", city: "La Quinta", state: "CA", postalCode: "92253", inspectionType: "Departure"
      }).expect(201);
      expect(created.body).toMatchObject({ propertyId: expect.any(String), inspectionId: expect.any(String), assignmentStatus: "Pending Client Assignment" });

      const assignment = await db.selectFrom("property_assignment_status").selectAll().where("property_id", "=", created.body.propertyId).executeTakeFirstOrThrow();
      expect(assignment).toMatchObject({ inspection_id: created.body.inspectionId, status: "Pending Client Assignment" });
      const detail = await request(app).get(`/api/tech/inspections/${created.body.inspectionId}`).set("Cookie", cookie).expect(200);
      expect(detail.body.inspection).toMatchObject({ property_name: "Private Home", company_name: "Unassigned", client_email: "", assignment_status: "Pending Client Assignment" });
      await request(app).put(`/api/tech/inspections/${created.body.inspectionId}`).set("Cookie", cookie).send({
        summary: "Draft started on site.", checklist: checklistTemplate("Departure").map((item) => ({ ...item, answer: "Pass", note: "" })), findings: []
      }).expect(200);

      const setup = await request(app).get("/api/admin/inspection-setup").set("Authorization", auth).expect(200);
      expect(setup.body.clients).toHaveLength(1);
      expect(setup.body.properties.find((item: { id: string }) => item.id === created.body.propertyId)).toMatchObject({
        assignment_status: "Pending Client Assignment", assignment_technician_name: "Field Scout", assignment_inspection_type: "Departure", assignment_inspection_id: created.body.inspectionId
      });
      expect(setup.body.propertyNotifications.find((item: { property_id: string }) => item.property_id === created.body.propertyId).message).toMatch(/Client assignment is required/);

      await request(app).post("/api/tech/properties").set("Cookie", cookie).send({ clientId: client.body.id, name: "Assigned Duplicate", streetAddress: "900 New Ave.", city: "La Quinta", state: "CA", postalCode: "92253", inspectionType: "Arrival" }).expect(409).expect(/already exists/);
      await db.updateTable("inspections").set({ status: "Ready" }).where("id", "=", created.body.inspectionId).execute();
      await request(app).post(`/api/admin/inspections/${created.body.inspectionId}/publish`).set("Authorization", auth).expect(409).expect(/Assign this property/);

      await request(app).patch(`/api/admin/properties/${created.body.propertyId}`).set("Authorization", auth).send({ clientId: client.body.id, name: "Private Home", address: "900 New Avenue, La Quinta, CA 92253" }).expect(200);
      expect(await db.selectFrom("property_assignment_status").selectAll().where("property_id", "=", created.body.propertyId).executeTakeFirst()).toBeUndefined();
      expect((await db.selectFrom("properties").select("client_id").where("id", "=", created.body.propertyId).executeTakeFirstOrThrow()).client_id).toBe(client.body.id);
      expect((await db.selectFrom("property_notifications").select("read_at").where("property_id", "=", created.body.propertyId).executeTakeFirstOrThrow()).read_at).toBeTruthy();

      await request(app).post("/api/tech/clients").set("Cookie", cookie).send({ companyName: "Forbidden" }).expect(404);
      await request(app).patch(`/api/tech/properties/${created.body.propertyId}`).set("Cookie", cookie).send({ clientId: client.body.id }).expect(404);
    } finally { await db.destroy(); }
  });

  it("keeps client ownership and destructive property controls owner-only while supporting owner edit, merge, archive, and review", async () => {
    const { app, db, auth } = await portalApp();
    try {
      const client = await request(app).post("/api/admin/clients").set("Authorization", auth).send({ companyName: "Desert Stays", contactName: "Morgan", email: "morgan@example.com", phone: "7605550199" }).expect(201);
      await request(app).post("/api/admin/technicians").set("Authorization", auth).send({ name: "Alex Tech", email: "alex@example.com", password: "temporary-pass-123" }).expect(201);
      const login = await request(app).post("/api/tech/login").send({ email: "alex@example.com", password: "temporary-pass-123" }).expect(200);
      const rawCookie = login.headers["set-cookie"];
      const sessionCookie = (Array.isArray(rawCookie) ? rawCookie[0] : rawCookie)!.split(";")[0];
      const created = await request(app).post("/api/tech/properties").set("Cookie", sessionCookie).send({ clientId: client.body.id, name: "Field Added", streetAddress: "10 Palm Road", city: "Indio", state: "CA", postalCode: "92201", inspectionType: "Departure" }).expect(201);

      await request(app).post("/api/tech/clients").set("Cookie", sessionCookie).send({ companyName: "Forbidden" }).expect(404);
      await request(app).patch(`/api/tech/properties/${created.body.propertyId}`).set("Cookie", sessionCookie).send({ clientId: client.body.id, name: "Forbidden", address: "Elsewhere" }).expect(404);
      await request(app).delete(`/api/tech/properties/${created.body.propertyId}`).set("Cookie", sessionCookie).expect(404);
      await request(app).get("/api/tech/billing").set("Cookie", sessionCookie).expect(404);
      await request(app).post("/api/admin/clients").set("Cookie", sessionCookie).send({ companyName: "Forbidden" }).expect(401);

      await request(app).patch(`/api/admin/properties/${created.body.propertyId}`).set("Authorization", auth).send({ clientId: client.body.id, name: "Owner Corrected", address: "10 Palm Rd, Indio, CA 92201" }).expect(200);
      const target = await request(app).post("/api/admin/properties").set("Authorization", auth).send({ clientId: client.body.id, name: "Canonical Property", address: "12 Palm Road, Indio, CA 92201" }).expect(201);
      await request(app).post(`/api/admin/properties/${created.body.propertyId}/merge`).set("Authorization", auth).send({ targetPropertyId: target.body.id }).expect(200);
      const movedInspection = await db.selectFrom("inspections").select("property_id").where("id", "=", created.body.inspectionId).executeTakeFirstOrThrow();
      expect(movedInspection.property_id).toBe(target.body.id);
      const mergedSource = await db.selectFrom("properties").select("active").where("id", "=", created.body.propertyId).executeTakeFirstOrThrow();
      expect(mergedSource.active).toBe(0);
      await request(app).post(`/api/admin/properties/${target.body.id}/archive`).set("Authorization", auth).expect(204);
      await request(app).post(`/api/admin/properties/${created.body.propertyId}/notifications/read`).set("Authorization", auth).expect(204);

      const actions = await db.selectFrom("property_audit_events").select("action").orderBy("created_at").execute();
      expect(actions.map((event) => event.action)).toEqual(expect.arrayContaining(["Created", "Edited", "Merged", "Archived"]));
      const archived = await db.selectFrom("properties").select("active").where("id", "=", target.body.id).executeTakeFirstOrThrow();
      expect(archived.active).toBe(0);
      const notification = await db.selectFrom("property_notifications").select("read_at").where("property_id", "=", created.body.propertyId).executeTakeFirstOrThrow();
      expect(notification.read_at).toBeTruthy();
    } finally { await db.destroy(); }
  });
});
