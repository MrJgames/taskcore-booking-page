# TaskCore Website and Service Request API

TaskCore has two deliberately separate parts:

- The existing static customer website in the repository root. It remains compatible with GitHub Pages and keeps Call Jay, Text Jay, Book Appointment, the PWA, QR assets, photo previews, and SMS fallback.
- A small Node.js, Express, and TypeScript API in `backend/`. It validates and stores service requests and serves Jay's protected admin page.

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

Kysely provides the database abstraction. The backend automatically uses PostgreSQL when `DATABASE_URL` is present and SQLite otherwise.

## Run the complete project locally

Node.js 20 or newer and Python are required for the commands below.

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

- `PORT`: HTTP port; defaults to `3000`.
- `NODE_ENV`: use `production` on the deployed backend.
- `DATABASE_URL`: PostgreSQL connection string. Leave blank for local SQLite.
- `SQLITE_PATH`: local database path; defaults to `./data/taskcore.db`.
- `ADMIN_USERNAME`: Jay's admin username.
- `ADMIN_PASSWORD`: unique, randomly generated admin password of at least 16 characters.
- `CORS_ORIGINS`: comma-separated allowed browser origins. GitHub Pages uses `https://mrjgames.github.io` as the origin; paths are not included.
- `RATE_LIMIT_WINDOW_MS`: public submission rate-limit window.
- `RATE_LIMIT_MAX`: maximum submissions per IP during the window.
- `BODY_LIMIT`: maximum JSON body size.
- `TRUST_PROXY`: set to `true` only when the chosen host documents that Express should trust its proxy.

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

- `GET /health` — public health check.
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
const TASKCORE_API_URL = "";
```

- `TASKCORE_BOOKING_URL`: when blank, Book Appointment scrolls to the service request form; otherwise it opens that URL.
- `TASKCORE_WEBSITE_URL`: final public customer-site URL used by the QR generator.
- `TASKCORE_API_URL`: deployed backend origin, for example `https://api.example.com`. Do not add `/api/service-requests` and do not include a trailing slash.

Photos are not uploaded by this backend version. They remain temporary browser previews and are useful only when the customer uses the SMS fallback and manually attaches them.

## What still must be deployed

GitHub Pages can host only the static frontend. Before enabling online submissions publicly:

1. Choose a Node.js host that provides HTTPS and persistent PostgreSQL.
2. Create the PostgreSQL database and set `DATABASE_URL` on that host.
3. Set a strong `ADMIN_USERNAME` and `ADMIN_PASSWORD` as host environment variables.
4. Set `CORS_ORIGINS=https://mrjgames.github.io`.
5. Deploy the `backend/` folder and verify `/health` and `/admin/` over HTTPS.
6. Put the deployed backend origin in `TASKCORE_API_URL`.
7. Run the complete customer-to-admin flow from the GitHub Pages site.
8. Commit and push only after that production test succeeds.

No backend has been deployed by this project update.

## Roll back to text-message-only mode

Set the API URL to blank and publish the static files:

```javascript
const TASKCORE_API_URL = "";
```

The customer form will preserve its details and show **Text Request** and **Copy Request**. Call, Text, Book Appointment, QR, photo previews, and the PWA continue to work independently.

## QR and PWA

The final website QR files remain in `assets/qr/`. Run `py generate_qr.py` if the public website URL changes. PWA icons and offline static assets remain under `assets/icons/`, `manifest.json`, and `service-worker.js`.
