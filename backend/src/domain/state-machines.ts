import type { BookingHoldStatus, BookingStatus, PaymentStatus } from "../types.js";

const bookingTransitions: Record<BookingStatus, readonly BookingStatus[]> = {
  pending_payment: ["confirmed", "expired", "cancelled"], confirmed: ["completed", "cancelled"],
  cancelled: [], completed: [], expired: []
};
const paymentTransitions: Record<PaymentStatus, readonly PaymentStatus[]> = {
  pending: ["paid", "failed"], paid: ["partially_refunded", "refunded"], failed: [],
  partially_refunded: ["refunded"], refunded: []
};
const holdTransitions: Record<BookingHoldStatus, readonly BookingHoldStatus[]> = {
  active: ["consumed", "expired", "cancelled"], consumed: [], expired: [], cancelled: []
};

function assertTransition<T extends string>(name: string, transitions: Record<T, readonly T[]>, from: T, to: T): void {
  if (!transitions[from].includes(to)) throw new Error(`Invalid ${name} transition: ${from} -> ${to}`);
}
export function assertBookingTransition(from: BookingStatus, to: BookingStatus): void { assertTransition("booking", bookingTransitions, from, to); }
export function assertPaymentTransition(from: PaymentStatus, to: PaymentStatus): void { assertTransition("payment", paymentTransitions, from, to); }
export function assertHoldTransition(from: BookingHoldStatus, to: BookingHoldStatus): void { assertTransition("booking hold", holdTransitions, from, to); }
