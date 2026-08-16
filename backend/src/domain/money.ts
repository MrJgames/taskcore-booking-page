export type DepositRule = { kind: "fixed"; amountCents: number } | { kind: "percentage"; basisPoints: number };
export interface DepositConfiguration { defaultRule: DepositRule; serviceOverrides?: Readonly<Record<string, DepositRule>>; }

// Development placeholder only. TaskCore must approve the production policy.
export const DEVELOPMENT_DEPOSIT_CONFIGURATION: DepositConfiguration = {
  defaultRule: { kind: "fixed", amountCents: 5_000 }, serviceOverrides: {}
};

function assertCents(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label} must be a non-negative integer number of cents.`);
}
export function calculateDepositCents(totalCents: number, serviceType: string, config: DepositConfiguration): number {
  assertCents(totalCents, "Total");
  const rule = config.serviceOverrides?.[serviceType] ?? config.defaultRule;
  if (rule.kind === "fixed") { assertCents(rule.amountCents, "Fixed deposit"); return Math.min(totalCents, rule.amountCents); }
  if (!Number.isSafeInteger(rule.basisPoints) || rule.basisPoints < 0 || rule.basisPoints > 10_000) {
    throw new Error("Deposit percentage must be between 0 and 10,000 basis points.");
  }
  return Math.min(totalCents, Math.round((totalCents * rule.basisPoints) / 10_000));
}
export function calculateRemainingBalanceCents(totalCents: number, paidCents: number): number {
  assertCents(totalCents, "Total"); assertCents(paidCents, "Paid amount");
  return Math.max(0, totalCents - paidCents);
}
