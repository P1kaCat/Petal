# Petal Web and API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver public discovery, recoverable accounts, author publishing, moderated revisions, and a documented API before adding further content types and community features.

**Architecture:** Split the current CommonJS HTTP service into focused modules while preserving `createPetalServer(options)` and launcher-consumed `/v1` fields. Keep same-origin website delivery, transactional SQLite migrations and immutable file storage. Every feature has an independent local acceptance path; public mode requires working mail, privileged MFA, and publication safeguards.

**Tech Stack:** Node.js 24+, node:sqlite, built-in HTTP/crypto/streams, yauzl, existing HTML/CSS/JS; maintained mail, MFA and sanitization libraries selected only after API/security review.

**Spec:** [Approved platform specification](../specs/2026-10-05-petal-platform-design.md), sections 5–8, 10–11.

## Global Constraints

- Inherit every constraint from [the parent plan](2026-10-05-petal-platform.md).
- Preserve `/v1`, current camelCase response fields, existing scrypt passwords and published-file checksums.
- Pending files and revisions are private. Published bytes are immutable. Role checks occur on every protected operation.
- Website sessions use HTTP-only cookies and CSRF protection; scoped API bearer tokens are separate credentials.
- Public publishing requires verified email; development mail is loopback/operator-only and ignored by Git.

## Review Focus

- Migrating an existing populated database: P1 rollback/upgrade fixtures.
- Reset-token replay and privilege changes during an active session: P3 tests.
- Unapproved description/image edits on a published project: P4 tests.
- Parallel uploads, disk failures and restart orphan cleanup: P5 tests.
- Stored script payloads, cross-origin forms and guessed draft URLs: P2/P3/P4 tests.

## File map and interfaces

- `api/server.cjs` retains startup and `createPetalServer(options)`; extract routing into `api/http.cjs` and `api/routes/{auth,projects,versions,moderation}.cjs` as relevant tasks land.
- `api/db.cjs`: `openDatabase(dataDir) -> DatabaseSync`, `migrate(db) -> void`; `api/migrations/001-preview.cjs` adopts existing tables without deleting data; later numbered migrations extend them transactionally.
- `api/auth.cjs`: `authenticate(req) -> Promise<Principal|null>`, `requirePermission(principal, action, resource) -> void`; `Principal = { id, roles, sessionId, scopes }`.
- `api/accounts.cjs`: `register({ username,email,password })`, `login({ identifier,password })`, `issueRecovery(email)`, `redeemRecovery(token,newPassword)`, `verifyEmail(token)`, `revokeSession(userId,sessionId)`; all async, mutations return public views only.
- `api/mail.cjs`: `send({ to,template,variables }) -> Promise<void>` with operator-local and SMTP adapters.
- `api/projects.cjs`: `proposeRevision(principal,projectId,input) -> Promise<Revision>`, `publicProject(projectId) -> ProjectView|null`; `api/moderation.cjs`: `decide(principal,{ revisionId,action,reason }) -> Promise<Decision>`.
- `api/storage.cjs`: `reserveUpload({ userId,versionId,size }) -> Reservation`, `commitUpload(reservation,{ checksum,storageKey })`, `cancelUpload(reservation)`, `collectAbandoned({ before })`; `api/archives.cjs`: `validateArchive(filePath,type) -> Promise<ArchiveReport>`.
- `api/tokens.cjs`: `issueScopedToken(principal,{ name,scopes,expiresAt })`, `revokeScopedToken(principal,tokenId)`; `api/audit.cjs`: `recordAudit({ actorId,action,targetId,requestId })`.
- Shared public records: `Revision = { id, projectId, status, content, createdAt }`, `Decision = { id, revisionId, action, reason, actorId, createdAt }`, `ProjectView` preserves current `/v1/projects/:id` fields and adds type/category/revision fields. `Reservation = { id,userId,versionId,size,expiresAt }`, `ArchiveReport = { type,entryCount,expandedBytes,descriptors }`. Methods never return stored password/token hashes.
- Website: retain `api/public/portal.{js,css}` for creator flows; add `api/public/{site.js,site.css,discover.html,project.html,profile.html,account.html}` and a real SVG flower/favicon if needed. Share only safe view-formatting functions in `api/public/ui.js`.
- Tests: `test/{migrations,accounts,publication,storage,web,contract,content,community}.test.cjs`; docs: `api/openapi.yaml`, `docs/OPERATIONS.md`, `docs/CONTENT_POLICY.md`.

### P1. Modularize the server with lossless migrations

**Consumes:** Existing `createPetalServer(options)` and preview SQLite schema. **Produces:** `openDatabase`, `migrate`, focused routing with unchanged preview responses.

