# TaskCore operations release preparation — 2026-09-03

This is a release plan, not production deployment authorization. Application baseline
is `5095e56fb5108b518c23fc8efaa06007482a6b50`. The proposed candidate is the subsequent
feature-branch commit containing this document and removal of the two browser QA
controls. Record its exact immutable SHA in the release handoff; do not deploy a
moving branch name. No production resources were inspected or changed for this plan.

## Readiness decision

- GREEN: preview application workflow verification accepted by owner; owner dashboard
  manually accessible in AVG; R2/PostgreSQL durability previously verified; history
  membership fix tested locally and smoke-tested on preview. No owner-auth redesign.
- GREEN after final run: full tests/build/audit and published-script QA-hook removal.
- YELLOW: approve production resources, cost ceiling, hostname/origins, credentials,
  Basic-auth risk acceptance/compensating controls, recovery objectives, retention,
  operational recipients and a release window. QA records remain intentionally retained.
- RED for deployment until evidence exists: a compatible non-expiring production DB,
  production-only private media store, verified backup/restore and rollback target are
  not established. A populated legacy DB without a schema-diff rehearsal must not
  receive this initializer. These are infrastructure/recovery gates, not a claim
  that the tested preview application is broken.

## QA and preview behavior review

The public technician session script had `?sessionTest=1` accelerated timers and
`window.TaskCoreSessionTest`. Both are removed by this release. Normal 45-minute
warning / additional 5-minute grace, autosave, recovery and renewal remain unchanged.
No remaining runtime QA credential seed or debug endpoint was found in the reviewed
backend source/public assets. Test credentials are synthetic fixtures in test files,
not deployed account seeds. This is a scoped review, not a forensic secret audit.

`tsconfig.json` includes tests in compilation: test JS/source maps can exist in dist,
but server startup imports server.js, not test modules, and dist is not a static
root. Keep tests for verification; do not serve source, dist or repository roots.
Use a clean checkout/build, never copy local .env, SQLite, uploads or test artifacts.
The tracked .env.example contains placeholders/development defaults, not a production
configuration. Explicitly override CORS, HTTPS base URL, mode, DB and storage settings.
Startup fails in production without PostgreSQL, HTTPS base URL and S3 configuration.

Media logs retain fixed provider/event fields, hashed object correlation and status
codes, not raw SDK errors/keys/URLs. Normal startup logs remain. The general API error
handler still logs exception objects: restrict log access/retention and review error
redaction before handling sensitive production incidents. No new logging was added.
No global QA switch exists in backend config. Offline drafts are a real feature, not
a test hook; they contain potentially sensitive data and need a device-retirement policy.

Startup seeds to KEEP: the system Unassigned / Owner Review client and eleven work
channels (Handyman, Plumbing, Electrical, HVAC, Pool, Smart Home / IT, Painting / Finish,
Cleaning, Inspection, Licensed Contractor, Owner Review). They are functional lookup
records, not QA accounts. No technician, owner, manager or contractor is seeded.

## QA-retirement checklist — DO NOT EXECUTE YET

Prefer a clean, isolated production database and bucket with no preview-data copy.
Preview can retain evidence separately. A name containing QA is not sufficient
authorization to delete a record. Before any cleanup, inventory exact IDs, ownership,
dependencies, retention requirements and object keys; export approved evidence and
obtain owner sign-off. Do not delete the system unassigned client/work channels.

Known retained history-test drafts (unsubmitted; no report publication):

| Label | Inspection ID |
| --- | --- |
| QA history A legitimate update | b7ce68ea-74e2-42a3-bd5e-43b6652dd6a4 |
| QA history B | a58f5d63-fd1f-4990-97b1-a62fdafbf96b |

Both are under preview property `72782d72-b711-425b-9e7f-d4d1ca047776`
(QA Durable Home 1788302312). Preserve findings/history and the failed-write evidence.

Other known inventory anchors (not an exhaustive hosted account inventory):

- QA technician `qa-tech-1788302312@example.test`: retire/revoke sessions only after
  remaining preview evidence is accepted; never copy its credential into production.
