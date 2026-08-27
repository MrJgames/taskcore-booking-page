import fs from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import rateLimit from "express-rate-limit";
import type { Kysely } from "kysely";
import type { AppConfig } from "./config.js";
import { createOpaqueToken, createTechnicianAuth, hashPassword, hashToken, type TechnicianRequest, verifyPassword } from "./auth.js";
import { deleteMedia, persistMedia, receiveUpload, sendMedia, stagedMediaPath, uploadExtension } from "./media.js";
import { sendClientReportEmail, sendOwnerReviewText } from "./notifications.js";
import type { TaskCoreDatabase } from "./types.js";
import { clientSchema, createInspectionSchema, findingDecisionSchema, inspectionDraftSchema, inspectionReviewSchema, ownerPropertyUpdateSchema, propertyMergeSchema, propertySchema, technicianLoginSchema, technicianPropertySchema, technicianSchema } from "./validation.js";

const techDirectory = fileURLToPath(new URL("../public/tech/", import.meta.url));
const publicDirectory = fileURLToPath(new URL("../public/", import.meta.url));
const techIndex = path.join(techDirectory, "index.html");
const requiredPhotoCategories = ["entry", "thermostat", "kitchen", "bathroom"];

function routeParam(request: express.Request, name: string): string {
  const value = request.params[name];
  return Array.isArray(value) ? value[0] || "" : value || "";
}

function cleanFileName(value: string | undefined): string {
  return (value || "inspection-media").replace(/[^a-zA-Z0-9._ -]/g, "_").slice(0, 180);
}

function cents(value: number | null): number | null {
  return value === null ? null : Math.round(value * 100);
}

function dollars(value: number | null): string {
  return value === null ? "Pending quote" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value / 100);
}

function normalizeAddress(value: string): string {
  return value.toLowerCase().replace(/\b(street)\b/g, "st").replace(/\b(road)\b/g, "rd").replace(/\b(avenue)\b/g, "ave").replace(/\b(boulevard)\b/g, "blvd").replace(/[^a-z0-9]/g, "");
}

async function duplicateProperty(db: Kysely<TaskCoreDatabase>, address: string, excludeId?: string) {
  const rows = await db.selectFrom("properties").innerJoin("clients", "clients.id", "properties.client_id")
    .select(["properties.id", "properties.name", "properties.address", "properties.client_id", "properties.active", "clients.company_name"]).execute();
  const normalized = normalizeAddress(address);
  return rows.find((row) => row.id !== excludeId && normalizeAddress(row.address) === normalized);
}

function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character] || character));
}

async function inspectionBundle(db: Kysely<TaskCoreDatabase>, id: string) {
  const inspection = await db.selectFrom("inspections")
    .innerJoin("properties", "properties.id", "inspections.property_id")
    .innerJoin("clients", "clients.id", "properties.client_id")
    .innerJoin("technicians", "technicians.id", "inspections.technician_id")
    .select([
      "inspections.id", "inspections.inspection_type", "inspections.status", "inspections.checklist_json", "inspections.summary",
      "inspections.review_note", "inspections.created_at", "inspections.updated_at", "inspections.submitted_at", "inspections.reviewed_at",
      "inspections.published_at", "inspections.report_expires_at", "properties.id as property_id", "properties.name as property_name",
      "properties.address", "clients.company_name", "clients.contact_name", "clients.email as client_email", "technicians.id as technician_id",
      "technicians.name as technician_name"
    ]).where("inspections.id", "=", id).executeTakeFirst();
  if (!inspection) return undefined;
  const [media, findings] = await Promise.all([
    db.selectFrom("inspection_media").selectAll().where("inspection_id", "=", id).orderBy("created_at").execute(),
    db.selectFrom("inspection_findings").selectAll().where("inspection_id", "=", id).orderBy("created_at").execute()
  ]);
  let checklist: unknown[] = [];
  try { checklist = JSON.parse(inspection.checklist_json); } catch { checklist = []; }
  return { ...inspection, checklist, media, findings };
}

async function inspectionForReportToken(db: Kysely<TaskCoreDatabase>, token: string) {
  const now = new Date().toISOString();
  const row = await db.selectFrom("inspections").select(["id"]).where("report_token_hash", "=", hashToken(token))
    .where("status", "=", "Published").where("report_expires_at", ">", now).executeTakeFirst();
  return row ? inspectionBundle(db, row.id) : undefined;
}

