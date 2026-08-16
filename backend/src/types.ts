import type { Generated } from "kysely";

export const REQUEST_STATUSES = ["New", "Contacted", "Scheduled", "Completed", "Declined"] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

export interface ServiceRequestsTable {
  id: string;
  created_at: string;
  customer_name: string;
  phone: string;
  email: string | null;
  service_address: string;
  issue_description: string;
  preferred_contact_method: string;
  preferred_service_date: string;
  requested_arrival_window: string;
  submitted_at: string;
  status: RequestStatus;
  private_note: Generated<string | null>;
  updated_at: string;
}

export const BOOKING_HOLD_STATUSES = ["active", "consumed", "expired", "cancelled"] as const;
export type BookingHoldStatus = (typeof BOOKING_HOLD_STATUSES)[number];

export const BOOKING_STATUSES = ["pending_payment", "confirmed", "cancelled", "completed", "expired"] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

export const JOB_STATUSES = ["scheduled", "in_progress", "completed", "cancelled"] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const PAYMENT_STATUSES = ["pending", "paid", "failed", "refunded", "partially_refunded"] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const PAYMENT_TYPES = ["deposit", "final", "refund"] as const;
export type PaymentType = (typeof PAYMENT_TYPES)[number];

export const PAYMENT_EVENT_STATUSES = ["pending", "processed", "failed", "ignored"] as const;
export type PaymentEventStatus = (typeof PAYMENT_EVENT_STATUSES)[number];

export const OUTBOX_STATUSES = ["pending", "processing", "completed", "failed"] as const;
export type OutboxStatus = (typeof OUTBOX_STATUSES)[number];

export interface CustomersTable {
  id: string;
  name: string;
  email: string | null;
  phone: string;
  service_address: string;
  created_at: string;
  updated_at: string;
}

export interface BookingHoldsTable {
  id: string;
  customer_id: string;
  service_type: string;
  requested_start: string;
  requested_end: string;
  timezone: string;
  status: BookingHoldStatus;
  expires_at: string;
  created_at: string;
  updated_at: string;
}

export interface BookingsTable {
  id: string;
  customer_id: string;
  booking_hold_id: string | null;
  service_type: string;
  requested_start: string;
  requested_end: string;
  timezone: string;
  status: BookingStatus;
  notes: Generated<string | null>;
  quoted_total_cents: number | null;
  created_at: string;
  updated_at: string;
}

export interface JobsTable {
  id: string;
  customer_id: string;
  booking_id: string;
  service: string;
  address: string;
  scheduled_start: string;
  scheduled_end: string;
  status: JobStatus;
  quoted_total_cents: number;
  deposit_amount_cents: number;
  remaining_balance_cents: number;
  payment_status: PaymentStatus;
  created_at: string;
  updated_at: string;
}

export interface PaymentsTable {
  id: string;
  booking_id: string;
  customer_id: string;
  provider: string;
  provider_payment_id: string | null;
  type: PaymentType;
  amount_cents: number;
  currency: string;
  status: PaymentStatus;
  refunded_amount_cents: Generated<number>;
  idempotency_key: string;
  created_at: string;
  updated_at: string;
}

export interface PaymentEventsTable {
  id: string;
  provider: string;
  provider_event_id: string;
  event_type: string;
  payment_id: string | null;
  processing_status: PaymentEventStatus;
  error_summary: Generated<string | null>;
  received_at: string;
  processed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface IntegrationOutboxTable {
  id: string;
  aggregate_type: string;
  aggregate_id: string;
  integration: string;
  action: string;
  dedupe_key: string | null;
  status: OutboxStatus;
  external_id: string | null;
  retry_count: Generated<number>;
  last_error_summary: Generated<string | null>;
  available_at: string;
  created_at: string;
  updated_at: string;
}

export interface SlotReservationsTable {
  slot_key: string;
  hold_id: string | null;
  booking_id: string | null;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface TaskCoreDatabase {
  service_requests: ServiceRequestsTable;
  customers: CustomersTable;
  booking_holds: BookingHoldsTable;
  bookings: BookingsTable;
  jobs: JobsTable;
  payments: PaymentsTable;
  payment_events: PaymentEventsTable;
  integration_outbox: IntegrationOutboxTable;
  slot_reservations: SlotReservationsTable;
}