- QA client `485a4137-9bd0-41a4-930b-a604389133e6` and the property above.
- QA job TC-REQ-1046, ID `676f71cf-c632-4af4-b264-507a19259526`.
- Earlier published QA inspection `368c03e3-0d10-48f9-afcf-03a0ef375cb9`: inventory its
  report token expiry/notifications without copying bearer links into documents.
- R2 QA evidence prefix `operations/676f71cf-c632-4af4-b264-507a19259526/` in
  `taskcore-inspection-preview-media`. Preserve all evidence until retirement approval.
- Inventory remaining QA organization users/vendors, requests, estimates, approvals,
  offers, comments, completion reports, notifications and sessions through authorized
  read-only queries; an exhaustive hosted inventory was not performed here.

Retirement sequence after separate approval:

1. Export evidence manifest and snapshot dependency graph; retain hashes, not secrets.
2. Exclude every QA account/record/object from any production import; do not clone the
   preview DB into production. Provision real identities through the approved process.
3. Revoke QA sessions and disable approved QA identities using supported controls or
   reviewed ID-scoped maintenance. No bulk name-based deletes or password guessing.
4. Expire/revoke QA published links through an approved process. Archiving a property
   alone does not revoke a published report token. Block outbound test notifications.
5. Archive supported parent records; do not assume cascade deletion is complete.
   There is no general inspection-delete endpoint. Maintenance history lacks a finding
   FK and can remain detached; never purge audit evidence without a retention decision.
6. Only after retention approval, remove exact unreferenced QA objects and records in
   dependency order with recovery copies. Never delete a bucket or reset the database.
7. Clear QA-origin IndexedDB/session/local storage on approved test devices only after
   ensuring drafts/evidence are retained. Never clear unrelated browser data.
8. Verify QA login/report links no longer grant access and real records/media still
   resolve; record who approved cleanup, IDs, time, backup reference and results.

## Database initialization and migration compatibility

Source of truth: src/database.ts; src/server.ts calls initializeDatabase before listen.
There is no ordered migration ledger, ALTER migration set or down-migration runner.
Startup runs CREATE TABLE IF NOT EXISTS, CREATE INDEX IF NOT EXISTS, then idempotent
system-client/channel inserts. The operations are sequential, not one global DDL
transaction. Failure can leave partially created schema. IF NOT EXISTS does not
repair missing columns, changed types, constraints or incompatible existing indexes.

On a new approved DB, the initializer creates the following complete table set:

```
service_requests clients properties technicians technician_sessions inspections
inspection_media inspection_findings notifications inspection_decision_events
technician_activity_events technician_operations inspection_media_links
maintenance_finding_details maintenance_finding_events property_audit_events
property_notifications property_assignment_status organizations organization_users
vendors operations_sessions work_channels technician_channels vendor_channels
operations_service_requests operations_request_media technician_task_details
operations_request_history operations_comments estimates estimate_revisions
estimate_approvals contractor_offers job_completion_reports technician_job_updates
operations_notifications property_activity
```

It also creates the status, relationship, session and history indexes listed at the
end of database.ts and the service-request index at its start. On a matching DB these
already exist; no data transform is performed. Which objects an existing production
DB lacks cannot be confirmed without its schema inventory, which remains out of scope.

No DROP, TRUNCATE, DELETE, column rename/type conversion or destructive backfill is
present in initialization. FK cascade/set-null clauses apply to later application
deletions, not startup. Index construction may still lock tables or fail. Do not
confuse non-destructive DDL with guaranteed legacy compatibility.

5095e56 introduced no schema/media-key change; this release also changes no schema.
Existing IDs, property/inspection relationships, JSON checklists and R2 object keys
remain structurally compatible on the verified preview schema. Legacy local-only
media is NOT migrated into R2 by startup; unresolved local references need an explicit
inventory/copy plan before importing legacy data. Some cross-system references are
not enforced by FKs: run orphan/reference checks during rehearsal.

Fresh-schema PostgreSQL emulation/idempotency is covered by existing tests. It is not
a real-production schema upgrade test. Rehearse initialization twice on an isolated
restore using the selected PostgreSQL major version, compare schemas/counts/references,
and exercise the application before approval. No legacy render.yaml deployment.

## Backup and rollback runbook — draft, not executed

