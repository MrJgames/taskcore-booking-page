import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Kysely, PostgresDialect } from "kysely";
import { newDb } from "pg-mem";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { initializeDatabase } from "./database.js";
import type { TaskCoreDatabase } from "./types.js";

const directories: string[] = [];
async function testPortal() {
  const memory = newDb({ noAstCoverageCheck: true }), adapter = memory.adapters.createPg();
  const db = new Kysely<TaskCoreDatabase>({ dialect: new PostgresDialect({ pool: new adapter.Pool() }) });
  await initializeDatabase(db);
  const uploadDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "taskcore-operations-test-")); directories.push(uploadDirectory);
  const config = loadConfig({ nodeEnv: "test", databaseUrl: "postgresql://test", adminUsername: "owner", adminPassword: "owner-password-long-enough", corsOrigins: [], publicBaseUrl: "https://taskcore.test", uploadDirectory, mediaStorageMode: "local" });
  return { app: createApp(config, db), db, auth: "Basic " + Buffer.from("owner:owner-password-long-enough").toString("base64") };
}
function sessionCookie(response: request.Response, name: string) { const raw = response.headers["set-cookie"], values = Array.isArray(raw) ? raw : [raw]; return values.find((value) => value?.startsWith(`${name}=`))!.split(";")[0]; }
async function organization(app: ReturnType<typeof createApp>, auth: string, suffix: string) {
  const password = "manager-password-123";
  const created = await request(app).post("/api/admin/operations/organizations").set("Authorization", auth).send({ name: `PM ${suffix}`, contactName: "Owner", email: `contact-${suffix}@example.com`, managerName: `Manager ${suffix}`, managerEmail: `manager-${suffix}@example.com`, managerPassword: password }).expect(201);
  const property = await request(app).post("/api/admin/properties").set("Authorization", auth).send({ clientId: created.body.clientId, name: `Property ${suffix}`, address: `${suffix.length}00 ${suffix} Street, Indio, CA 92201` }).expect(201);
  const login = await request(app).post("/api/manager/login").send({ email: `manager-${suffix}@example.com`, password }).expect(200);
  return { ...created.body, propertyId: property.body.id, cookie: sessionCookie(login, "taskcore_manager_session") };
}
afterEach(() => { for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true }); });

