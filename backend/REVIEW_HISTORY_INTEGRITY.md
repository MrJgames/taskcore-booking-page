# Inspection review-history integrity check

Scope: inspection findings/reviews and their linked media and decision history.
No authentication, schema, production resource or payment changes.

## Write-path inventory

| Path | Context check | Disposition |
| --- | --- | --- |
| PUT /api/tech/inspections/:id | Authenticated technician owns editable inspection; supplied existing findings and checklist links must belong to the retained finding set | Fixed unscoped ID upsert; validate whole batch before writes; existing finding update remains inspection-scoped |
| PATCH /api/admin/inspections/:id/review | Basic-auth owner; inspection must be Submitted/Ready; every supplied finding belongs to this inspection | Fixed missing membership check before maintenance details/history writes; verify main update matched exactly one row |
| POST /api/reports/:token/findings/:findingId/decision | Hashed unexpired token for Published inspection; finding comes from that inspection and requires approval | Already scoped; new mismatch regressions |

These are the only writers of maintenance_finding_events and
inspection_decision_events found in application source. Event IDs are generated
server-side; there is no endpoint that edits/deletes an individual history event.
Operations job events, property audit and session activity are separate systems.

Media upload verifies technician ownership and finding-to-inspection membership.
Media delete binds technician, inspection and media IDs. Owner media queries bind
inspection/media IDs; client media requires a valid report token and membership.
History payloads have no writable media ID; checklist finding references now share
the draft membership validation. Owner has global authority in this application;
there is no separate owner-account tenancy model to change here.

## Reproduction and fix

Before the fix, isolated requests pairing inspection A with finding B returned 200
for both owner review and technician autosave. Owner review's main finding update
was scoped, but unchecked detail/history writes still targeted B. Technician
autosave's conflict update used only finding ID, allowing another technician's
known finding ID to target unrelated data. This is a genuine integrity/authorization
defect, not a browser limitation. No attempt was made against real customer data.

Shared validation reads findings under the intended inspection, rejects foreign,
nonexistent and duplicate IDs and invalid retained checklist references, and runs
inside the transaction before its first write. New findings receive server IDs;
supplied IDs denote existing findings. No silent upsert of a supplied foreign ID
remains. Errors are generic and do not reveal which IDs exist or their data.

Regression scenarios include a valid item followed by a foreign/nonexistent/event
ID or duplicate item, unchanged snapshots of inspections/findings/details/history,
another technician's inspection, linked foreign media/checklist findings, real
technician/manager/vendor sessions denied owner review, a nonexistent history route,
cross-report repair decisions, and legitimate owner/draft/decision history appends.

## Limits and follow-up

- Tests use isolated local PostgreSQL emulation and existing backend coverage;
  hosted smoke results must be recorded separately, not inferred from tests.
- No historical records were rewritten or purged. Existing possible corruption
  requires a separately scoped read-only data audit and approved remediation.
- Existing draft finding removal can leave detached history because the history
  table has no foreign key. Preserve it pending an explicit retention policy.
- Concurrent workflow-state changes and idempotency/session-activity behavior are
  separate review areas; this targeted change does not certify the entire system.
- Basic authentication and owner-reported dashboard access remain unchanged;
  automated owner browser verification is still limited by credential isolation.