Before release:

1. Owner names release operator, window, RPO/RTO, retention and exact target resource
   IDs. Record current production app SHA, environment version and PostgreSQL version
   without secrets. That production rollback SHA is presently UNKNOWN; do not use an
   arbitrary preview commit. In particular 21cd61b predates the history integrity fix.
2. Approve a write-freeze mechanism for every writer (web app/jobs/integrations).
   There is no application maintenance-mode flag to invent. Ensure the mechanism
   is available on the selected hosting plan; block writes before the final recovery
   point, and suppress notifications in recovery rehearsals.
3. Create a consistent PostgreSQL custom-format logical dump using a compatible
   pg_dump client and a protected connection profile/secret injection. Never put a
   connection URL/password on the command line, in shell history or logs. Capture
   approved role/extension/privilege metadata separately where provider permissions
   permit. Encrypt the archive, restrict access, compute a checksum, retain it outside
   the app's ephemeral disk and record timestamp/DB identity/version and tool version.
4. Verify archive readability AND restore it into a separate approved recovery DB;
   pg_restore --list alone is not a restore test. Compare schema, counts, keys and
   representative reports. Never test restore with --clean against a live DB.
5. Inventory referenced R2 keys (including direct operations keys and inspection-media
   references), lengths/checksums and bucket identity at the freeze boundary. Preserve
   all referenced objects in an approved separate backup location/retention scheme.
   R2 durability is not accidental-deletion protection. Do not assume versioning/PITR
   exists. No lifecycle purge, overwrite, key rewrite or sync-with-delete during release.
6. Verify a DB restore can resolve the matching media manifest. DB and object storage
   are not one transaction; reconcile in-flight uploads/deletes before releasing the
   freeze. Retain post-backup objects until incident reconciliation is complete.
7. Save immutable previous/candidate builds plus reviewed environment versions, and
   rehearse candidate and fallback behavior against the recovery clone. If this is a
   first production launch, rollback may mean taking the new portal offline while the
   pre-existing live website remains untouched, not deploying an older preview build.

Deployment rollback (only when later authorized):

1. Freeze writes again; record symptoms/time; preserve current logs and a fresh incident
   snapshot before intervention. Never wipe the failing DB or bucket.
2. If schema/data remain compatible, manually deploy the recorded previous known-good
   production SHA with its compatible configuration. Keep automatic deploy OFF. Do not
   blindly copy preview settings or weaken authentication/storage to make startup pass.
3. There are no reverse migrations. If initialization/data changes are incompatible,
   restore the verified pre-release archive into a NEW approved recovery DB (or use
   approved managed recovery). Retain the incident DB. Restore privileges/extensions,
   and point only the approved production service to the recovered DB after sign-off.
4. A restore discards changes after its recovery point unless explicitly reconciled.
   Owner approves that loss/replay plan. Use preserved R2 objects; do not roll back or
   delete newer objects blindly. Reconcile keys and references before writes resume.
5. Verify /health, startup/init twice, owner login, role-denial tests, inspection lists,
   findings/history, properties/assignment, existing photo/video retrieval, report
   expiry, and approved notification behavior. Verify no unintended email/SMS replay.
   Confirm HTTPS, CORS, proxy/rate limits, S3 provider and no SQLite fallback.
6. Reopen writes only after operator/owner acceptance. Record actual RPO/RTO, release
   SHA, backup ID, DB/media reconciliation and monitoring results. Never merge main
   or enable automatic deployment as part of rollback.

## Final production environment checklist (actual code requirements)

Required secrets — separate production values, hosting secret store only:

| Variable | Requirement |
| --- | --- |
| DATABASE_URL | Approved persistent PostgreSQL connection; never old taskcore-postgres or preview DB |
| ADMIN_PASSWORD | Unique random owner password, >=16 characters; no example/QA value |
| S3_ACCESS_KEY_ID | Production bucket-scoped credential; treat as sensitive |
| S3_SECRET_ACCESS_KEY | Matching secret; never in source/logs/browser bundle |

Required non-secret configuration (some identifiers remain operationally private):

