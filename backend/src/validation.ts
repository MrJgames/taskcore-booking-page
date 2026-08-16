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

const singleLine = (requiredMessage: string, minimum: number, minimumMessage: string, maximum: number, maximumMessage: string) => z
  .string({ required_error: requiredMessage, invalid_type_error: requiredMessage })
  .transform(normalizeSingleLine)
  .pipe(z.string().min(minimum, minimumMessage).max(maximum, maximumMessage));
const optionalEmail = z.preprocess(
  (value) => typeof value === "string" && !value.trim() ? undefined : value,
  z.string({ invalid_type_error: "Please enter a valid email address." })
    .transform(normalizeSingleLine)
    .pipe(z.string().email("Please enter a valid email address.").max(254, "Please keep the email address under 255 characters."))
    .optional()
);

function isValidServiceDate(value: string): boolean {
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) return false;
  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  return date >= today;
}

export const serviceRequestSchema = z.object({
  name: singleLine("Please enter your name.", 2, "Please enter your name using at least 2 characters.", 100, "Please keep your name under 101 characters."),
  phone: singleLine("Please enter your phone number.", 1, "Please enter your phone number.", 30, "Please keep the phone number under 31 characters.").refine((value) => {
    const digits = value.replace(/\D/g, "");
    return digits.length >= 10 && digits.length <= 15;
  }, "Please enter a valid phone number with 10 to 15 digits."),
  email: optionalEmail,
  address: singleLine("Please enter the service address.", 5, "Please enter a service address using at least 5 characters.", 250, "Please keep the service address under 251 characters."),
  issue: z.string({ required_error: "Please describe the issue.", invalid_type_error: "Please describe the issue." })
    .transform(normalizeMultiline)
    .pipe(z.string().min(10, "Please describe the issue using at least 10 characters.").max(2000, "Please keep the issue description under 2,001 characters.")),
  contactMethod: z.enum(CONTACT_METHODS, { required_error: "Please choose a preferred contact method.", invalid_type_error: "Please choose Call, Text, or Email." }),
  appointmentDate: z.string({ required_error: "Please choose a preferred service date.", invalid_type_error: "Please choose a valid service date." })
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Please choose a valid service date.")
    .refine(isValidServiceDate, "Please choose today or a future date."),
  arrivalWindow: z.enum(ARRIVAL_WINDOWS, { required_error: "Please choose an arrival window.", invalid_type_error: "Please choose one of the available arrival windows." }),
  submissionTimestamp: z.string().datetime({ offset: true }).optional()
}).superRefine((value, context) => {
  if (value.contactMethod === "Email" && !value.email) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["email"], message: "Please enter an email address when Email is your preferred contact method." });
  }
});

export const adminUpdateSchema = z.object({
  status: z.enum(REQUEST_STATUSES).optional(),
  privateNote: z.string().transform(normalizeMultiline).pipe(z.string().max(2000)).optional()
}).refine((value) => value.status !== undefined || value.privateNote !== undefined, "Provide a status or private note.");

export type ServiceRequestInput = z.infer<typeof serviceRequestSchema>;
