# TaskCore Consolidated Baseline

This document records the application consolidated locally during Phase 3. It does not assert that any external deployment is currently active or matches this checkout.

## Existing frontend

- Static HTML, CSS, and JavaScript served independently from the backend.
- Progressive Web App manifest, icons, and service worker.
- Customer landing page, services, phone/text actions, and service-request form.
- Client-side validation and an SMS/copy fallback when the API is unavailable.
- `config.js` supplies the public website, optional booking, and API URLs.
- Photos are previewed locally but are not uploaded by the current application.

## Existing backend

- Node.js 22, Express 5, and TypeScript.
- Kysely database access and Zod request validation.
- Helmet security headers, an explicit CORS allowlist, JSON body limits, and rate limiting.
- HTTP Basic authentication protects the admin API and static admin interface.
- Public health and service-request creation endpoints.
- Protected request list, request detail, status update, and private-note endpoints.

## Existing persistence

- SQLite is supported for local development.
- PostgreSQL is required when `NODE_ENV=production`.
- The current schema contains one `service_requests` table and an index over status and creation time.
- Supported request statuses are New, Contacted, Scheduled, Completed, and Declined.
- Schema changes now use ordered Kysely migrations. The initial migration safely adopts the historical `service_requests` table before the Phase 4 domain migration runs.

The Phase 4 domain foundation and its limitations are documented in `docs/DATABASE-ARCHITECTURE.md`.

## Existing deployment configuration

- The static frontend is configured for a GitHub Pages URL.
- `render.yaml` configures a Node web service and PostgreSQL database on Render.
- The frontend configuration contains a Render API URL.
- These deployment targets are configured in source but were not contacted or externally verified during consolidation.
- The custom domain `taskcorepros.com` is not represented by a checked-in `CNAME` file or committed CORS entry in this baseline.

## Local verification boundary

- Verification must use local configuration and must not connect to production PostgreSQL or production APIs.
- Real `.env` files and SQLite database files remain untracked.
- Square deposit processing and Google Calendar synchronization are not implemented in this baseline.
