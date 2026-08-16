# TaskCore customer booking and Square Web Payments

Status: Phase 6 local implementation. Not deployed. Google Calendar delivery is intentionally not implemented.

## Two customer paths

- **Request help / get a quote:** the existing `service_requests` flow remains independent. Quote-required services link customers to `#quote`; they cannot enter payment checkout.
- **Direct booking:** an eligible service moves through server-provided availability, customer/address collection, a temporary reservation, server-authoritative review, Square deposit payment, backend verification, booking confirmation, job creation, and an outbox record.

The TaskCore database remains authoritative. Square processes payment. Calendar is a later downstream outbox consumer.

## Service configuration and pricing safety

`backend/src/booking/services.ts` is the single service catalog. Each entry defines its stable ID, name, description, duration, direct-booking flag, pricing behavior, optional instructions, and scheduling rules.

No permanent TaskCore prices were invented. Installation and troubleshooting are `quote_required`. A clearly named development-only demo service with placeholder cents exists only outside `NODE_ENV=production`; it is not an approved offering or price.

## Availability and checkout

- `GET /api/booking/services` returns sanitized configuration.
- `GET /api/booking/availability?serviceId=...` returns canonical, non-overlapping slots in `TASKCORE_TIMEZONE`. Each carries a 10-minute HMAC-signed identifier. Active reservations are excluded and expired reservations are released first.
- `POST /api/booking/checkout-session` validates service, signed slot, customer, address, and notes. A strict schema rejects browser price, duration, status, or timestamps.
- Checkout creates/reuses a matching customer and atomically creates the consumed hold, pending booking, and exclusive reservation. The database unique slot key resolves races.
- `GET /api/booking/session/:token/status` returns only that session's sanitized state for recovery and confirmation refresh.

Phase 4 protects identical canonical slots, not arbitrary overlaps. The server therefore generates non-overlapping starts, and clients never submit arbitrary intervals.

## Signed payment sessions

Compact HMAC-SHA256 sessions use the dedicated `PAYMENT_SESSION_SECRET`, not Square credentials. They bind one customer and booking, have an expiration, and use timing-safe comparison. Expiry is the earlier of the hold or configured session expiry. The deposit endpoint rejects tampering, expiry, wrong token type, booking mismatch, and customer mismatch.

Tokens contain identifiers and expiry only—no card data, address, email, phone, or secret. Booking/payment responses use `Cache-Control: no-store, private`.

## Current official Square requirements (verified 2026-08-15)

Only official Square documentation was used:

- Sandbox loads `https://sandbox.web.squarecdn.com/v1/square.js`; production removes `sandbox`. Application and location IDs initialize `Square.payments`. [Web Payments SDK reference](https://developer.squareup.com/reference/sdks/web/payments)
- Hosted fields use `payments.card()` and `card.attach()`. Successful `card.tokenize(verificationDetails)` returns the single-use source sent to the backend. [Take a Card Payment](https://developer.squareup.com/docs/web-payments/take-card-payment)
- Buyer verification is now integrated into `card.tokenize()` with amount, currency, billing contact, `intent: CHARGE`, `customerInitiated: true`, and `sellerKeyedIn: false`. Separate `payments.verifyBuyer()` and verification tokens are deprecated and are not used.
- HTTPS secure context and CSP are required. IE11 and Chrome extensions are unsupported. Square-hosted payment sessions time out after 24 hours. [Overview](https://developer.squareup.com/docs/web-payments/overview), [exception handling](https://developer.squareup.com/docs/web-payments/exception-handling)
- Sandbox CSP allows Square's sandbox script/frame host, PCI endpoint, documented Sentry endpoint, and font hosts. Static meta CSP and Helmet reflect these. [CSP guide](https://developer.squareup.com/docs/web-payments/content-security-policy)
- Square-hosted iframes provide accessible titles and validation messages. TaskCore adds a heading, live status, visible focus, and busy state. [Accessibility changelog](https://developer.squareup.com/docs/changelog/webpaymentsdk/2025-08-06)
- SDK, tokenization, unsupported-browser, and insecure-context errors receive customer-safe handling. [SDK errors](https://developer.squareup.com/reference/sdks/web/payments/errors)

Application/location IDs are browser-safe. Access token, webhook key, and session secret are never returned. Source tokens are not logged or stored. Transport retries retain one logical `requestId`, which maps to a stable Square idempotency key.

## Reconciliation, PWA, mobile, accessibility

Double-clicks are ignored. Network interruption retains the attempt ID and queries TaskCore before any retry. A terminal decline permits an explicit new attempt. Tokenization never confirms a booking; only server state does.

The service worker only handles same-origin GETs and bypasses every `/api/` and Square request. It cannot cache or replay booking/payment requests or tokens. Browser storage is not used for payment/session data.

The UI has real labels and fieldsets, a live region, keyboard-native controls, visible focus, text status (not color alone), disabled/busy state, reduced-motion compatibility, and responsive single-column layouts down to 320px-class screens.

## Configuration

- `TASKCORE_TIMEZONE` — IANA timezone; default `America/Los_Angeles`.
- `PAYMENT_SESSION_SECRET` — dedicated random value, at least 32 characters; required in production.
- `BOOKING_HOLD_MINUTES` — default 15.
- `PAYMENT_SESSION_MINUTES` — default 10 and capped by hold expiry.
- Existing Square Sandbox variables are required together. Access token and webhook key remain server-only.

## Testing and remaining work

Backend: `npm test`, `npm run build`. Frontend: `node --test website/booking-flow.test.mjs`, then Node syntax checks. Automated payment tests use mocks and no Square network.

Still unimplemented: approved production services/prices/policies; production Square setup/deployment; customer notifications; admin booking/payment screens; Google Calendar synchronization/outbox worker; production monitoring/runbook.
