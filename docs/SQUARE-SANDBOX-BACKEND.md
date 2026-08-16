# TaskCore Square Sandbox Backend

Customer browser Square Web Payments UI is NOT implemented in Phase 5.

## Official implementation assumptions

This implementation was checked against current official Square documentation on August 15, 2026:

- Web Payments SDK produces a secure single-use token that the browser sends to the backend as the Payments API `source_id`.
- Payment amounts are sent in the currency's smallest denomination, so TaskCore sends integer cents.
- `CreatePayment` uses a stable idempotency key. Repeating the logical request uses the same key.
- An automatic-capture payment is successful only when Square reports `COMPLETED`.
- `APPROVED` and `PENDING` remain pending in TaskCore; `CANCELED` and `FAILED` map to failed.
- Square signs the exact notification URL plus raw request body. Validation uses `x-square-hmacsha256-signature` and the official SDK helper.
- Payment and refund notifications can be retried, so TaskCore records and deduplicates provider event IDs.
- Completed refunds can be partial or full and do not automatically cancel bookings.

Official references:

- https://developer.squareup.com/docs/web-payments/overview
- https://developer.squareup.com/docs/payments-refunds
- https://developer.squareup.com/docs/payments-api/webhooks
- https://developer.squareup.com/docs/webhooks/step3validate
- https://developer.squareup.com/docs/payments-api/refund-payments
- https://github.com/square/square-nodejs-sdk

## SDK and provider boundary

The backend pins the official `square` Node SDK at `45.0.1`. `PaymentProvider` is provider-neutral. `SquarePaymentProvider` owns SDK construction, Sandbox/Production endpoint selection, Payments API calls, response normalization, and webhook signature verification. Routes and domain services depend only on the provider-neutral interface.

Automated tests inject deterministic mock providers and never call Square.

## Environment variables

All values are required together to enable Square:

```text
SQUARE_ENVIRONMENT=sandbox
SQUARE_ACCESS_TOKEN=
SQUARE_APPLICATION_ID=
SQUARE_LOCATION_ID=
SQUARE_WEBHOOK_SIGNATURE_KEY=
SQUARE_WEBHOOK_NOTIFICATION_URL=
```

No credential may be committed or logged. Sandbox configuration is rejected with `NODE_ENV=production`, and production Square configuration is rejected outside production.

## Deposit payment endpoint

```text
POST /api/bookings/:bookingId/deposit-payment
```

Accepted JSON fields:

```text
sourceToken
requestId
verificationToken (optional)
```

The strict input schema rejects amounts, customer IDs, quoted totals, balances, or statuses supplied by the browser. TaskCore loads the booking and customer, verifies the reservation, reads the authoritative quoted total, and calculates the deposit from server configuration.

## Idempotency

TaskCore hashes the booking ID and client request ID into a stable Square-compatible idempotency key. The local `payments(provider, idempotency_key)` unique index prevents duplicate logical payments. Transport retries reuse the local pending payment and the same Square key. A paid replay reuses the existing payment, job, and outbox record without another provider call.

Use a new client request ID only for a genuinely new attempt, such as retrying with another payment method after a terminal decline.

## Atomic confirmation

After Square reports `COMPLETED`, one TaskCore database transaction:

1. Verifies payment, booking, customer, currency, amount, and unexpired reservation.
2. Marks the payment paid and records the provider payment ID.
3. Confirms the booking.
4. Makes the slot reservation durable.
5. Creates or updates the one job for the booking.
6. Stores quoted total, deposit, remaining balance, and payment state in integer cents.
7. Enqueues one deduplicated downstream Calendar-create item.

If Square succeeds but this transaction fails, Square cannot be rolled back by the database. Square receives the local payment ID as `reference_id`; a signed payment webhook can locate the pending local record and retry the same idempotent confirmation transaction. Failed webhook processing is retained with a short error summary and returns an error so Square can retry. Persistent failures require operator reconciliation before the reservation expires or is manually resolved.

## Webhooks

```text
POST /api/webhooks/square
```

This route uses an isolated raw-body parser before the application's normal JSON parser. It verifies the signature before trusting or parsing JSON. Invalid signatures receive 403. Valid event IDs are recorded once per provider. Processed or ignored duplicates receive success without reapplying state; failed events are eligible for retry.

Payment webhooks use the same atomic confirmation workflow as synchronous requests. Refund webhooks update cumulative refunded cents and normalized payment/job payment status without cancelling the booking.

## Refund mapping

```text
Square completed refund below payment total → partially_refunded
Square cumulative refund at payment total   → refunded
```

Pending, failed, or rejected refund events do not change TaskCore financial state. Booking cancellation remains a separate explicit business decision.

## Security boundary

- TaskCore never accepts or stores PAN, CVV, or raw card details.
- Only the Square-generated source token reaches this backend.
- Tokens are passed directly to the provider and are not persisted or logged.
- Deposit amounts are calculated server-side.
- The payment route has rate limiting plus existing Helmet, CORS, and body limits.
- Provider errors are replaced with customer-safe messages.
- This architecture reduces direct card-data handling but does not claim PCI compliance.

## Local verification

```text
cd backend
npm test
npm run build
```

Tests cover successful, failed, repeated, and retried payments; amount tampering; expired reservations; job/outbox idempotency; signature rejection; webhook recovery; duplicate events; and refund normalization.

## Manual Sandbox smoke-test checklist

This checklist requires separately supplied Sandbox credentials and is not part of automated verification:

1. Configure all Square variables with Sandbox-only values.
2. Configure the exact public webhook notification URL in Square Sandbox.
3. Create a disposable local/staging booking with a quote and active reservation.
4. Generate a Sandbox token through the future Web Payments UI or an approved Square Sandbox test flow.
5. Submit one deposit and verify Square reports `COMPLETED`.
6. Verify exactly one payment, confirmed booking, job, and outbox item.
7. Replay the same request ID and verify no second charge.
8. Replay the webhook and verify no duplicate state.
9. Exercise a documented Sandbox decline token and verify the booking remains pending.
10. Remove all temporary test records and credentials according to the staging-data policy.

No manual Sandbox network test was performed in Phase 5.

## Not implemented

- Customer Web Payments UI
- Booking/availability UI
- Production Square credentials or calls
- Refund initiation endpoint or UI
- Google Calendar API calls
- Deployment or production migration