- [x] Write `test/migrations.test.cjs`: populate a preview DB with user/session/project/published file, migrate twice, assert `assert.equal(published.sha512, original.sha512)` and unchanged ownership. Inject a failed migration and assert no partial schema version is recorded.
- [x] Run `node --test test/migrations.test.cjs`; require failure before migration support.
- [x] Extract DB lifecycle and HTTP response/body handling, add a migration ledger and transactional migration runner, and keep startup API compatible. Centralize permission plumbing without changing current authorization behavior.
- [x] Run migration tests plus `test/api.test.cjs`; compare public JSON fields and successful launcher install before/after restart.
- [x] Commit `refactor: modularize Petal API and adopt schema migrations`.

### P2. Deliver public discovery and project pages

**Consumes:** Current `/v1/search`, project/version endpoints and P1 routing. **Produces:** `/`, `/discover`, `/projects/:id`, `/users/:username`, and `/dashboard` views.

- [x] Write `test/web.test.cjs`: public search pagination, zero-result state, unpublished project 404, escaped malicious titles/descriptions, allowed source links and actual download counts. Assert `assert.equal(publicPending.status, 404)` and no executable markup in rendered user text.
- [x] Run `node --test test/web.test.cjs`; require missing public pages/behavior to fail.
- [x] Move creator workflows to `/dashboard`; implement branded discovery, project/version/dependency detail and author profiles. Add bounded filters/sort using stored metadata. Use approved content only, sanitization for rich descriptions, safe link/image origins and explicit empty/error states.
- [x] Verify real public/author navigation at 1440px and 390px, keyboard focus, accessible labels, and script-payload fixtures; run web and API tests. Capture genuine screenshots without production fixture records.
- [x] Commit `feat: add Petal public discovery and project website`.

### P3. Add recoverable accounts, sessions and privileged access

**Consumes:** P1 DB/permission interfaces. **Produces:** accounts/mail services and authenticated user/moderator/admin principals.

- [x] Write `test/accounts.test.cjs`: scrypt migration login; cookie flags; CSRF rejection; verify/reset token expiry and replay; generic reset responses; revoked session; removed moderator role; disabled public master token; MFA requirement. Assert `assert.equal(reusedReset.status, 400)` and `assert.equal(removedModerator.status, 403)`.
- [x] Run account tests; require failure for missing recovery/MFA flows.
- [x] Implement email and hashed single-use tokens with 30-minute reset expiry and 24-hour email-verification expiry, session listing/revocation and 24-hour sessions. Preserve scrypt parameter records. Add HTTP-only SameSite=Lax cookies with Secure in HTTPS mode and random CSRF token validation. Add public-mode email checks, one-time operator bootstrap, and maintained TOTP verification with hashed single-use recovery codes for privileged roles. Provide operator-local mail and configured SMTP, never a public token-preview endpoint.
- [x] Run account/API regressions and browser signup→verification→login→logout→reset, including unavailable mail feedback. Document and test migration from preview bearer portal sessions; API bearer callers remain separately supported.
- [x] Commit `feat: add recoverable accounts and privileged session security`.

### P4. Add moderated project revisions, teams and reports

**Consumes:** P3 principals; P1 transactions. **Produces:** `proposeRevision`, `publicProject`, `decide` and membership authorization.

- [x] Write `test/publication.test.cjs`: owner edits published title/icon/license, previous revision remains public until approval, rejection retains old content, immutable bytes, unauthorized team invite/transfer, private review notes and report visibility. Assert `assert.equal(publicProject.title, oldTitle)` before approval and after rejection.
- [x] Run publication tests; require failure for preview's missing revision/team behavior.
- [x] Add revision/member/report/decision tables and audit records; implement author preview and moderator queue with reasons, approve/reject/withdraw actions and owner-only membership/ownership controls. Validate/re-encode uploaded raster icons/gallery items, reject active image formats and sanitize descriptions. Publish revision/file references in one transaction.
- [x] Verify author→reviewer→public flows and concurrent review conflict behavior; run publication/account/API regressions. Document distribution declarations and reporting policy without changing hosted author licenses.
- [x] Commit `feat: moderate project revisions and author teams`.

### P5. Enforce storage quotas, quarantine and crash cleanup

**Consumes:** P4 publication state. **Produces:** storage reservations, type-aware validators, scanner adapter and collection policy.

- [x] Write `test/storage.test.cjs`: 64 MB file boundary, four concurrent uploads, 2 GB configured global cap, default 256 MB author cap, concurrent quota reservation, simulated disk-full, abandoned upload restart, referenced-file retention, scanner failure and unsafe archive entries. Assert `assert.equal(overQuota.status, 413)` and no published file after scanner failure.
- [x] Run storage tests; confirm missing persisted reservations/cleanup fail.
- [x] Persist reservations transactionally, stream into quarantine, compute SHA-512, cancel on failure, and reconcile reservations/orphans on startup. Add 24-hour abandoned-draft cleanup and 7-day withdrawn-file retention, skipping referenced files. Keep scan adapter non-executing; public mode cannot publish unscanned files unless the operator explicitly configures a documented manual review policy. Enforce 30,000 entries and 1 GB declared expanded archive limit; verify byte limits while streaming.
- [x] Run storage/publication tests with injected clock/disk/scanner failures and restart; inspect temp/storage cleanup without broad filesystem deletion.
- [x] Commit `feat: enforce durable upload quotas and quarantine cleanup`.

