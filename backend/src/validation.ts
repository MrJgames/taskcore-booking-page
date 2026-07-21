import { z } from "zod";
import { REQUEST_STATUSES } from "./types.js";

export const ARRIVAL_WINDOWS = ["8 AM–10 AM", "10 AM–12 PM", "12 PM–3 PM", "3 PM–5 PM", "Flexible"] as const;
export const CONTACT_METHODS = ["Call", "Text", "Email"] as const;

function normalizeSingleLine(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
}

function normalizeMultiline(value: string): string {
  return value.replace(/\u0000/g, "").replace(/\r\n?/g, "\n").replace(/[\t\f\v]+/g, " ").trim();
}

const singleLine = (minimum: number, maximum: number) => z.string().transform(normalizeSingleLine).pipe(z.string().min(minimum).max(maximum));
const optionalEmail = z.preprocess(
  (value) => typeof value === "string" && !value.trim() ? undefined : value,
  z.string().transform(normalizeSingleLine).pipe(z.string().email().max(254)).optional()
);

function isValidServiceDate(value: string): boolean {
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) return false;
  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  return date >= today;
}

export const serviceRequestSchema = z.object({
  name: singleLine(2, 100),
  phone: singleLine(7, 30).refine((value) => {
    const digits = value.replace(/\D/g, "");
    return digits.length >= 10 && digits.length <= 15;
  }, "Enter a valid phone number."),
  email: optionalEmail,
  address: singleLine(5, 250),
  issue: z.string().transform(normalizeMultiline).pipe(z.string().min(10).max(2000)),
  contactMethod: z.enum(CONTACT_METHODS),
  appointmentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a valid date.").refine(isValidServiceDate, "Choose today or a future date."),
  arrivalWindow: z.enum(ARRIVAL_WINDOWS),
  submissionTimestamp: z.string().datetime({ offset: true }).optional()
}).superRefine((value, context) => {
  if (value.contactMethod === "Email" && !value.email) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["email"], message: "Email is required when email is the preferred contact method." });
  }
});

export const adminUpdateSchema = z.object({
  status: z.enum(REQUEST_STATUSES).optional(),
  privateNote: z.string().transform(normalizeMultiline).pipe(z.string().max(2000)).optional()
}).refine((value) => value.status !== undefined || value.privateNote !== undefined, "Provide a status or private note.");

export type ServiceRequestInput = z.infer<typeof serviceRequestSchema>;
