import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createDatabase, initializeDatabase } from "./database.js";

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

const openDatabases: ReturnType<typeof createDatabase>[] = [];

async function testApp(rateLimitMax = 20) {
  const config = loadConfig({
    nodeEnv: "test",
    sqlitePath: ":memory:",
    adminUsername: "jay",
    adminPassword: "test-password-long-enough",
    corsOrigins: ["http://localhost:8000"],
    rateLimitWindowMs: 60_000,
    rateLimitMax
  });
  const db = createDatabase(config);
  openDatabases.push(db);
  await initializeDatabase(db);
  return { app: createApp(config, db), auth: "Basic " + Buffer.from("jay:test-password-long-enough").toString("base64") };
}

afterEach(async () => {
  await Promise.all(openDatabases.splice(0).map((db) => db.destroy()));
});

describe("POST /api/service-requests", () => {
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