| Variable/setting | Required production value |
| --- | --- |
| ADMIN_USERNAME | Approved unique owner username |
| NODE_ENV | production |
| NODE_VERSION | Security-reviewed Node 22.x patch satisfying >=22.16.0 <23; current tested pin 22.16.0 is not proof of current patch support |
| MEDIA_STORAGE_MODE | s3 |
| S3_BUCKET | Dedicated approved private production bucket, not preview bucket |
| S3_ENDPOINT | https://<approved-account-id>.r2.cloudflarestorage.com; must be explicit for R2 even though general S3 code permits omission |
| S3_REGION | auto |
| S3_FORCE_PATH_STYLE | false (preview-tested) |
| PUBLIC_BASE_URL | Approved HTTPS production portal/backend origin, not preview or localhost |
| CORS_ORIGINS | https://taskcorepros.com,https://www.taskcorepros.com plus approved portal origin if different; no localhost/QA origins |
| TRUST_PROXY | render only with verified Render/Cloudflare ingress and no origin bypass; platform supplies RENDER=true |
| PORT | Hosting-assigned; server binds 0.0.0.0 |
| Root / build / start | backend / npm ci --include=dev && npm run build / npm start |
| Health / automatic deployment | /health / OFF |

Optional settings and current defaults:

| Variables | Defaults/conditions |
| --- | --- |
| RATE_LIMIT_WINDOW_MS / RATE_LIMIT_MAX | 900000 / 5 (public submissions; not universal login protection) |
| BODY_LIMIT | 32kb JSON |
| MAX_PHOTO_BYTES / MAX_VIDEO_BYTES | 15728640 / 262144000; check hosting upload limits |
| REPORT_TOKEN_DAYS | 30; owner must approve link retention/expiry |
| TECHNICIAN_IDLE_SESSION_MS / TECHNICIAN_ABSOLUTE_SESSION_MS | 3000000 / 43200000; frontend warning remains 45+5 minutes |
| OWNER_MOBILE_NUMBER / TWILIO_FROM_NUMBER | Required only for approved owner SMS |
| TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN | Sensitive account ID + secret required for SMS; separately approve provider/cost |
| RESEND_API_KEY / REPORT_FROM_EMAIL | Secret + verified sender required for report email; separately approve delivery/cost |
| SQLITE_PATH / UPLOAD_DIRECTORY | Leave unset for production; not durable stores in S3 mode; OS temp staging still needs writable space |

No SESSION_SECRET is consumed: owner uses Basic; other sessions are opaque tokens
stored hashed in DB. Do not invent ineffective variables. Missing notification config
returns not-configured; dashboard/manual links still work but automatic delivery must
not be promised. Operations manager/vendor sessions have their own code-defined
12-hour behavior, not the technician timeout settings above.

Intentionally unenabled: Square/Stripe checkout, payment capture, payment webhooks,
payment keys and paid integrations without approval. Quotes/estimates do not constitute
payment capture. There is no payment-enable switch in current backend config.

## Costs and approvals

No purchases, upgrades or resource creation are authorized by this document.

- Render production web compute and non-expiring PostgreSQL: expect recurring paid
  plans plus possible bandwidth/build/storage/backup charges. Select plans and a
  spend ceiling before provisioning; no price total is assumed.
- Render free services are for preview, not production; free Postgres expires after
  30 days and lacks managed backups. Confirm preview DB lifecycle separately without
  upgrading it automatically. See https://render.com/docs/free .
- R2 has included allowances but storage/operations beyond them are metered; media
  backup copies also consume storage/operations. Approve usage budget before creating
  the production bucket. See https://developers.cloudflare.com/r2/pricing/ .
- SMS numbers/messages, email provider tiers, backup storage, monitoring/log retention
  and domain registration/renewal can incur costs. Optional services stay unconfigured
  until the owner chooses recipients, provider and spend authorization.
- Backup command concepts follow PostgreSQL guidance:
  https://www.postgresql.org/docs/current/backup-dump.html . This draft is not evidence
  that an actual backup or restore was performed.

Approval checklist: production targets + budget; compatible-schema/restore rehearsal;
verified media backup; known-good rollback target; credentials/domain/CORS; Basic-auth
risk decision; QA exclusion/retention; notifications policy; explicit final deployment.
