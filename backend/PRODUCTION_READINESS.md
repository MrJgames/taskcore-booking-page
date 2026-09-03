# Operations portal production gate

This checklist is preparation, not deployment authorization. Do not apply the root
`render.yaml` unchanged: it names the existing `taskcore-api` service and old
`taskcore-postgres` database. Do not attach those resources to this preview.

## Confirmed scope

- Preview R2 photo/video persistence was verified across redeployment of `f133084`.
- Logging cleanup is tested locally; it requires a separate approved preview deployment
  and hosted smoke test before production promotion.
- Preview remains a QA environment, not a production-certified deployment.
- No production infrastructure, environment variables or automatic-deploy settings
  were changed by this cleanup.

## Required deployment configuration

| Setting | Required value or decision |
| --- | --- |
| Source | Explicitly approved release commit; no automatic merge to main |
| Render root | `backend` |
| Build | `npm ci --include=dev && npm run build` |
| Start | `npm start` |
| Health check | `/health` |
| Automatic deployment | Off |
| Runtime | Node 22.x satisfying `>=22.16.0 <23`; reviewed security-supported patch |
| PostgreSQL | Approved production database, backup/restore and retention verified; never preview QA data or the old database by accident |
| R2 | Private production-only bucket, bucket-scoped Object Read & Write credentials; no public bucket access |

Production domain, database, bucket and credentials must be explicitly selected.
No production resource names or secret values are implied by this checklist.

## Complete environment-variable checklist

| Variable | Production requirement / explicit default |
| --- | --- |
| `NODE_ENV` | `production` (preview currently remains `development`) |
| `NODE_VERSION` | Compatible Node 22.x patch selected above; prior tested pin was `22.16.0` |
| `PORT` | Render-assigned port; server binds `0.0.0.0` |
| `DATABASE_URL` | Secret PostgreSQL URL for the approved production database; mandatory, no SQLite fallback |
| `ADMIN_USERNAME` | Unique production owner username |
| `ADMIN_PASSWORD` | Unique randomly generated secret, at least 16 characters; never reuse QA credentials |
| `PUBLIC_BASE_URL` | Exact approved HTTPS production backend origin, used for report links |
| `CORS_ORIGINS` | Exact comma-separated approved browser origins; exclude localhost and QA origins |
| `MEDIA_STORAGE_MODE` | Exactly `s3` |
| `S3_ENDPOINT` | `https://<approved-account-id>.r2.cloudflarestorage.com`; jurisdiction-specific endpoint if applicable; no credentials/query in URL |
| `S3_BUCKET` | Approved dedicated production bucket, not `taskcore-inspection-preview-media` |
| `S3_REGION` | `auto` |
| `S3_ACCESS_KEY_ID` | Secret bucket-scoped production access key ID |
| `S3_SECRET_ACCESS_KEY` | Matching secret, only in the hosting secret store |
| `S3_FORCE_PATH_STYLE` | `false`, as exercised by the verified preview |
| `TRUST_PROXY` | Blocked pending scoped proxy trust configuration and spoofing/rate-limit tests; current code accepts only a boolean. Do not treat broad `true` as hardened or blindly use `false` behind Render |
| `RATE_LIMIT_WINDOW_MS` | Default `900000`; review for production traffic |
| `RATE_LIMIT_MAX` | Default `5`; review alongside proxy configuration |
| `BODY_LIMIT` | Default `32kb` for JSON requests |
| `MAX_PHOTO_BYTES` | Default `15728640` |
| `MAX_VIDEO_BYTES` | Default `262144000`; confirm hosting/upload time limits |
| `REPORT_TOKEN_DAYS` | Default `30`; approve report-link expiry policy |
| `TECHNICIAN_IDLE_SESSION_MS` | Default `3000000` (50 minutes) |
| `TECHNICIAN_ABSOLUTE_SESSION_MS` | Default `43200000` (12 hours) |
| `SQLITE_PATH` | Unset/unused in production; must not substitute for PostgreSQL |
| `UPLOAD_DIRECTORY` | Unset/unused for durable S3 media; OS temporary directory still needs writable staging space |
| `OWNER_MOBILE_NUMBER` | Optional owner SMS recipient; required if automatic SMS is promised |
| `TWILIO_ACCOUNT_SID` | Required with owner SMS; store securely |
| `TWILIO_AUTH_TOKEN` | Secret required with owner SMS |
| `TWILIO_FROM_NUMBER` | Approved SMS sender, required with owner SMS |
| `RESEND_API_KEY` | Secret required for automatic report emails |
| `REPORT_FROM_EMAIL` | Verified sender required with automatic report emails |

Absent notification credentials result in `not-configured`; dashboard review and
manual report-link sharing are not evidence of successful email/SMS delivery.

## Outstanding approval gates

1. Resolve/retest proxy trust and IP rate limiting (`ERR_ERL_PERMISSIVE_TRUST_PROXY`).
2. Remediate or explicitly assess the runtime `qs` moderate audit finding; no dependency
   upgrade was performed as part of logging cleanup.
3. Deploy the cleanup to preview, verify upload/retrieval, log redaction and secure
   sessions under production-mode configuration before promotion.
4. Approve isolated production resources, domain/origins, credential rotation,
   paid/free hosting lifecycle limits, backup/restore, R2 retention and rollback plan.
5. Use a reviewed deployment configuration instead of applying the legacy blueprint.
6. Verify promised notification delivery and remove/disable disposable QA access
   before any real-customer launch. Never copy QA records into production.

This is a focused media-readiness review, not a full application security audit.
