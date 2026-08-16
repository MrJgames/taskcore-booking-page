# TaskCore Website and Service Request API

TaskCore has two deliberately separate parts:

- The existing static customer website in the repository root. It remains compatible with GitHub Pages and keeps Call Jay, Text Jay, Book Appointment, the PWA, QR assets, photo previews, and SMS fallback.
- A small Node.js, Express, and TypeScript API in `backend/`. It validates and stores service requests and serves Jay's protected admin page.

Phase 6 also adds a local-only customer direct-booking path with canonical availability, signed payment sessions, server-authoritative deposit review, Square Web Payments Sandbox fields, reconciliation, and confirmation. See `docs/CUSTOMER-BOOKING-SQUARE-WEB.md`. It has not been deployed.

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
- `CORS_ORIGINS`: comma-separated allowed browser origins. Production should contain exactly `https://mrjgames.github.io,https://taskcore-api-rlvr.onrender.com`; local development can use `http://localhost:8000,http://127.0.0.1:8000`.
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
const TASKCORE_API_URL = "https://taskcore-api-rlvr.onrender.com";
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
CORS_ORIGINS=https://mrjgames.github.io,https://taskcore-api-rlvr.onrender.com
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

### Production data decision

Do not accept production customer requests while `taskcore-postgres` remains on the Free instance type. The preferred path is to upgrade that existing database to the smallest suitable paid Render Postgres instance before the 30-day expiration so the current records remain in place.

After the upgrade:

1. Confirm `/health` still reports `database: connected`.
2. Compare the admin request count before and after the change and save one controlled status/private-note update.
3. Confirm point-in-time recovery is available on the database's **Recovery** page.
4. Create an on-demand logical export and retain it outside Render.
5. Schedule a recurring export and perform a test restore before relying on the system for customer records.

Paid Render Postgres includes point-in-time recovery; the recovery window is currently three days on Hobby workspaces and seven days on Pro or higher. Free databases have no backups. See [Render Postgres recovery and backups](https://render.com/docs/postgresql-backups) and [Free instance limitations](https://render.com/docs/free).

### Email notification decision

Automatic email notifications are deferred for the current launch. New requests are stored first and remain visible in the protected admin dashboard, while the customer-facing SMS fallback continues to work if the API is unavailable. This keeps successful request capture independent of an email vendor and avoids adding provider credentials before the database is durable.

Revisit notifications after the paid database and recovery checks are complete. Any future email integration should run only after the database insert succeeds, keep provider credentials in Render environment variables, and never turn an email delivery failure into a failed customer submission.

Official references: [Render Web Services](https://render.com/docs/web-services), [Render Blueprints](https://render.com/docs/blueprint-spec), and [Free instance limitations](https://render.com/docs/free).

Deployment remains a separate, explicitly approved step after tests and review.

## Roll back to text-message-only mode

Set the API URL to blank and publish the static files:

```javascript
const TASKCORE_API_URL = "";
```

The customer form will preserve its details and show **Text Request** and **Copy Request**. Call, Text, Book Appointment, QR, photo previews, and the PWA continue to work independently.

## QR and PWA

The final website QR files remain in `assets/qr/`. Run `py generate_qr.py` if the public website URL changes. PWA icons and offline static assets remain under `assets/icons/`, `manifest.json`, and `service-worker.js`.