export function registerInspectionRoutes(app: express.Express, config: AppConfig, db: Kysely<TaskCoreDatabase>) {
  app.get(["/tech", "/tech/"], (_request, response, next) => {
    response.sendFile(techIndex, { dotfiles: "deny" }, (error) => error ? next(error) : undefined);
  });
  app.use("/tech", express.static(techDirectory, { index: false, dotfiles: "deny" }));
  app.use("/report-assets", express.static(publicDirectory, { index: false, dotfiles: "deny" }));

  const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: "draft-7", legacyHeaders: false, message: { error: "Too many sign-in attempts. Wait and try again." } });
  const decisionLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 30, standardHeaders: "draft-7", legacyHeaders: false, message: { error: "Too many report updates. Wait and try again." } });

  app.post("/api/tech/login", loginLimiter, async (request, response, next) => {
    try {
      const parsed = technicianLoginSchema.safeParse(request.body);
      if (!parsed.success) return response.status(400).json({ error: "Enter a valid email and password." });
      const technician = await db.selectFrom("technicians").selectAll().where("email", "=", parsed.data.email.toLowerCase()).where("active", "=", 1).executeTakeFirst();
      if (!technician || !verifyPassword(parsed.data.password, technician.password_hash)) return response.status(401).json({ error: "Email or password is incorrect." });
      const token = createOpaqueToken();
      const now = new Date();
      const expires = new Date(now.getTime() + 12 * 60 * 60 * 1000);
      await db.insertInto("technician_sessions").values({ id: randomUUID(), technician_id: technician.id, token_hash: hashToken(token), created_at: now.toISOString(), expires_at: expires.toISOString() }).execute();
      response.cookie("taskcore_tech_session", token, { httpOnly: true, sameSite: "strict", secure: config.nodeEnv === "production", expires, path: "/" });
      response.json({ technician: { id: technician.id, name: technician.name, email: technician.email } });
    } catch (error) { next(error); }
  });

  const technicianAuth = createTechnicianAuth(db);
  app.use("/api/tech", technicianAuth);

  app.get("/api/tech/session", (request: TechnicianRequest, response) => response.json({ technician: request.technician }));
  app.post("/api/tech/logout", async (request, response, next) => {
    try {
      const cookie = (request.get("cookie") || "").split(";").map((part) => part.trim()).find((part) => part.startsWith("taskcore_tech_session="));
      const token = cookie?.slice(cookie.indexOf("=") + 1);
      if (token) await db.deleteFrom("technician_sessions").where("token_hash", "=", hashToken(decodeURIComponent(token))).execute();
      response.clearCookie("taskcore_tech_session", { path: "/" }).status(204).end();
    } catch (error) { next(error); }
  });

  app.get("/api/tech/properties", async (_request, response, next) => {
    try {
      const rows = await db.selectFrom("properties").innerJoin("clients", "clients.id", "properties.client_id")
        .select(["properties.id", "properties.name", "properties.address", "clients.company_name"])
        .where("properties.active", "=", 1).orderBy("clients.company_name").orderBy("properties.name").execute();
      response.json({ properties: rows });
    } catch (error) { next(error); }
  });

  app.get("/api/tech/clients", async (_request, response, next) => {
    try {
      const clients = await db.selectFrom("clients").select(["id", "company_name"]).orderBy("company_name").execute();
      response.json({ clients });
    } catch (error) { next(error); }
  });

  app.post("/api/tech/properties", async (request: TechnicianRequest, response, next) => {
    try {
      const parsed = technicianPropertySchema.safeParse(request.body);
      if (!parsed.success) return response.status(400).json({ error: "Select a client and enter the property name, street, city, two-letter state, ZIP code, and inspection type.", fields: parsed.error.flatten().fieldErrors });
      const client = await db.selectFrom("clients").select(["id", "company_name"]).where("id", "=", parsed.data.clientId).executeTakeFirst();
      if (!client) return response.status(404).json({ error: "Client not found. Ask the owner to create the client first." });
      const address = `${parsed.data.streetAddress}, ${parsed.data.city}, ${parsed.data.state} ${parsed.data.postalCode}`;
      const duplicate = await duplicateProperty(db, address);
      if (duplicate) return response.status(409).json({ error: `This address already exists as ${duplicate.name} for ${duplicate.company_name}. Select that property or ask the owner to review it.`, duplicate: { id: duplicate.id, name: duplicate.name, clientId: duplicate.client_id, active: Boolean(duplicate.active) } });
      const now = new Date().toISOString();
      const propertyId = randomUUID();
      const inspectionId = randomUUID();
      const notificationId = randomUUID();
      const message = `${request.technician!.name} added ${parsed.data.name} for ${client.company_name} at ${address}. Review the technician-created property: ${config.publicBaseUrl}/admin/#property-${propertyId}`;
      await db.transaction().execute(async (transaction) => {
        await transaction.insertInto("properties").values({ id: propertyId, client_id: client.id, name: parsed.data.name, address, created_at: now }).execute();
        await transaction.insertInto("inspections").values({ id: inspectionId, property_id: propertyId, technician_id: request.technician!.id, inspection_type: parsed.data.inspectionType, status: "Draft", created_at: now, updated_at: now, submitted_at: null, reviewed_at: null, published_at: null, report_token_hash: null, report_expires_at: null }).execute();
        await transaction.insertInto("property_audit_events").values({ id: randomUUID(), property_id: propertyId, actor_type: "Technician", actor_id: request.technician!.id, action: "Created", details_json: JSON.stringify({ clientId: client.id, clientName: client.company_name, name: parsed.data.name, address, inspectionId }), created_at: now }).execute();
        await transaction.insertInto("property_notifications").values({ id: notificationId, property_id: propertyId, message, delivery_status: "dashboard:pending", read_at: null, created_at: now }).execute();
      });
      const sms = await sendOwnerReviewText(config, message);
      await db.updateTable("property_notifications").set({ delivery_status: `dashboard:${sms === "sent" ? "sms-sent" : sms}` }).where("id", "=", notificationId).execute();
      response.status(201).json({ propertyId, inspectionId, ownerNotification: sms });
    } catch (error) { next(error); }
  });

  app.get("/api/tech/inspections", async (request: TechnicianRequest, response, next) => {
    try {
      const rows = await db.selectFrom("inspections").innerJoin("properties", "properties.id", "inspections.property_id")
        .select(["inspections.id", "inspections.inspection_type", "inspections.status", "inspections.updated_at", "properties.name as property_name", "properties.address"])
        .where("inspections.technician_id", "=", request.technician!.id).orderBy("inspections.updated_at", "desc").execute();
      response.json({ inspections: rows });
    } catch (error) { next(error); }
  });

  app.post("/api/tech/inspections", async (request: TechnicianRequest, response, next) => {
    try {
      const parsed = createInspectionSchema.safeParse(request.body);
      if (!parsed.success) return response.status(400).json({ error: "Choose a property and inspection type." });
      const property = await db.selectFrom("properties").select("id").where("id", "=", parsed.data.propertyId).where("active", "=", 1).executeTakeFirst();
      if (!property) return response.status(404).json({ error: "Property not found." });
      const now = new Date().toISOString();
      const id = randomUUID();
      await db.insertInto("inspections").values({ id, property_id: property.id, technician_id: request.technician!.id, inspection_type: parsed.data.inspectionType, status: "Draft", created_at: now, updated_at: now, submitted_at: null, reviewed_at: null, published_at: null, report_token_hash: null, report_expires_at: null }).execute();
      response.status(201).json({ id });
    } catch (error) { next(error); }
  });

  app.get("/api/tech/inspections/:id", async (request: TechnicianRequest, response, next) => {
    try {
      const bundle = await inspectionBundle(db, routeParam(request, "id"));
      if (!bundle || bundle.technician_id !== request.technician!.id) return response.status(404).json({ error: "Inspection not found." });
      response.json({ inspection: bundle });
    } catch (error) { next(error); }
  });

  app.put("/api/tech/inspections/:id", async (request: TechnicianRequest, response, next) => {
    try {
      const parsed = inspectionDraftSchema.safeParse(request.body);
      if (!parsed.success) return response.status(400).json({ error: "Check the inspection answers and findings.", fields: parsed.error.flatten() });
      const inspection = await db.selectFrom("inspections").selectAll().where("id", "=", routeParam(request, "id")).where("technician_id", "=", request.technician!.id).executeTakeFirst();
      if (!inspection || !["Draft", "Needs Changes"].includes(inspection.status)) return response.status(409).json({ error: "This inspection can no longer be edited." });
      const now = new Date().toISOString();
      await db.transaction().execute(async (transaction) => {
        await transaction.updateTable("inspections").set({ checklist_json: JSON.stringify(parsed.data.checklist), summary: parsed.data.summary, updated_at: now, status: "Draft" }).where("id", "=", inspection.id).execute();
        await transaction.deleteFrom("inspection_findings").where("inspection_id", "=", inspection.id).execute();
        if (parsed.data.findings.length) await transaction.insertInto("inspection_findings").values(parsed.data.findings.map((finding) => ({ id: finding.id || randomUUID(), inspection_id: inspection.id, title: finding.title, details: finding.details, priority: finding.priority, quote_amount_cents: null, decided_at: null, created_at: now, updated_at: now }))).execute();
      });
      response.json({ inspection: await inspectionBundle(db, inspection.id) });
    } catch (error) { next(error); }
  });

  app.post("/api/tech/inspections/:id/media", async (request: TechnicianRequest, response, next) => {
    let destination: string | undefined;
    try {
      const inspection = await db.selectFrom("inspections").selectAll().where("id", "=", routeParam(request, "id")).where("technician_id", "=", request.technician!.id).executeTakeFirst();
      if (!inspection || !["Draft", "Needs Changes"].includes(inspection.status)) return response.status(409).json({ error: "This inspection can no longer receive uploads." });
      const mimeType = ((request.get("content-type") || "").split(";")[0] || "").toLowerCase();
      const extension = uploadExtension(mimeType);
      if (!extension) return response.status(415).json({ error: "Upload a JPG, PNG, WebP, HEIC, MP4, MOV, or WebM file." });
      const kind = mimeType.startsWith("video/") ? "Walkthrough" : "Photo";
      const category = String(request.query.category || (kind === "Walkthrough" ? "walkthrough" : "general")).replace(/[^a-z0-9-]/gi, "").slice(0, 60);
      const id = randomUUID();
      const storageKey = `${inspection.id}/${id}${extension}`;
      destination = stagedMediaPath(config, storageKey);
      if (!destination) throw new Error("Invalid media path.");
      const sizeBytes = await receiveUpload(request, destination, kind === "Walkthrough" ? config.maxVideoBytes : config.maxPhotoBytes);
      await persistMedia(config, storageKey, destination, mimeType);
      destination = undefined;
      const now = new Date().toISOString();
      await db.insertInto("inspection_media").values({ id, inspection_id: inspection.id, kind, category, caption: String(request.query.caption || "").slice(0, 240), storage_key: storageKey, file_name: cleanFileName(request.get("x-file-name")), mime_type: mimeType, size_bytes: sizeBytes, created_at: now }).execute();
      response.status(201).json({ media: { id, kind, category, mimeType, sizeBytes } });
    } catch (error) {
      if (destination) await fs.promises.rm(destination, { force: true });
      if (error instanceof Error && error.message === "UPLOAD_TOO_LARGE") return response.status(413).json({ error: "That file is larger than the upload limit." });
      next(error);
    }
  });

  app.delete("/api/tech/inspections/:inspectionId/media/:mediaId", async (request: TechnicianRequest, response, next) => {
    try {
      const row = await db.selectFrom("inspection_media").innerJoin("inspections", "inspections.id", "inspection_media.inspection_id")
        .select(["inspection_media.storage_key", "inspections.status"]).where("inspection_media.id", "=", routeParam(request, "mediaId"))
        .where("inspections.id", "=", routeParam(request, "inspectionId")).where("inspections.technician_id", "=", request.technician!.id).executeTakeFirst();
      if (!row || !["Draft", "Needs Changes"].includes(row.status)) return response.status(404).json({ error: "Media not found." });
      await db.deleteFrom("inspection_media").where("id", "=", routeParam(request, "mediaId")).execute();
      await deleteMedia(config, row.storage_key);
      response.status(204).end();
    } catch (error) { next(error); }
  });

  app.post("/api/tech/inspections/:id/submit", async (request: TechnicianRequest, response, next) => {
    try {
      const bundle = await inspectionBundle(db, routeParam(request, "id"));
      if (!bundle || bundle.technician_id !== request.technician!.id || !["Draft", "Needs Changes"].includes(bundle.status)) return response.status(409).json({ error: "Inspection cannot be submitted." });
      const checklist = bundle.checklist as Array<{ answer?: string }>;
      const categories = new Set(bundle.media.filter((item) => item.kind === "Photo").map((item) => item.category));
      const missingPhotos = requiredPhotoCategories.filter((category) => !categories.has(category));
      if (!checklist.length || checklist.some((item) => !item.answer)) return response.status(400).json({ error: "Complete every checklist item before submitting." });
      if (missingPhotos.length) return response.status(400).json({ error: `Add required photos: ${missingPhotos.join(", ")}.` });
      if (!bundle.media.some((item) => item.kind === "Walkthrough")) return response.status(400).json({ error: "Add the walkthrough video before submitting." });
      const now = new Date().toISOString();
      await db.updateTable("inspections").set({ status: "Submitted", submitted_at: now, updated_at: now }).where("id", "=", bundle.id).execute();
      const message = `${bundle.technician_name} submitted a ${bundle.inspection_type.toLowerCase()} inspection for ${bundle.property_name}. Review and quote the findings: ${config.publicBaseUrl}/admin/#inspection-${bundle.id}`;
      const sms = await sendOwnerReviewText(config, message);
      await db.insertInto("notifications").values({ id: randomUUID(), inspection_id: bundle.id, message, delivery_status: `dashboard:${sms === "sent" ? "sms-sent" : sms}`, read_at: null, created_at: now }).execute();
      response.json({ status: "Submitted", ownerNotification: sms });
    } catch (error) { next(error); }
  });

  app.get("/api/admin/inspection-setup", async (_request, response, next) => {
    try {
      const [clients, properties, technicians, propertyAudits, propertyNotifications] = await Promise.all([
        db.selectFrom("clients").selectAll().orderBy("company_name").execute(),
        db.selectFrom("properties").innerJoin("clients", "clients.id", "properties.client_id").select(["properties.id", "properties.client_id", "properties.name", "properties.address", "properties.active", "properties.created_at", "clients.company_name"]).orderBy("properties.name").execute(),
        db.selectFrom("technicians").select(["id", "name", "email", "active", "created_at"]).orderBy("name").execute(),
        db.selectFrom("property_audit_events").selectAll().orderBy("created_at", "desc").limit(200).execute(),
        db.selectFrom("property_notifications").selectAll().orderBy("created_at", "desc").limit(100).execute()
      ]);
      response.json({ clients, properties, technicians, propertyAudits: propertyAudits.map((event) => ({ ...event, details: JSON.parse(event.details_json) })), propertyNotifications, unreadPropertyNotifications: propertyNotifications.filter((item) => !item.read_at).length });
    } catch (error) { next(error); }
  });

  app.post("/api/admin/clients", async (request, response, next) => {
    try {
      const parsed = clientSchema.safeParse(request.body); if (!parsed.success) return response.status(400).json({ error: "Check the client details." });
      const id = randomUUID(); await db.insertInto("clients").values({ id, company_name: parsed.data.companyName, contact_name: parsed.data.contactName, email: parsed.data.email.toLowerCase(), phone: parsed.data.phone || null, created_at: new Date().toISOString() }).execute();
      response.status(201).json({ id });
    } catch (error) { next(error); }
  });

  app.post("/api/admin/properties", async (request, response, next) => {
    try {
      const parsed = propertySchema.safeParse(request.body); if (!parsed.success) return response.status(400).json({ error: "Check the property details." });
      const duplicate = await duplicateProperty(db, parsed.data.address); if (duplicate) return response.status(409).json({ error: `This address already exists as ${duplicate.name}.` });
      const id = randomUUID(); const now = new Date().toISOString(); await db.transaction().execute(async (transaction) => {
        await transaction.insertInto("properties").values({ id, client_id: parsed.data.clientId, name: parsed.data.name, address: parsed.data.address, created_at: now }).execute();
        await transaction.insertInto("property_audit_events").values({ id: randomUUID(), property_id: id, actor_type: "Owner", actor_id: config.adminUsername, action: "Created", details_json: JSON.stringify({ name: parsed.data.name, address: parsed.data.address, clientId: parsed.data.clientId }), created_at: now }).execute();
      });
      response.status(201).json({ id });
    } catch (error) { next(error); }
  });

  app.patch("/api/admin/properties/:id", async (request, response, next) => {
    try {
      const parsed = ownerPropertyUpdateSchema.safeParse(request.body); if (!parsed.success) return response.status(400).json({ error: "Check the property details." });
      const propertyId = routeParam(request, "id");
      const existing = await db.selectFrom("properties").selectAll().where("id", "=", propertyId).executeTakeFirst(); if (!existing) return response.status(404).json({ error: "Property not found." });
      const client = await db.selectFrom("clients").select("id").where("id", "=", parsed.data.clientId).executeTakeFirst(); if (!client) return response.status(404).json({ error: "Client not found." });
      const duplicate = await duplicateProperty(db, parsed.data.address, propertyId); if (duplicate) return response.status(409).json({ error: `This address already exists as ${duplicate.name}. Merge the records instead.` });
      const now = new Date().toISOString(); await db.transaction().execute(async (transaction) => {
        await transaction.updateTable("properties").set({ client_id: parsed.data.clientId, name: parsed.data.name, address: parsed.data.address }).where("id", "=", propertyId).execute();
        await transaction.insertInto("property_audit_events").values({ id: randomUUID(), property_id: propertyId, actor_type: "Owner", actor_id: config.adminUsername, action: "Edited", details_json: JSON.stringify({ before: { clientId: existing.client_id, name: existing.name, address: existing.address }, after: parsed.data }), created_at: now }).execute();
      });
      response.json({ id: propertyId });
    } catch (error) { next(error); }
  });

  app.post("/api/admin/properties/:id/archive", async (request, response, next) => {
    try {
      const propertyId = routeParam(request, "id"); const property = await db.selectFrom("properties").selectAll().where("id", "=", propertyId).executeTakeFirst(); if (!property) return response.status(404).json({ error: "Property not found." });
      const now = new Date().toISOString(); await db.transaction().execute(async (transaction) => {
        await transaction.updateTable("properties").set({ active: 0 }).where("id", "=", propertyId).execute();
        await transaction.insertInto("property_audit_events").values({ id: randomUUID(), property_id: propertyId, actor_type: "Owner", actor_id: config.adminUsername, action: "Archived", details_json: JSON.stringify({ name: property.name, address: property.address }), created_at: now }).execute();
        await transaction.updateTable("property_notifications").set({ read_at: now }).where("property_id", "=", propertyId).where("read_at", "is", null).execute();
      });
      response.status(204).end();
    } catch (error) { next(error); }
  });

  app.post("/api/admin/properties/:id/merge", async (request, response, next) => {
    try {
      const parsed = propertyMergeSchema.safeParse(request.body); if (!parsed.success) return response.status(400).json({ error: "Choose the property record to keep." });
      const sourceId = routeParam(request, "id"); if (sourceId === parsed.data.targetPropertyId) return response.status(400).json({ error: "Choose a different property to keep." });
      const [source, target] = await Promise.all([db.selectFrom("properties").selectAll().where("id", "=", sourceId).executeTakeFirst(), db.selectFrom("properties").selectAll().where("id", "=", parsed.data.targetPropertyId).where("active", "=", 1).executeTakeFirst()]);
      if (!source || !target) return response.status(404).json({ error: "Source or target property not found." });
      if (source.client_id !== target.client_id) return response.status(409).json({ error: "Properties must belong to the same client before they can be merged." });
      const now = new Date().toISOString(); await db.transaction().execute(async (transaction) => {
        await transaction.updateTable("inspections").set({ property_id: target.id }).where("property_id", "=", source.id).execute();
        await transaction.updateTable("properties").set({ active: 0 }).where("id", "=", source.id).execute();
        await transaction.insertInto("property_audit_events").values({ id: randomUUID(), property_id: source.id, actor_type: "Owner", actor_id: config.adminUsername, action: "Merged", details_json: JSON.stringify({ mergedIntoPropertyId: target.id, mergedIntoName: target.name }), created_at: now }).execute();
        await transaction.updateTable("property_notifications").set({ read_at: now }).where("property_id", "=", source.id).where("read_at", "is", null).execute();
      });
      response.json({ mergedIntoPropertyId: target.id });
    } catch (error) { next(error); }
  });

  app.post("/api/admin/properties/:id/notifications/read", async (request, response, next) => {
    try { await db.updateTable("property_notifications").set({ read_at: new Date().toISOString() }).where("property_id", "=", routeParam(request, "id")).where("read_at", "is", null).execute(); response.status(204).end(); } catch (error) { next(error); }
  });

  app.post("/api/admin/technicians", async (request, response, next) => {
    try {
      const parsed = technicianSchema.safeParse(request.body); if (!parsed.success) return response.status(400).json({ error: "Use a valid email and a password with at least 10 characters." });
      const id = randomUUID(); await db.insertInto("technicians").values({ id, name: parsed.data.name, email: parsed.data.email.toLowerCase(), password_hash: hashPassword(parsed.data.password), created_at: new Date().toISOString() }).execute();
      response.status(201).json({ id });
    } catch (error) { next(error); }
  });

  app.get("/api/admin/inspections", async (_request, response, next) => {
    try {
      const rows = await db.selectFrom("inspections").innerJoin("properties", "properties.id", "inspections.property_id").innerJoin("technicians", "technicians.id", "inspections.technician_id")
        .select(["inspections.id", "inspections.inspection_type", "inspections.status", "inspections.updated_at", "inspections.submitted_at", "properties.name as property_name", "properties.address", "technicians.name as technician_name"])
        .orderBy("inspections.updated_at", "desc").execute();
      const [unread, unreadProperties] = await Promise.all([db.selectFrom("notifications").select(({ fn }) => fn.count<number>("id").as("count")).where("read_at", "is", null).executeTakeFirst(), db.selectFrom("property_notifications").select(({ fn }) => fn.count<number>("id").as("count")).where("read_at", "is", null).executeTakeFirst()]);
      response.json({ inspections: rows, unreadNotifications: Number(unread?.count || 0) + Number(unreadProperties?.count || 0) });
    } catch (error) { next(error); }
  });

  app.get("/api/admin/inspections/:id", async (request, response, next) => {
    try {
      const bundle = await inspectionBundle(db, routeParam(request, "id")); if (!bundle) return response.status(404).json({ error: "Inspection not found." });
      await db.updateTable("notifications").set({ read_at: new Date().toISOString() }).where("inspection_id", "=", bundle.id).where("read_at", "is", null).execute();
      response.json({ inspection: bundle });
    } catch (error) { next(error); }
  });

  app.patch("/api/admin/inspections/:id/review", async (request, response, next) => {
    try {
      const parsed = inspectionReviewSchema.safeParse(request.body); if (!parsed.success) return response.status(400).json({ error: "Check the review and quote details.", fields: parsed.error.flatten() });
      const inspectionId = routeParam(request, "id");
      const existing = await db.selectFrom("inspections").select("status").where("id", "=", inspectionId).executeTakeFirst();
      if (!existing || !["Submitted", "Ready"].includes(existing.status)) return response.status(409).json({ error: "Only a submitted inspection can be reviewed." });
      const now = new Date().toISOString();
      await db.transaction().execute(async (transaction) => {
        for (const finding of parsed.data.findings) {
          await transaction.updateTable("inspection_findings").set({ title: finding.title, details: finding.details, priority: finding.priority, requires_approval: finding.requiresApproval ? 1 : 0, quote_description: finding.quoteDescription, quote_amount_cents: cents(finding.quoteAmount), updated_at: now }).where("id", "=", finding.id).where("inspection_id", "=", inspectionId).execute();
        }
        await transaction.updateTable("inspections").set({ review_note: parsed.data.reviewNote, status: parsed.data.status, reviewed_at: now, updated_at: now }).where("id", "=", inspectionId).execute();
      });
      response.json({ inspection: await inspectionBundle(db, inspectionId) });
    } catch (error) { next(error); }
  });

  app.post("/api/admin/inspections/:id/publish", async (request, response, next) => {
    try {
      const bundle = await inspectionBundle(db, routeParam(request, "id")); if (!bundle) return response.status(404).json({ error: "Inspection not found." });
      if (bundle.status !== "Ready") return response.status(409).json({ error: "Mark the reviewed inspection Ready before sending it." });
      const incomplete = bundle.findings.some((finding) => finding.requires_approval === 1 && (finding.quote_amount_cents === null || !finding.quote_description));
      if (incomplete) return response.status(400).json({ error: "Every repair requiring approval needs a description and price." });
      const token = createOpaqueToken(); const now = new Date(); const expires = new Date(now.getTime() + config.reportTokenDays * 86400000);
      await db.updateTable("inspections").set({ status: "Published", published_at: now.toISOString(), updated_at: now.toISOString(), report_token_hash: hashToken(token), report_expires_at: expires.toISOString() }).where("id", "=", bundle.id).execute();
      const reportUrl = `${config.publicBaseUrl}/report/${token}`;
      const email = await sendClientReportEmail(config, bundle.client_email, bundle.company_name, bundle.property_name, reportUrl);
      response.json({ reportUrl, expiresAt: expires.toISOString(), emailDelivery: email });
    } catch (error) { next(error); }
  });

  app.get("/api/admin/inspections/:inspectionId/media/:mediaId", async (request, response, next) => {
    try {
      const media = await db.selectFrom("inspection_media").selectAll().where("id", "=", routeParam(request, "mediaId")).where("inspection_id", "=", routeParam(request, "inspectionId")).executeTakeFirst();
      if (!media) return response.status(404).json({ error: "Media not found." });
      await sendMedia(config, media.storage_key, media.mime_type, response, request.get("range"));
    } catch (error) { next(error); }
  });

  app.get("/report/:token/media/:mediaId", async (request, response, next) => {
    try {
      const bundle = await inspectionForReportToken(db, routeParam(request, "token")); if (!bundle) return response.status(404).send("Report link is invalid or expired.");
      const media = bundle.media.find((item) => item.id === routeParam(request, "mediaId")); if (!media) return response.status(404).send("Media not found.");
      await sendMedia(config, media.storage_key, media.mime_type, response, request.get("range"));
    } catch (error) { next(error); }
  });

  app.post("/api/reports/:token/findings/:findingId/decision", decisionLimiter, async (request, response, next) => {
    try {
      const parsed = findingDecisionSchema.safeParse(request.body); if (!parsed.success) return response.status(400).json({ error: "Choose approve or decline." });
      const bundle = await inspectionForReportToken(db, routeParam(request, "token")); if (!bundle) return response.status(404).json({ error: "Report link is invalid or expired." });
      const finding = bundle.findings.find((item) => item.id === routeParam(request, "findingId") && item.requires_approval === 1);
      if (!finding) return response.status(404).json({ error: "Repair item not found." });
      const now = new Date().toISOString();
      const message = `${bundle.company_name} ${parsed.data.decision.toLowerCase()} “${finding.title}” for ${bundle.property_name}.`;
      const sms = await sendOwnerReviewText(config, message);
      await db.transaction().execute(async (transaction) => {
        await transaction.updateTable("inspection_findings").set({ decision: parsed.data.decision, client_comment: parsed.data.comment, decided_at: now, updated_at: now }).where("id", "=", finding.id).execute();
        await transaction.insertInto("inspection_decision_events").values({ id: randomUUID(), finding_id: finding.id, decision: parsed.data.decision, client_comment: parsed.data.comment, created_at: now }).execute();
        await transaction.insertInto("notifications").values({ id: randomUUID(), inspection_id: bundle.id, message, delivery_status: `dashboard:${sms === "sent" ? "sms-sent" : sms}`, read_at: null, created_at: now }).execute();
      });
      response.json({ decision: parsed.data.decision, decidedAt: now });
    } catch (error) { next(error); }
  });

  app.get("/report/:token", async (request, response, next) => {
    try {
      const reportToken = routeParam(request, "token");
      const bundle = await inspectionForReportToken(db, reportToken); if (!bundle) return response.status(404).type("html").send("<h1>Report unavailable</h1><p>This secure report link is invalid or has expired.</p>");
      const grouped = new Map<string, Array<{ label: string; answer: string; note: string }>>();
      for (const item of bundle.checklist as Array<{ section: string; label: string; answer: string; note: string }>) grouped.set(item.section, [...(grouped.get(item.section) || []), item]);
      const checklist = [...grouped].map(([section, items]) => `<section><h2>${escapeHtml(section)}</h2>${items.map((item) => `<div class="check"><b class="${item.answer === "Issue" ? "issue" : ""}">${escapeHtml(item.answer)}</b><span>${escapeHtml(item.label)}${item.note ? `<small>${escapeHtml(item.note)}</small>` : ""}</span></div>`).join("")}</section>`).join("");
      const photos = bundle.media.filter((item) => item.kind === "Photo").map((item) => `<figure><img src="/report/${escapeHtml(reportToken)}/media/${item.id}" alt="${escapeHtml(item.caption || item.category)}"><figcaption>${escapeHtml(item.caption || item.category)}</figcaption></figure>`).join("");
      const video = bundle.media.find((item) => item.kind === "Walkthrough");
      const findings = bundle.findings.map((finding) => `<article class="finding"><div><span class="priority">${escapeHtml(finding.priority)}</span><h3>${escapeHtml(finding.title)}</h3><p>${escapeHtml(finding.details)}</p><p><strong>${escapeHtml(finding.quote_description || "No repair approval requested")}</strong>${finding.requires_approval ? ` · ${dollars(finding.quote_amount_cents)}` : ""}</p></div>${finding.requires_approval ? `<form data-finding="${finding.id}"><textarea maxlength="2000" placeholder="Optional comment">${escapeHtml(finding.client_comment)}</textarea><div><button name="decision" value="Approved">Approve repair</button><button class="decline" name="decision" value="Declined">Decline</button></div><output>${escapeHtml(finding.decision === "Pending" ? "Awaiting decision" : finding.decision)}</output></form>` : `<span class="monitor">Information only</span>`}</article>`).join("") || "<p>No maintenance issues were reported.</p>";
      response.type("html").send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>TaskCore Inspection Report</title><link rel="stylesheet" href="/report-assets/report.css"><script src="/report-assets/report.js" defer></script></head><body><header><div class="shell"><div class="brand">TaskCore Property Report</div><h1>${escapeHtml(bundle.property_name)}</h1><div class="meta">${escapeHtml(bundle.address)}<br>${escapeHtml(bundle.inspection_type)} inspection · ${escapeHtml(new Date(bundle.submitted_at || bundle.created_at).toLocaleString())}<br>Completed by ${escapeHtml(bundle.technician_name)}</div></div></header><main class="shell"><section><h2>Inspection summary</h2><p>${escapeHtml(bundle.summary || "No additional summary.")}</p></section>${checklist}<section><h2>Property photos</h2><div class="media">${photos}</div>${video ? `<h3>Walkthrough video</h3><video controls preload="metadata" src="/report/${escapeHtml(reportToken)}/media/${video.id}"></video>` : ""}</section><section><h2>Maintenance findings and quotes</h2>${findings}</section></main></body></html>`);
    } catch (error) { next(error); }
  });
}
