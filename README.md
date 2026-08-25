# TaskCore Website and Service Request API

TaskCore has two deliberately separate parts:

- The existing static customer website in the repository root. It remains compatible with GitHub Pages and keeps Call Jay, Text Jay, Book Appointment, the PWA, QR assets, photo previews, and SMS fallback.
- A small Node.js, Express, and TypeScript API in `backend/`. It validates and stores service requests and serves Jay's protected admin page.
- A mobile inspection portal in the same backend. Technicians submit checklists, required photos, walkthrough video, and maintenance findings to the owner review queue. Only the owner can add quotes and publish a secure client report.

The customer website works without the backend. When `TASKCORE_API_URL` is blank or the API cannot be reached, the completed form offers **Text Request** and **Copy Request** so the customer does not lose their information.

## Architecture

```text
GitHub Pages customer site
        |
        | HTTPS POST /api/service-requests
        v
Express + TypeScript backend
        |
        +-- SQLite for local development
        +-- PostgreSQL when DATABASE_URL is configured
        +-- Protected /admin/ page for Jay
```

Kysely provides the database abstraction. The backend automatically uses PostgreSQL when `DATABASE_URL` is present. SQLite is allowed only for local development and tests; production startup refuses to run without PostgreSQL.

## Run the complete project locally

Node.js 22.16.0 and Python are required for the commands below.

### 1. Start the backend

Open PowerShell in the project folder:

```powershell
cd backend
Copy-Item .env.example .env
npm install
npm run dev
```

Before starting, open `backend/.env` and replace `ADMIN_PASSWORD` with a long local password. The API will be available at `http://localhost:3000`; its health check is `http://localhost:3000/health`.

The first start creates `backend/data/taskcore.db`. The `backend/.env`, local database, installed packages, and compiled files are ignored by Git.

### 2. Connect the local frontend

In the root `config.js`, temporarily set:

```javascript
const TASKCORE_API_URL = "http://localhost:3000";
```

Do not use localhost in the published website. Production must use the public HTTPS origin of the deployed backend.

### 3. Start the frontend

Open a second PowerShell window in the project root:

```powershell
py -m http.server 8000
```

Open `http://localhost:8000`. Submit a request, then open `http://localhost:3000/admin/`. The browser will ask for `ADMIN_USERNAME` and `ADMIN_PASSWORD` from `backend/.env`.

Press `Ctrl+C` in both PowerShell windows when finished.

## Environment variables

All backend variables are documented in `backend/.env.example`:

- `PORT`: HTTP port; defaults to `3000` locally. Render supplies this automatically, so do not add it manually there.
- `NODE_ENV`: use `production` on the deployed backend.
- `DATABASE_URL`: PostgreSQL connection string. It is required in production; leave it blank only for local SQLite development.
- `SQLITE_PATH`: local database path; defaults to `./data/taskcore.db`.
- `ADMIN_USERNAME`: Jay's admin username.
- `ADMIN_PASSWORD`: unique, randomly generated admin password of at least 16 characters.
- `CORS_ORIGINS`: comma-separated allowed browser origins. Production should contain exactly `https://mrjgames.github.io`; local development can use `http://localhost:8000,http://127.0.0.1:8000`.
- `RATE_LIMIT_WINDOW_MS`: public submission rate-limit window.
- `RATE_LIMIT_MAX`: maximum submissions per IP during the window.
- `BODY_LIMIT`: maximum JSON body size.
- `TRUST_PROXY`: use `true` on Render and `false` for direct local development.

Never put the admin password, database URL, API keys, or other secrets in `config.js`, frontend files, or Git.

## Database

The `service_requests` table stores:

- unique request ID
- created, submitted, and last-updated timestamps
- customer name, phone, and optional email
- service address and issue description
- preferred contact method
- preferred service date and requested arrival window
- status: `New`, `Contacted`, `Scheduled`, `Completed`, or `Declined`
- Jay's private note

New requests are listed first in the admin page.

## API endpoints

- `GET /health` — public, unauthenticated health check that verifies database connectivity.
- `POST /api/service-requests` — public, validated, rate-limited request submission.
- `GET /api/admin/service-requests` — protected request list.
- `GET /api/admin/service-requests/:id` — protected request detail.
- `PATCH /api/admin/service-requests/:id` — protected status/private-note update.
- `GET /admin/` — protected admin page.

Admin routes use environment-configured HTTP Basic authentication. Production must use HTTPS so credentials and customer data are encrypted in transit.

## Property inspection portal

- `/tech/` is the phone-friendly technician portal. Technician accounts are created from the protected admin dashboard.
- `/admin/` contains inspection setup, the unread review queue, owner notes, repair pricing, and the publish control.
- `/report/<secure-token>` is the expiring client report. The client can approve or decline each quoted repair separately and leave a comment.

The workflow is deliberately gated: `Draft → Submitted → Ready → Published`. A technician submission is never sent directly to a client. The owner can return it for changes or review every maintenance finding, set the repair scope and price, and then publish it. Client decisions are stored both as the current decision and as an append-only decision history.

Inspection media uses local storage only during development. Production startup requires `MEDIA_STORAGE_MODE=s3` plus an S3-compatible bucket, because Render's normal local filesystem is not durable. Files are private and are proxied only through authenticated admin routes or a valid, unexpired report token.

Dashboard alerts are always created when a technician submits an inspection or a client makes a repair decision. Add the optional Twilio variables to also text the owner. Add the optional Resend variables to email a published report link directly to the client; without them, the dashboard provides a secure link that can be copied and sent manually.

