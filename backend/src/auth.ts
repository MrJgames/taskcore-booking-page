import { timingSafeEqual } from "node:crypto";
import type { RequestHandler } from "express";
import type { AppConfig } from "./config.js";

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
