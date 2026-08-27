import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type { RequestHandler } from "express";
import type { Kysely } from "kysely";
import type { AppConfig } from "./config.js";
import type { TaskCoreDatabase } from "./types.js";

function safelyEqual(actual: string, expected: string): boolean {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

export function createAdminAuth(config: AppConfig): RequestHandler {
  return (request, response, next) => {
    const [scheme, encoded] = (request.get("authorization") || "").split(" ");
    if (scheme !== "Basic" || !encoded) {
      response.set("WWW-Authenticate", 'Basic realm="TaskCore Admin", charset="UTF-8"');
      response.status(401).json({ error: "Administrator authentication is required." });
      return;
    }

    let credentials = "";
    try {
      credentials = Buffer.from(encoded, "base64").toString("utf8");
    } catch {
      response.status(401).json({ error: "Administrator authentication is required." });
      return;
    }
    const separator = credentials.indexOf(":");
    const username = separator >= 0 ? credentials.slice(0, separator) : "";
    const password = separator >= 0 ? credentials.slice(separator + 1) : "";

    const validUsername = safelyEqual(username, config.adminUsername);
    const validPassword = safelyEqual(password, config.adminPassword);
    if (!validUsername || !validPassword) {
      response.set("WWW-Authenticate", 'Basic realm="TaskCore Admin", charset="UTF-8"');
      response.status(401).json({ error: "Administrator authentication is required." });
      return;
    }
    next();
  };
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, expectedHex] = stored.split(":");
  if (!salt || !expectedHex) return false;
  const actual = scryptSync(password, salt, 64);
  const expected = Buffer.from(expectedHex, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function createOpaqueToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function cookieValue(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return decodeURIComponent(value.join("="));
  }
  return undefined;
}

export type TechnicianRequest = Parameters<RequestHandler>[0] & { technician?: { id: string; name: string; email: string }; technicianSessionId?: string };

export function createTechnicianAuth(db: Kysely<TaskCoreDatabase>, config: AppConfig): RequestHandler {
  return async (request: TechnicianRequest, response, next) => {
    try {
      const token = cookieValue(request.get("cookie"), "taskcore_tech_session");
      if (!token) {
        response.status(401).json({ error: "Technician sign-in is required." });
        return;
      }
      const now = new Date().toISOString();
      const row = await db.selectFrom("technician_sessions")
        .innerJoin("technicians", "technicians.id", "technician_sessions.technician_id")
        .select(["technicians.id", "technicians.name", "technicians.email", "technician_sessions.id as session_id", "technician_sessions.created_at"])
        .where("technician_sessions.token_hash", "=", hashToken(token))
        .where("technician_sessions.expires_at", ">", now)
        .where("technicians.active", "=", 1)
        .executeTakeFirst();
      if (!row) {
        response.status(401).json({ error: "Your technician session has expired." });
        return;
      }
      const absoluteExpires = new Date(new Date(row.created_at).getTime() + config.technicianAbsoluteSessionMs);
      if (absoluteExpires <= new Date()) {
        await db.deleteFrom("technician_sessions").where("id", "=", row.session_id).execute();
        response.status(401).json({ error: "Reauthentication required.", code: "REAUTH_REQUIRED" }); return;
      }
      const idleExpires = new Date(Math.min(Date.now() + config.technicianIdleSessionMs, absoluteExpires.getTime()));
      await db.updateTable("technician_sessions").set({ expires_at: idleExpires.toISOString() }).where("id", "=", row.session_id).execute();
      response.cookie("taskcore_tech_session", token, { httpOnly: true, sameSite: "strict", secure: config.nodeEnv === "production", expires: idleExpires, path: "/" });
      request.technician = { id: row.id, name: row.name, email: row.email };
      request.technicianSessionId = row.session_id;
      next();
    } catch (error) {
      next(error);
    }
  };
}