## Testing and builds

From `backend/`:

```powershell
npm test
npm run build
npm start
```

The automated suite covers valid submission, missing fields, invalid phone numbers, invalid arrival windows, rate limiting, protected admin routes, database listing, and status/private-note updates.

Before deployment, also test the customer form from the real GitHub Pages origin against the deployed API, confirm the admin page works over HTTPS, and retest Call Jay, Text Jay, Book Appointment, photo previews, PWA installation, and offline static-page loading.

## Frontend configuration

`config.js` contains:

```javascript
const TASKCORE_BOOKING_URL = "";
const TASKCORE_WEBSITE_URL = "https://mrjgames.github.io/taskcore-booking-page/";
const TASKCORE_API_URL = "";
```

- `TASKCORE_BOOKING_URL`: when blank, Book Appointment scrolls to the service request form; otherwise it opens that URL.
- `TASKCORE_WEBSITE_URL`: final public customer-site URL used by the QR generator.
- `TASKCORE_API_URL`: deployed backend origin, for example `https://api.example.com`. Do not add `/api/service-requests` and do not include a trailing slash.

Photos are not uploaded by this backend version. They remain temporary browser previews and are useful only when the customer uses the SMS fallback and manually attaches them.

## Temporary Render deployment

The repository includes `render.yaml` as an optional Blueprint. It defines one Node web service and one Render Postgres database, connects `DATABASE_URL` without putting the connection string in Git, uses `/health`, and leaves automatic deploys off. It contains no secrets.

### Render Dashboard setup

Nothing can be deployed until these changes are committed and pushed with your approval. When that is done:

1. Sign in to the [Render Dashboard](https://dashboard.render.com/) and connect the GitHub account that can access `MrJgames/taskcore-booking-page`.
2. Create **New > Postgres** first. Name it `taskcore-postgres`, choose Oregon (the same region as the web service), and choose the temporary Free instance if desired.
3. Create **New > Web Service**, select `MrJgames/taskcore-booking-page`, and use the `main` branch.
4. Set **Language** to `Node` and **Root Directory** to `backend`.
5. Set **Build Command** to `npm ci --include=dev && npm run build`.
6. Set **Start Command** to `npm start`.
7. Under **Advanced**, set **Health Check Path** to `/health` and turn automatic deploys off while testing.
8. Add the environment variables below. For `DATABASE_URL`, select the Internal Database URL from `taskcore-postgres` instead of copying it into any file.
9. Create the web service and watch the first deploy log. Startup automatically creates the `service_requests` table and index when the PostgreSQL database is empty. Initialization is idempotent, so normal restarts do not erase requests.

### Render environment variables

Use these names and sample values. Values in angle brackets must be supplied in the Render Dashboard and must never be committed:

```dotenv
NODE_ENV=production
NODE_VERSION=22.16.0
DATABASE_URL=<Render Internal Database URL from taskcore-postgres>
CORS_ORIGINS=https://mrjgames.github.io
ADMIN_USERNAME=jay
ADMIN_PASSWORD=<unique randomly generated password of at least 16 characters>
TRUST_PROXY=true
```

Do not add `PORT`; Render supplies it automatically. The server explicitly listens on `0.0.0.0` and uses `process.env.PORT`.

### First deployment test

1. Open `https://<your-service-name>.onrender.com/health`. Expect HTTP 200 with `{"status":"ok","database":"connected"}`.
2. Open `/api/admin/service-requests` without credentials and confirm it returns HTTP 401.
3. Open `/admin/`, enter the Render `ADMIN_USERNAME` and `ADMIN_PASSWORD`, and confirm the empty request list loads.
4. Confirm a request from any origin other than `https://mrjgames.github.io` is rejected by CORS.
5. Only after those checks pass, set `TASKCORE_API_URL` in the static site's `config.js` to the Render service's HTTPS origin and perform one controlled customer-to-admin test.
6. If the API fails, leave `TASKCORE_API_URL` blank. The existing SMS fallback remains the safe rollback.

### Free PostgreSQL data-loss risk

Render currently states that a Free Postgres database expires 30 days after creation. It becomes inaccessible at expiration, has no backups, and is deleted after a further 14-day upgrade grace period. Therefore, a Free database creates a real risk of permanently losing customer requests and should be treated only as a temporary test database.

Before day 30, choose one of these paths:

- Upgrade the same Render Postgres database to a paid instance so the stored requests remain in place.
- Export it with `pg_dump`, create a durable PostgreSQL database, restore with `pg_restore` or `psql`, replace `DATABASE_URL`, redeploy, and verify `/health`, request counts, and the admin page before retiring the old database.

For future schema changes, add versioned migrations before deployment. The current startup initializer safely creates the initial table and index on an empty PostgreSQL database, but it is not a general migration system.

Official references: [Render Web Services](https://render.com/docs/web-services), [Render Blueprints](https://render.com/docs/blueprint-spec), and [Free instance limitations](https://render.com/docs/free).

No backend has been pushed or deployed by this project update.

## Roll back to text-message-only mode

Set the API URL to blank and publish the static files:

```javascript
const TASKCORE_API_URL = "";
```

The customer form will preserve its details and show **Text Request** and **Copy Request**. Call, Text, Book Appointment, QR, photo previews, and the PWA continue to work independently.

## QR and PWA

The final website QR files remain in `assets/qr/`. Run `py generate_qr.py` if the public website URL changes. PWA icons and offline static assets remain under `assets/icons/`, `manifest.json`, and `service-worker.js`.