### P6. Publish API contracts and scoped tokens

**Consumes:** L2/L3 compatibility metadata and P1–P5 services. **Produces:** OpenAPI 3.1, permission-bound tokens, consistent public errors and collection pagination.

- [x] Write `test/contract.test.cjs`: token scopes, expiry/revocation, missing pagination bounds, consistent problem-details errors, unchanged legacy launcher fields and pending-download denial. Assert `assert.equal(readOnlyWrite.status, 403)` and `assert.equal(page.items.length <= page.limit, true)`.
- [x] Run contract tests; require failures for missing scopes/problem details.
- [x] Implement scoped token endpoints and public request IDs; standardize new errors while preserving documented preview transition. Describe every shipped route in `api/openapi.yaml`, examples/auth/limits included. Keep existing offset/limit search; new lists use stable cursor pagination with maximum 100 items. Redact secrets in logs and reject oversized bodies before processing.
- [x] Validate with `pnpm dlx @redocly/cli lint api/openapi.yaml`, check representative responses against schemas, run contract/API tests and a real launcher download from a local approved fixture.
- [x] Commit `feat: document Petal API and add scoped access tokens`.

### P7. Demonstrate health, backups and restore

**Consumes:** P1 DB and P5 storage. **Produces:** `/health`, `/ready`, backup/restore scripts and operations guidance.

- [x] Write storage/operations tests for unwritable data directory, unavailable DB, no secret-bearing readiness fields, and restored file hash equality. Assert `assert.equal(unready.status, 503)` and restored user credentials still authenticate.
- [x] Run focused tests; require absence of restore/readiness support to fail.
- [x] Add DB/storage readiness and structured sanitized event logs. Create `scripts/backup-api.cjs` using SQLite's backup API and immutable referenced-file copies, plus `scripts/restore-api.cjs` that refuses a populated target. Write checksummed backup manifests and protected configuration guidance; document daily schedule and retention as operator configuration.
- [x] Restore a populated synthetic instance into a separate directory, verify accounts, publication states and downloads byte-for-byte, and run full tests. Record exact evidence in `VERIFICATION.md` and `docs/OPERATIONS.md`.
- [x] Commit `feat: verify platform readiness and backup restoration`.

### P8. Add resource packs, shaders, datapacks and modpacks

**Consumes:** P5 `validateArchive(filePath,type)`, L5 isolated install pipeline and P6 API. **Produces:** versioned Petal pack manifest and type-specific installation targets.

- [x] Write `test/content.test.cjs`: `.zip` pack metadata, correct destinations, ZIP traversal/bomb rejection, optional/required dependencies and permission-blocked external pack files. Assert no archive entry can escape the instance and dependency failures leave prior installation intact.
- [x] Run content tests; require missing type-aware validation/install paths to fail.
- [x] Implement validators for resource-pack `pack.mcmeta`, shader archive structure, datapack `pack.mcmeta`, and Petal pack manifest formatVersion=1. Define manifest schema in `api/schemas/pack-v1.json` with content source/version/checksum and safe relative target. Map resource packs to `resourcepacks`, shaders to `shaderpacks`, and datapacks to an explicitly selected world's datapacks directory. Acquire pack dependencies through provider-authorized APIs; no automatic mirroring.
- [ ] Verify representative synthetic archives and real permissioned downloads in isolated profiles, including rollback and world selection. Update API schema, website type filters and content documentation. **Status: code/unit evidence complete where applicable; external acceptance pending. See VERIFICATION.md and docs/DELIVERY.md.**
- [x] Commit `feat: host and install additional Minecraft content types`.

### P9. Add follows, collections and in-app notifications

**Consumes:** P3 accounts, P4 approved revisions. **Produces:** bounded account-owned community resources.

- [x] Write `test/community.test.cjs`: follow/unfollow idempotency, private collection ownership, published-only collection items, notification creation only on approval and bounded pagination. Assert an unrelated account receives 404 for a private collection.
- [x] Run community tests; require missing routes to fail.
- [x] Add follow/collection/notification tables and corresponding `/v1` resources; deliver account views, per-user read/unread state and notification preferences. Avoid generating email broadcasts or external messages automatically.
- [x] Verify author publication creates only intended followers' notifications, withdrawn content is not downloadable through collections, and pagination remains bounded; run full tests and update OpenAPI.
- [x] Commit and push `feat: add project follows and personal collections`.
