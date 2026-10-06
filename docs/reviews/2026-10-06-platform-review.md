# Final whole-branch review

Reviewed Petal `9db3fa9..76ee741` and Bloom `266538c..51c010d` against the approved platform design, master/subplans and execution rulings. This was a fresh-context, read-only code review; only this report was written. Reproductions used in-memory doubles or isolated temporary directories, never project data. No subagents were dispatched.

## Strengths

Published project fields remain separate from pending revisions, and public image access requires an approved project reference. Upload reservations are durable and quota checks run under an immediate transaction; upload completion rechecks access. Community collection reads and mutations consistently constrain the collection owner. Loader selection uses a generation counter to discard stale responses. Bloom constrains volume names, mount destinations and secret references and no longer imports application stdout into deployment errors.

## Critical

None identified at a severity requiring an unconditional emergency stop across all environments.

## Important — required fixes

### 1. P1 — A modpack update can overwrite another file without backing it up

Location: `D:/Documents/Petal/src/content.cjs:46` (ownership check), `:56` (rename), `:62` (rollback).

Trigger: a profile already has mod A at `mods/a-old.jar`; `mods/manual.jar` contains a manually installed file. A valid Petal modpack updates A but names its manifest target `mods/manual.jar`. The provider itself calls A's download `a-new.jar`.

`planInstall` validates provider filenames before the manifest target is applied. The later existing-target check accepts any installed record for the same source/project as ownership, even if that record points to an entirely different filename. It backs up `a-old.jar`, then renames A over `manual.jar`. The latter was never backed up. The same bypass can collide with a different tracked mod when the manifest renames the provider file; a subsequent save failure also cannot restore the overwritten file.

Observed isolated reproduction: `{"manualFileOverwritten":true,"modRecord":"manual.jar"}`. This is actual filesystem data loss, not an untested hypothetical.

Fix: validate final resolved destination paths against every installed/disabled mod and existing file. An existing target may be replaced only when that exact on-disk path is owned by the same installed record; include manifest target renames in collision checking. Test both successful installation and injected save failure, asserting unrelated tracked and untracked bytes stay unchanged.

### 2. P1 — The container omits the loader modules required to publish mods

Location: `D:/Documents/Petal/Dockerfile:7` (source copy allowlist), `D:/Documents/Petal/src/minecraft-metadata.cjs:58` (loader import).

Trigger: run the published Docker image and submit a Fabric/Forge/NeoForge/Quilt version through `POST /v1/projects/:id/versions`. That route calls `metadata.assertSelection`, which requires `./loaders/index.cjs`, but the Dockerfile copies only five top-level source modules and the panorama. `src/loaders/` is absent. Every mod version submission therefore fails with HTTP 500 even though startup/readiness can succeed.

Observed isolated reproduction: reconstructed the exact copied top-level source tree and called `assertSelection({version:'1.21.1',loader:'fabric'})` with a valid manifest fixture. Result: `MODULE_NOT_FOUND: Cannot find module './loaders/index.cjs'`.

Fix: ship the complete server-side dependency closure, including `src/loaders/` and `src/retry.cjs` (Forge/NeoForge import the latter at module load), or split listing code from launcher installation code. Add an image-context smoke test that creates a non-Vanilla release. This is a concrete packaging defect independent of the documented absence of a Docker host.

### 3. P1 — Restart cleanup can delete the retained rollback image

Location: `D:/Documents/Bloom/apps/api/src/deployments.mjs:195`; related new metadata update at `:111`.

Trigger: successfully deploy image A; stop and retry the project; interrupt Bloom while the new attempt is cloning/building, before the metadata update saves image B. At that moment the old container has been removed and `project.image` still names A. Startup reconciliation marks the new attempt failed and removes `project.image`, deleting the known-good rollback image. This violates the newly promised B4 recovery guarantee. Existing coverage only tests successful stopped retry, not interruption before metadata replacement.

Observed in-memory reproduction using the existing MemoryStore and the actual `DeploymentService.reconcile(true)`: `deletedKnownGood:true`, and the recorded removal argument was image A rather than the latest attempt's generated image tag.

Fix: cleanup must identify the image belonging to the interrupted deployment (for example `runtime.image(project.id, latest.id)` with the existing managed-image validation), never assume `project.image` belongs to that attempt. Add restart fixtures for cloning, building, and starting on a previously successful project; assert A remains and only the interrupted attempt is eligible for removal.

### 4. P2 — Minecraft 1.21 cannot select its NeoForge releases

Location: `D:/Documents/Petal/src/loaders/neoforge.cjs:11` through `:14`.

The optional `1.` prefix regex backtracks for a two-component Minecraft ID such as `1.21`, leaving captures `1` and `21`. The constructed Maven prefix becomes `1.21.` instead of `21.0.`. All compatible NeoForge 21.0.x releases are filtered out before their authoritative POM dependency can be checked. Users cannot create a NeoForge 1.21 profile or submit a corresponding hosted release.

Observed fixture: Maven metadata containing `21.0.167` and its POM containing neoform `1.21-20240613.000000`; `list('1.21')` returns `[]`.

Fix: parse the actual Minecraft components, default the omitted patch to zero for `1.x`, then retain the existing POM verification. Add fixtures for `1.21`, a three-component version such as `1.21.1`, and the newer numbering form already intended by this adapter.

## Minor

No additional polish findings raised; this review concentrated on consequential correctness and safety.

## Declined to judge / executor rulings requested

- Docker engine behavior, PostgreSQL migrations on a real server, Linux volume ownership, real SMTP/ClamAV connectivity, and Microsoft-owned game launch remain UNVERIFIED infrastructure acceptance. Their documented absence alone is not a defect. The Docker source-copy defect above is independently reproduced.
- Pre-1.6 Forge, exhaustive historical launches, native mrpack/CurseForge pack conversion, bundled overrides, automatic shader-loader installation, public collection sharing and email broadcasts are excluded by the recorded execution rulings and were not scored as missing implementation.
- Password reset currently revokes account sessions but leaves separately issued scoped API tokens valid (`api/accounts.cjs:80`). The plan specifies independently revocable API credentials without defining password-reset coupling. Executor should explicitly choose this lifecycle policy; it was not included as an additional confirmed defect.

## Assessment

Ready to merge: **With fixes / request changes**. Fix the four actionable defects before claiming completion. The first and third defeat data/recovery preservation, the second blocks the central container publishing workflow, and the fourth hides a supported loader/version combination. No evidence from this review invalidates the reported 76 Petal/60 Bloom unit-test results; the isolated reproductions demonstrate cases those suites miss. Full suites and external infrastructure checks were not rerun in this review.


Executor disposition: all four Important findings were reproduced RED and fixed in the single final pass. Full suites pass 79/79 Petal and 61/61 Bloom. Account recovery also invalidates scoped tokens. See ../DELIVERY.md for evidence and pending infrastructure acceptance. No second review was dispatched.
