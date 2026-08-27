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
import { checklistTemplate } from "./inspectionTemplates.js";

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