describe("property operations platform", () => {
  it("serves the separated role portals and shared responsive assets", async () => {
    const { app, db } = await testPortal();
    try {
      await request(app).get("/manager/").expect(200).expect(/TaskCore Property Manager/).expect(/New Service Request/);
      await request(app).get("/manager/manager.js").expect(200).expect(/api\/manager/);
      await request(app).get("/contractor/").expect(200).expect(/TaskCore Contractor/).expect(/Job offers/);
      await request(app).get("/contractor/contractor.js").expect(200).expect(/completion/);
      await request(app).get("/operations.css").expect(200).expect(/@media/);
    } finally { await db.destroy(); }
  });

  it("isolates organizations, staff, requests, internal fields, property history, and media", async () => {
    const { app, db, auth } = await testPortal();
    try {
      const a = await organization(app, auth, "Alpha"), b = await organization(app, auth, "Bravo");
      await request(app).post(`/api/admin/operations/organizations/${a.id}/users`).set("Authorization", auth).send({ role: "Property Staff", name: "Alpha Staff", email: "staff-alpha@example.com", password: "staff-password-123" }).expect(201);
      const staffLogin = await request(app).post("/api/manager/login").send({ email: "staff-alpha@example.com", password: "staff-password-123" }).expect(200);
      const staffCookie = sessionCookie(staffLogin, "taskcore_manager_session");
      const created = await request(app).post("/api/manager/requests").set("Cookie", staffCookie).send({ propertyId: a.propertyId, title: "Leaking sink", category: "Plumbing", description: "Kitchen sink is leaking under the cabinet.", priority: "Soon", permissionToEnter: true, occupancyStatus: "Vacant", preferredServiceDate: "2026-09-02", preferredServiceWindow: "9–12", spendingLimit: 250, accessInstructions: "Lockbox", additionalNotes: "Call TaskCore" }).expect(201);
      expect(created.body.requestNumber).toMatch(/^TC-REQ-\d+$/);
      await request(app).post("/api/manager/requests").set("Cookie", b.cookie).send({ propertyId: a.propertyId, title: "Forbidden", category: "Plumbing", description: "Cross organization request attempt.", priority: "Routine", occupancyStatus: "Unknown" }).expect(404);
      await request(app).get(`/api/manager/requests/${created.body.id}`).set("Cookie", b.cookie).expect(404);
      const own = await request(app).get(`/api/manager/requests/${created.body.id}`).set("Cookie", a.cookie).expect(200);
      expect(own.text).not.toMatch(/internal_notes|assigned_vendor_id|assigned_technician_id|margin|payout/i);
      await request(app).post(`/api/manager/requests/${created.body.id}/media`).set("Cookie", a.cookie).set("Content-Type", "image/jpeg").set("X-File-Name", "leak.jpg").send(Buffer.from("photo")).expect(201);
      await request(app).post(`/api/manager/requests/${created.body.id}/media`).set("Cookie", b.cookie).set("Content-Type", "image/jpeg").send(Buffer.from("photo")).expect(404);
      const dashboard = await request(app).get("/api/manager/dashboard").set("Cookie", a.cookie).expect(200);
      expect(dashboard.body.counts).toMatchObject({ totalProperties: 1, openRequests: 1 });
      expect(dashboard.body.properties).toHaveLength(1);
      await request(app).get(`/api/manager/properties/${b.propertyId}/history`).set("Cookie", a.cookie).expect(404);
      expect(await db.selectFrom("operations_notifications").selectAll().where("request_id", "=", created.body.id).execute()).toHaveLength(1);
    } finally { await db.destroy(); }
  });

  it("supports owner review, valid dispatch transitions, estimate revisions, and manager approval", async () => {
    const { app, db, auth } = await testPortal();
    try {
      const org = await organization(app, auth, "Estimate");
      const created = await request(app).post("/api/manager/requests").set("Cookie", org.cookie).send({ propertyId: org.propertyId, title: "HVAC service", category: "HVAC", description: "System is not cooling consistently.", priority: "Urgent", occupancyStatus: "Occupied" }).expect(201);
      const queue = await request(app).get("/api/admin/operations/requests").set("Authorization", auth).expect(200);
      expect(queue.body.requests[0]).toMatchObject({ id: created.body.id, status: "submitted", organization_name: "PM Estimate" });
      await request(app).patch(`/api/admin/operations/requests/${created.body.id}/dispatch`).set("Authorization", auth).send({ status: "completed" }).expect(409);
      await request(app).patch(`/api/admin/operations/requests/${created.body.id}/dispatch`).set("Authorization", auth).send({ status: "owner_review", category: "HVAC", priority: "Urgent", internalNotes: "Internal labor and margin stay private." }).expect(200);
      const estimate = await request(app).post(`/api/admin/operations/requests/${created.body.id}/estimate`).set("Authorization", auth).send({ amount: 425, scope: "Diagnose and repair cooling issue", customerNote: "Approval required before dispatch." }).expect(201);
      const managerDetail = await request(app).get(`/api/manager/requests/${created.body.id}`).set("Cookie", org.cookie).expect(200);
      expect(managerDetail.body.estimate).toMatchObject({ id: estimate.body.id, amount_cents: 42500, status: "Awaiting Approval" });
      expect(managerDetail.text).not.toContain("Internal labor and margin stay private.");
      await request(app).post(`/api/manager/estimates/${estimate.body.id}/decision`).set("Cookie", org.cookie).send({ decision: "Approved", comment: "Proceed" }).expect(200);
      expect((await db.selectFrom("operations_service_requests").select("status").where("id", "=", created.body.id).executeTakeFirstOrThrow()).status).toBe("approved");
      expect(await db.selectFrom("estimate_approvals").selectAll().execute()).toHaveLength(1);
    } finally { await db.destroy(); }
  });

  it("isolates contractor offers and financials, handles decline/reoffer/acceptance, and gates completion review", async () => {
    const { app, db, auth } = await testPortal();
    try {
      const org = await organization(app, auth, "Vendor");
      const created = await request(app).post("/api/manager/requests").set("Cookie", org.cookie).send({ propertyId: org.propertyId, title: "Pool repair", category: "Pool", description: "Pool pump is noisy and losing prime.", priority: "Soon", occupancyStatus: "Vacant" }).expect(201);
      const requestPhoto = await request(app).post(`/api/manager/requests/${created.body.id}/media`).set("Cookie", org.cookie).set("Content-Type", "image/jpeg").set("X-File-Name", "pump.jpg").send(Buffer.from("pump-photo")).expect(201);
      await request(app).patch(`/api/admin/operations/requests/${created.body.id}/dispatch`).set("Authorization", auth).send({ status: "owner_review" }).expect(200);
      const channels = (await request(app).get("/api/admin/operations/setup").set("Authorization", auth).expect(200)).body.channels;
      const vendorA = await request(app).post("/api/admin/operations/vendors").set("Authorization", auth).send({ businessName: "Vendor A", contactName: "A", email: "vendor-a@example.com", password: "vendor-password-123", channelIds: [channels.find((c: { name: string }) => c.name === "Pool").id], insuranceStatus: "Not reviewed", licenseStatus: "Review required" }).expect(201);
      const vendorB = await request(app).post("/api/admin/operations/vendors").set("Authorization", auth).send({ businessName: "Vendor B", contactName: "B", email: "vendor-b@example.com", password: "vendor-password-123", channelIds: [] }).expect(201);
      const offerA = await request(app).post(`/api/admin/operations/requests/${created.body.id}/offers`).set("Authorization", auth).send({ vendorId: vendorA.body.id, scope: "Diagnose pool pump", offeredCompensation: 180, serviceWindow: "Tomorrow 9–12" }).expect(201);
      expect(offerA.body.complianceWarning).toMatch(/license and insurance/);
      const loginA = await request(app).post("/api/contractor/login").send({ email: "vendor-a@example.com", password: "vendor-password-123" }).expect(200), loginB = await request(app).post("/api/contractor/login").send({ email: "vendor-b@example.com", password: "vendor-password-123" }).expect(200);
      const cookieA = sessionCookie(loginA, "taskcore_vendor_session"), cookieB = sessionCookie(loginB, "taskcore_vendor_session");
      expect((await request(app).get("/api/contractor/offers").set("Cookie", cookieA).expect(200)).body.offers).toHaveLength(1);
      expect((await request(app).get("/api/contractor/offers").set("Cookie", cookieB).expect(200)).body.offers).toHaveLength(0);
      expect((await request(app).get(`/api/contractor/requests/${created.body.id}`).set("Cookie", cookieA).expect(200)).body.media).toEqual([expect.objectContaining({ id: requestPhoto.body.id })]);
      await request(app).get(`/api/contractor/requests/${created.body.id}`).set("Cookie", cookieB).expect(404);
      await request(app).get(`/api/contractor/requests/${created.body.id}/media/${requestPhoto.body.id}`).set("Cookie", cookieA).expect(200);
      await request(app).get(`/api/contractor/requests/${created.body.id}/media/${requestPhoto.body.id}`).set("Cookie", cookieB).expect(404);
      await request(app).post(`/api/contractor/offers/${offerA.body.id}/respond`).set("Cookie", cookieB).send({ decision: "Accepted" }).expect(404);
      await request(app).post(`/api/contractor/offers/${offerA.body.id}/respond`).set("Cookie", cookieA).send({ decision: "Declined" }).expect(200);
      const offerB = await request(app).post(`/api/admin/operations/requests/${created.body.id}/offers`).set("Authorization", auth).send({ vendorId: vendorB.body.id, scope: "Diagnose pool pump", offeredCompensation: 190, serviceWindow: "Friday" }).expect(201);
      await request(app).post(`/api/contractor/offers/${offerB.body.id}/respond`).set("Cookie", cookieB).send({ decision: "Accepted" }).expect(200);
      await request(app).post(`/api/contractor/requests/${created.body.id}/completion`).set("Cookie", cookieA).send({ completionNotes: "Forbidden", invoiceAmount: 1 }).expect(404);
      const completion = await request(app).post(`/api/contractor/requests/${created.body.id}/completion`).set("Cookie", cookieB).send({ completionNotes: "Pump seal replaced and system tested.", materialsNotes: "Seal kit", invoiceAmount: 165 }).expect(201);
      const managerBeforeReview = await request(app).get(`/api/manager/requests/${created.body.id}`).set("Cookie", org.cookie).expect(200);
      expect(managerBeforeReview.text).not.toMatch(/16500|offered_compensation|invoice_amount|Vendor B/i);
      await request(app).post(`/api/admin/operations/completions/${completion.body.id}/review`).set("Authorization", auth).send({ decision: "Approved", customerNote: "TaskCore completed and reviewed the repair." }).expect(200);
      expect((await db.selectFrom("operations_service_requests").select("status").where("id", "=", created.body.id).executeTakeFirstOrThrow()).status).toBe("completed");
    } finally { await db.destroy(); }
  });

  it("creates a linked request from an inspection finding without duplicating inspection media", async () => {
    const { app, db, auth } = await testPortal();
    try {
      const org = await organization(app, auth, "Inspection"), now = new Date().toISOString(), technicianId = randomUUID(), inspectionId = randomUUID(), findingId = randomUUID(), mediaId = randomUUID();
      await db.insertInto("technicians").values({ id: technicianId, name: "Inspector", email: "inspector@example.com", password_hash: "unused:00", created_at: now }).execute();
      await db.insertInto("inspections").values({ id: inspectionId, property_id: org.propertyId, technician_id: technicianId, inspection_type: "Maintenance Documentation", status: "Submitted", submitted_at: now, reviewed_at: null, published_at: null, report_token_hash: null, report_expires_at: null, created_at: now, updated_at: now }).execute();
      await db.insertInto("inspection_findings").values({ id: findingId, inspection_id: inspectionId, title: "Loose outlet", details: "Outlet moves when used.", priority: "Urgent", quote_amount_cents: null, decided_at: null, created_at: now, updated_at: now }).execute();
      await db.insertInto("inspection_media").values({ id: mediaId, inspection_id: inspectionId, kind: "Photo", category: "finding", caption: "Outlet", storage_key: "existing/photo.jpg", file_name: "outlet.jpg", mime_type: "image/jpeg", size_bytes: 100, created_at: now }).execute();
      await db.insertInto("inspection_media_links").values({ media_id: mediaId, question_key: null, finding_id: findingId }).execute();
      const created = await request(app).post(`/api/admin/inspections/${inspectionId}/findings/${findingId}/work-request`).set("Authorization", auth).send({ organizationId: org.id, title: "Repair loose outlet", category: "Electrical", priority: "Urgent" }).expect(201);
      const linked = await db.selectFrom("operations_service_requests").selectAll().where("id", "=", created.body.id).executeTakeFirstOrThrow();
      expect(linked).toMatchObject({ inspection_id: inspectionId, finding_id: findingId, property_id: org.propertyId });
      const media = await db.selectFrom("operations_request_media").selectAll().where("request_id", "=", linked.id).executeTakeFirstOrThrow();
      expect(media).toMatchObject({ inspection_media_id: mediaId, storage_key: null });
      expect(await db.selectFrom("inspection_media").selectAll().where("id", "=", mediaId).execute()).toHaveLength(1);
    } finally { await db.destroy(); }
  });
});
