import type { DepositConfiguration } from "../domain/money.js";
import { calculateDepositCents } from "../domain/money.js";

export interface BookableService {
  id: string; displayName: string; description: string; durationMinutes: number; directlyBookable: boolean;
  price: { kind: "fixed"; totalCents: number } | { kind: "quote_required" };
  preparationInstructions?: string; scheduling: { weekdays: readonly number[]; localStartHours: readonly number[] };
  developmentPlaceholder?: boolean;
}

const quoteRequired: readonly BookableService[] = [
  { id: "installation", displayName: "Home Technology Installation", description: "Installation and setup scoped to your home and equipment.", durationMinutes: 120, directlyBookable: false, price: { kind: "quote_required" }, scheduling: { weekdays: [1, 2, 3, 4, 5], localStartHours: [9, 11, 13, 15] } },
  { id: "troubleshooting", displayName: "Troubleshooting & Support", description: "Diagnosis and support when the required work is not yet known.", durationMinutes: 120, directlyBookable: false, price: { kind: "quote_required" }, scheduling: { weekdays: [1, 2, 3, 4, 5], localStartHours: [9, 11, 13, 15] } }
];

// Local development only; this is not an approved production offering or price.
const developmentService: BookableService = {
  id: "development-demo-appointment", displayName: "Development Demo Appointment",
  description: "Local-only booking flow verification. Not a published TaskCore service or price.",
  durationMinutes: 120, directlyBookable: true, price: { kind: "fixed", totalCents: 20_000 },
  preparationInstructions: "Development placeholder: final customer instructions require TaskCore approval.",
  scheduling: { weekdays: [1, 2, 3, 4, 5], localStartHours: [9, 11, 13, 15] }, developmentPlaceholder: true
};

export function configuredServices(nodeEnv: string): readonly BookableService[] {
  return nodeEnv === "production" ? quoteRequired : [...quoteRequired, developmentService];
}

export function publicService(service: BookableService, depositConfig: DepositConfiguration) {
  const totalCents = service.price.kind === "fixed" ? service.price.totalCents : null;
  return { id: service.id, displayName: service.displayName, description: service.description,
    durationMinutes: service.durationMinutes, directlyBookable: service.directlyBookable && totalCents !== null,
    pricing: totalCents === null ? { kind: "quote_required" as const } : { kind: "fixed" as const, totalCents,
      depositCents: calculateDepositCents(totalCents, service.id, depositConfig), currency: "USD" },
    preparationInstructions: service.preparationInstructions ?? null,
    developmentPlaceholder: Boolean(service.developmentPlaceholder) };
}
