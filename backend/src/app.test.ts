import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { Kysely, PostgresDialect } from "kysely";
import { newDb } from "pg-mem";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { initializeDatabase } from "./database.js";
import type { TaskCoreDatabase } from "./types.js";

const futureServiceDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

const validRequest = {
  name: "Jordan Customer",
  phone: "(760) 555-0123",
  email: "jordan@example.com",
  address: "123 Palm Avenue, Palm Desert, CA",
  issue: "Install and configure a video doorbell.",
  contactMethod: "Text",
  appointmentDate: futureServiceDate,
  arrivalWindow: "10 AM–12 PM",
  submissionTimestamp: "2026-07-20T18:00:00.000Z"
};

const openDatabases: Kysely<TaskCoreDatabase>[] = [];

async function testApp(rateLimitMax = 20, trustProxy: false | 1 | "render" = false) {
  const memoryPostgres = newDb({ noAstCoverageCheck: true });
  const adapter = memoryPostgres.adapters.createPg();
  const config = loadConfig({
    nodeEnv: "test",
    databaseUrl: "postgresql://test",
    adminUsername: "jay",
    adminPassword: "test-password-long-enough",
    corsOrigins: ["http://localhost:8000"],
    rateLimitWindowMs: 60_000,
    rateLimitMax,
    trustProxy
  });
  const db = new Kysely<TaskCoreDatabase>({ dialect: new PostgresDialect({ pool: new adapter.Pool() }) });
  openDatabases.push(db);
  await initializeDatabase(db);
  return { app: createApp(config, db), auth: "Basic " + Buffer.from("jay:test-password-long-enough").toString("base64") };
}

afterEach(async () => {
  await Promise.all(openDatabases.splice(0).map((db) => db.destroy()));
});

describe("POST /api/service-requests", () => {
  it("uses the managed Render edge address instead of spoofable XFF chains", async () => {
    const { app } = await testApp(1, "render");
    await request(app).post("/api/service-requests").set("CF-Connecting-IP", "203.0.113.10").set("X-Forwarded-For", "198.51.100.1").send({}).expect(400);
    await request(app).post("/api/service-requests").set("CF-Connecting-IP", "203.0.113.10").set("X-Forwarded-For", "198.51.100.99").send({}).expect(429);
    await request(app).post("/api/service-requests").set("CF-Connecting-IP", "203.0.113.11").send({}).expect(400);
    const invalid = await request(app).post("/api/service-requests").set("CF-Connecting-IP", "invalid").send({}).expect(400);
    expect(invalid.body.error).toBe("Invalid ingress client address.");
    const missing = await request(app).post("/api/service-requests").set("X-Forwarded-For", "198.51.100.1").send({}).expect(400);
    expect(missing.body.error).toBe("Invalid ingress client address.");
    await request(app).get("/health").expect(200);
  });
  it("uses only the ingress-supplied rightmost client IP for rate limiting", async () => {
    const { app } = await testApp(1, 1);
    expect(app.get("trust proxy")).toBe(1);
    // Untrusted leftmost addresses cannot reset the actual client's limiter.
    await request(app).post("/api/service-requests").set("X-Forwarded-For", "198.51.100.1, 203.0.113.10").send({}).expect(400);
    await request(app).post("/api/service-requests").set("X-Forwarded-For", "198.51.100.99, 203.0.113.10").send({}).expect(429);
    await request(app).post("/api/service-requests").set("X-Forwarded-For", "198.51.100.1, 203.0.113.11").send({}).expect(400);
  });
  it("serves an unauthenticated database-aware health check", async () => {
    const { app } = await testApp();
    const response = await request(app).get("/health").expect(200);
    expect(response.body).toEqual({ status: "ok", database: "connected" });
  });

  it("validates and stores a valid request", async () => {
    const { app, auth } = await testApp();
    const created = await request(app).post("/api/service-requests").send(validRequest).expect(201);
    expect(created.body.status).toBe("New");
    const admin = await request(app).get("/api/admin/service-requests").set("Authorization", auth).expect(200);
    expect(admin.body.requests).toHaveLength(1);
    expect(admin.body.requests[0]).toMatchObject({ customerName: validRequest.name, requestedArrivalWindow: validRequest.arrivalWindow, status: "New" });
  });

  it("rejects missing required fields", async () => {
    const { app } = await testApp();
    const response = await request(app).post("/api/service-requests").send({ name: "Jordan" }).expect(400);
    expect(response.body.error).toMatch(/check/i);
  });

  it("rejects an invalid phone number", async () => {
    const { app } = await testApp();
    await request(app).post("/api/service-requests").send({ ...validRequest, phone: "123" }).expect(400);
  });

  it("rejects an invalid requested arrival window", async () => {
    const { app } = await testApp();
    await request(app).post("/api/service-requests").send({ ...validRequest, arrivalWindow: "Whenever" }).expect(400);
  });

  it("rate limits public submissions", async () => {
    const { app } = await testApp(1);
    await request(app).post("/api/service-requests").send(validRequest).expect(201);
    await request(app).post("/api/service-requests").send({ ...validRequest, name: "Another Customer" }).expect(429);
  });
});

describe("admin request management", () => {
  it("protects admin routes", async () => {
    const { app } = await testApp();
    await request(app).get("/api/admin/service-requests").expect(401);
    await request(app).get("/admin/").expect(401);
  });

  it("serves the protected admin index and its relative assets", async () => {
    const { app, auth } = await testApp();
    await request(app).get("/admin/").set("Authorization", auth).expect("Content-Type", /html/).expect(/TaskCore Admin/).expect(200);
    await request(app).get("/admin/admin.css").set("Authorization", auth).expect("Content-Type", /css/).expect(200);
    await request(app).get("/admin/property-admin.css").set("Authorization", auth).expect("Content-Type", /css/).expect(200);
    await request(app).get("/admin/admin.js").set("Authorization", auth).expect("Content-Type", /javascript/).expect(200);
    await request(app).get("/admin/inspection-admin.js").set("Authorization", auth).expect("Content-Type", /javascript/).expect(200);
  });

  it("serves the technician index and its relative assets", async () => {
    const { app } = await testApp();
    await request(app).get("/tech/").expect("Content-Type", /html/).expect(/Technician sign in/).expect(/New task \/ service call/i).expect(/Continue current job/i).expect(200);
    await request(app).get("/tech/tech.css").expect("Content-Type", /css/).expect(200);
    await request(app).get("/tech/property.css").expect("Content-Type", /css/).expect(200);
    await request(app).get("/tech/tech.js").expect("Content-Type", /javascript/).expect(/api\/tech\/tasks/).expect(/Offline — saved on device/).expect(200);
  });

  it("completes the submission, listing, and status update flow", async () => {
    const { app, auth } = await testApp();
    const created = await request(app).post("/api/service-requests").send(validRequest).expect(201);
    const listed = await request(app).get("/api/admin/service-requests").set("Authorization", auth).expect(200);
    expect(listed.body.requests[0].id).toBe(created.body.id);
    const updated = await request(app)
      .patch(`/api/admin/service-requests/${created.body.id}`)
      .set("Authorization", auth)
      .send({ status: "Contacted", privateNote: "Customer prefers an afternoon confirmation call." })
      .expect(200);
    expect(updated.body.request).toMatchObject({ status: "Contacted", privateNote: "Customer prefers an afternoon confirmation call." });
  });
});
