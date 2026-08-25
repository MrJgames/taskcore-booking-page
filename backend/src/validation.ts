import { z } from "zod";
import { FINDING_PRIORITIES, INSPECTION_TYPES, REQUEST_STATUSES } from "./types.js";

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

export const technicianLoginSchema = z.object({
  email: z.string().transform(normalizeSingleLine).pipe(z.string().email().max(254)),
  password: z.string().min(10).max(200)
});

export const clientSchema = z.object({
  companyName: singleLine(2, 140),
  contactName: singleLine(2, 100),
  email: z.string().transform(normalizeSingleLine).pipe(z.string().email().max(254)),
  phone: z.preprocess((value) => typeof value === "string" && !value.trim() ? undefined : value, singleLine(7, 30).optional())
});

export const propertySchema = z.object({
  clientId: z.string().uuid(),
  name: singleLine(2, 140),
  address: singleLine(5, 250)
});

export const technicianSchema = z.object({
  name: singleLine(2, 100),
  email: z.string().transform(normalizeSingleLine).pipe(z.string().email().max(254)),
  password: z.string().min(10).max(200)
});

export const createInspectionSchema = z.object({
  propertyId: z.string().uuid(),
  inspectionType: z.enum(INSPECTION_TYPES)
});

export const checklistResponseSchema = z.object({
  key: singleLine(1, 80),
  section: singleLine(1, 80),
  label: singleLine(2, 180),
  answer: z.enum(["Pass", "Issue", "N/A"]),
  note: z.string().transform(normalizeMultiline).pipe(z.string().max(1000)).default("")
});

export const findingInputSchema = z.object({
  id: z.string().uuid().optional(),
  title: singleLine(2, 160),
  details: z.string().transform(normalizeMultiline).pipe(z.string().min(2).max(3000)),
  priority: z.enum(FINDING_PRIORITIES)
});

export const inspectionDraftSchema = z.object({
  summary: z.string().transform(normalizeMultiline).pipe(z.string().max(3000)).default(""),
  checklist: z.array(checklistResponseSchema).min(1).max(100),
  findings: z.array(findingInputSchema).max(40)
});

export const inspectionReviewSchema = z.object({
  reviewNote: z.string().transform(normalizeMultiline).pipe(z.string().max(3000)).default(""),
  status: z.enum(["Needs Changes", "Ready"]),
  findings: z.array(z.object({
    id: z.string().uuid(),
    title: singleLine(2, 160),
    details: z.string().transform(normalizeMultiline).pipe(z.string().min(2).max(3000)),
    priority: z.enum(FINDING_PRIORITIES),
    requiresApproval: z.boolean(),
    quoteDescription: z.string().transform(normalizeMultiline).pipe(z.string().max(2000)).default(""),
    quoteAmount: z.number().min(0).max(100000).nullable()
  })).max(40)
});

export const findingDecisionSchema = z.object({
  decision: z.enum(["Approved", "Declined"]),
  comment: z.string().transform(normalizeMultiline).pipe(z.string().max(2000)).default("")
});

export type ServiceRequestInput = z.infer<typeof serviceRequestSchema>;
