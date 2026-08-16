import { z } from "zod";

export const depositPaymentSchema = z.object({
  sourceToken: z.string().min(1).max(2048),
  requestId: z.string().regex(/^[A-Za-z0-9_-]{8,100}$/),
  paymentSessionToken: z.string().min(20).max(4096),
  verificationToken: z.string().min(1).max(2048).optional()
}).strict();

export const bookingIdSchema = z.string().uuid();
