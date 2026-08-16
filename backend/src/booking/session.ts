import { createHmac, timingSafeEqual } from "node:crypto";

export class SignedSessionError extends Error {
  constructor(readonly reason: "invalid" | "expired" | "mismatch") { super(`Signed session ${reason}.`); }
}
interface SignedEnvelope { type: "slot" | "payment"; exp: number; [key: string]: unknown; }
export interface SlotSession extends SignedEnvelope { type: "slot"; serviceId: string; start: string; end: string; timezone: string; }
export interface PaymentSession extends SignedEnvelope { type: "payment"; bookingId: string; customerId: string; }

export function signSession(payload: SignedEnvelope, secret: string): string {
  if (secret.length < 32) throw new Error("PAYMENT_SESSION_SECRET must contain at least 32 characters.");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${createHmac("sha256", secret).update(body).digest("base64url")}`;
}

export function verifySession<T extends SignedEnvelope>(token: string, secret: string, expectedType: T["type"], now = new Date()): T {
  const [body, supplied, extra] = token.split(".");
  if (!body || !supplied || extra) throw new SignedSessionError("invalid");
  const expected = createHmac("sha256", secret).update(body).digest();
  let actual: Buffer;
  try { actual = Buffer.from(supplied, "base64url"); } catch { throw new SignedSessionError("invalid"); }
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw new SignedSessionError("invalid");
  let payload: T;
  try { payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as T; } catch { throw new SignedSessionError("invalid"); }
  if (payload.type !== expectedType) throw new SignedSessionError("mismatch");
  if (!Number.isSafeInteger(payload.exp) || payload.exp <= Math.floor(now.getTime() / 1000)) throw new SignedSessionError("expired");
  return payload;
}
