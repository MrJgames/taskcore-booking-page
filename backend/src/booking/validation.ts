import { z } from "zod";

export const availabilityQuerySchema = z.object({ serviceId: z.string().min(1).max(100), days: z.coerce.number().int().min(1).max(31).optional() }).strict();
export const checkoutSchema = z.object({
  serviceId: z.string().min(1).max(100), slotId: z.string().min(20).max(4096),
  name: z.string().trim().min(2).max(100), phone: z.string().trim().refine((value) => { const length = value.replace(/\D/g, "").length; return length >= 10 && length <= 15; }, "Enter a valid phone number."),
  email: z.string().trim().email().max(254).optional().or(z.literal("")), address: z.string().trim().min(5).max(250), notes: z.string().trim().max(1000).optional()
}).strict();
export const paymentTokenSchema = z.string().min(20).max(4096);
