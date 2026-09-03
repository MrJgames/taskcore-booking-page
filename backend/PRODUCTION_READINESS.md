# Operations portal production gate

This checklist is preparation, not deployment authorization. Do not apply the root
`render.yaml` unchanged: it names the existing `taskcore-api` service and old
`taskcore-postgres` database. Do not attach those resources to this preview.

## Confirmed scope

- Preview R2 photo/video persistence was verified across redeployment of `f133084`.
- Logging cleanup `64adba9` was deployed to preview and passed old/new image/video
  upload/retrieval checks with PostgreSQL connected. Repeat hosted checks after each release.
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
| `NODE_ENV` | `production`; explicitly validate Secure session cookies after deployment |
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
| `TRUST_PROXY` | `1` behind the verified single ingress hop; `false` only for direct access. Broad `true` and other values are rejected. Do not expose an alternate path that bypasses the ingress. Retest forwarded-header spoofing when network topology changes |
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

1. Verify the approved production ingress topology and repeat proxy spoofing/rate-limit tests.
   One-hop trust is covered by regression tests; do not blindly increase the hop count.
2. Re-run the audit at release time. Targeted lockfile updates resolve `qs` to 6.16.0,
   `postcss` to 8.5.26 and `nanoid` to 3.3.18 without framework upgrades.
3. Deploy the cleanup to preview, verify upload/retrieval, log redaction and secure
   sessions under production-mode configuration before promotion.
4. Approve isolated production resources, domain/origins, credential rotation,
   paid/free hosting lifecycle limits, backup/restore, R2 retention and rollback plan.
5. Use a reviewed deployment configuration instead of applying the legacy blueprint.
6. Verify promised notification delivery and remove/disable disposable QA access
   before any real-customer launch. Never copy QA records into production.

This is a focused media-readiness review, not a full application security audit.

## Authentication, payments and production resource review

- There is no `SESSION_SECRET` setting in this implementation. Session tokens use
  `crypto.randomBytes(32)` and only their hashes are stored in PostgreSQL. A fabricated
  session-secret variable would have no effect. Protect the database, use unique owner
  credentials, revoke QA sessions, and verify HTTPS/Secure/HttpOnly/SameSite behavior.
- The admin portal currently uses HTTP Basic authentication over HTTPS, not a signed
  session cookie. Production approval must accept this model or separately authorize
  stronger owner authentication/MFA and brute-force protection.
- Intended production CORS origins must include `https://taskcorepros.com` and
  `https://www.taskcorepros.com`; add only other explicitly approved portal origins.
- No Square/Stripe checkout, payment webhook or payment-secret integration was found
  in the operations backend. Quotes/estimates are not payment authorization. Keep any
  payment UI/endpoints unexposed until an independently reviewed payment integration,
  environment-specific credentials and verified webhooks are configured.
- Production database, production R2 bucket/credentials, backup retention/restore,
  alert recipients and production hostname have not been identified or verified by
  this preview-only task. Preview resources do not satisfy these gates.
- For rollback: retain the previously approved immutable app commit, verify schema
  backward compatibility and database restore points, preserve R2 objects, and use a
  reviewed manual deployment. Never reset a database as an application rollback.
- Render service health/deploy alerts are separate from business notifications.
  Approve operational recipients and test delivery; optional Twilio/Resend variables
  are required if automated business SMS/email is promised.
