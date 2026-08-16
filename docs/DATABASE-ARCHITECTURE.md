# TaskCore Database and Domain Architecture

## Authority and boundaries

TaskCore's relational database is authoritative for customers, holds, bookings, jobs, payment state, deposits, balances, and integration work. Payment processors may report financial events, but server-side verification and idempotent database transitions determine TaskCore state. Calendar systems are downstream projections only.

Square and Google Calendar APIs are not implemented in Phase 4.

## Versioned migrations

The backend uses Kysely's `Migrator` with ordered migrations defined in `backend/src/migrations.ts`:

1. `001_existing_service_requests` adopts or creates the existing table and index without replacing data.
2. `002_booking_payment_foundation` adds the Phase 4 domain tables and constraints.
3. `003_square_payment_foundation` adds authoritative booking quote totals, cumulative refund tracking, and outbox deduplication.

Application startup runs outstanding migrations before Express listens. Migration history is recorded in Kysely's migration tables. Do not point local commands at production.

From `backend/`, local commands are:

```text
npm run migrate:up
npm run migrate:down
```

The CLI refuses to run when `NODE_ENV=production`. The first migration has an intentionally non-destructive down migration because it adopts the historical `service_requests` table. The second migration can remove the Phase 4 tables in reverse dependency order, but rollback should only be used on disposable local/test databases after confirming no needed data exists.

## Tables and relationships

- `service_requests`: unchanged estimate/request intake; independent from bookings.
- `customers`: contact and service-address records; no login required.
- `booking_holds`: short-lived reservation attempts owned by customers.
- `bookings`: appointment records, optionally originating from a hold.
- `jobs`: one operational job per booking, with integer-cent totals and balances.
- `payments`: provider-neutral payment attempts linked to a booking and customer.
- `payment_events`: provider-event receipt ledger with provider/event uniqueness.
- `integration_outbox`: downstream work and retry state without external-system authority.
- `slot_reservations`: cross-database exclusivity guard for canonical appointment slots.

Foreign keys restrict deletion of customers, bookings, and payments that own business history. Provider payment IDs are nullable until assigned. Payment idempotency keys are unique per provider, and provider event IDs are unique per provider.

No sensitive card data or full provider payload is stored.

## State machines

Booking transitions:

```text
pending_payment -> confirmed | expired | cancelled
confirmed       -> completed | cancelled
```

Payment transitions:

```text
pending            -> paid | failed
paid               -> partially_refunded | refunded
partially_refunded -> refunded
```

Hold transitions:

```text
active -> consumed | expired | cancelled
```

Terminal states cannot be reused without a future explicit restoration workflow.

## Deposit configuration

`backend/src/domain/money.ts` centralizes fixed-cent and percentage/basis-point rules plus service-specific overrides. All results are integer cents. The exported development default is clearly non-production and does not establish TaskCore's permanent deposit policy.

Remaining balance is calculated from integer cents and cannot become negative.

## Hold expiration and slot concurrency

Every canonical appointment interval maps to one deterministic `slot_key`. `slot_reservations.slot_key` is the primary key, so both SQLite and PostgreSQL reject a second owner for that exact slot. Hold creation and slot reservation occur in one transaction.

Before a new hold is created, expired reservations are removed and their active hold or pending-payment booking is marked expired. Consuming a hold transfers the reservation to a pending-payment booking. Confirmation removes the expiration; cancellation, completion, or expiry releases the slot.

This strategy requires the future availability service to issue canonical, non-overlapping slots. Arbitrary overlapping intervals with different start/end values are not detected by the current unique key. A future PostgreSQL exclusion constraint could strengthen interval overlap protection, but it would require a documented SQLite equivalent and a rehearsed production migration.

## Existing service requests

The existing quote/request workflow remains independent. Nothing forces historical or new service requests into customers, bookings, or jobs. A future protected admin action may convert a request by creating related domain records without deleting or duplicating the original request.

## Future integrations

Square belongs behind the provider-neutral payments and payment-events boundary. Signed, deduplicated events must drive guarded transitions; duplicate events must not reapply money state.

Google Calendar belongs behind `integration_outbox`. Calendar create/update/cancel failures remain retryable and never alter booking or payment truth.
