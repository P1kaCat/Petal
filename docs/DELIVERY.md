# Petal platform delivery

Delivery checkpoint: **October 6, 2026 · Windows alpha 0.2.0**.

Petal now combines a Minecraft Java launcher with its own moderated content
platform. Authors can manage accounts and teams, submit projects and releases,
and receive a review before publication. Players can discover approved content,
install it into separate profiles, follow projects and keep private collections.
The website and API run locally as one service. Bloom has the code needed to
attach persistent Petal data and private configuration to managed containers.

**The implementation checkpoint is complete; production acceptance is not.**
Launcher tasks L1–L5 and platform tasks P1–P9 are implemented and have local
verification evidence. Bloom tasks B1–B4 are implemented and covered by static
and unit checks. Docker execution, real PostgreSQL integration, Linux ownership
and a public rollout remain unverified because no suitable host was configured.
This is an alpha, not a claim of Modrinth feature parity or production readiness.

## Delivered scope

| Area | Implemented behavior | Practical boundary |
| :--- | :--- | :--- |
| Minecraft versions | Official release, snapshot, historical beta and alpha categories; safe version identifiers and cached metadata. | Listing a historical version does not establish that its full runtime works on every machine. |
| Loader selection | Vanilla, Fabric, Forge, NeoForge and Quilt; compatible loader versions and stale-response protection in the profile dialog. | Forge before Minecraft 1.6 is excluded. NeoForge exposes the latest 30 matching, POM-verified builds. |
| Launcher installation | Isolated profiles, official game/runtime preparation, required dependency resolution, checksums, declared conflict checks and staged content installation. | Actual gameplay with an owned Minecraft account has not been verified. |
| Public website | Discovery filters, project pages, author pages, an API guide, an account page, a creator dashboard and a personal library. | The actual local public catalog is empty unless authors publish approved content. Test fixtures are not production listings. |
| Accounts | Email verification and recovery, cookie/CSRF protection, authenticator MFA, recovery codes, session management and scoped API tokens. | Real SMTP delivery and public HTTPS behavior require host acceptance. Password recovery revokes sessions and API tokens while preserving MFA. |
| Publication | Private submissions, moderated revisions, author teams, ownership transfer, reports, image validation and approved release downloads. | Pending edits keep the last approved public state. Authors remain responsible for rights to their uploads. |
| Storage | Durable reservations, author/global quotas, bounded archives, quarantine, scanner integration, cleanup and retained pinned release references. | A real ClamAV daemon has not been exercised. Run one API process per data directory. |
| API and recovery | Versioned OpenAPI contract, scoped tokens, bounded pagination, safe errors, readiness, checksummed backups and isolated restore. | Readiness checks configured requirements; it does not prove that an external mail server or scanner is reachable. |
| Content types | Mods, resource packs, shaders, datapacks for an explicitly selected world and reference-based Petal modpacks. | External provider permissions still apply. Shaders need an existing compatible runtime. |
| Community | Follows, private collections, approval-triggered in-app notifications, recipient preferences and read state. | Collections are private; notifications are not email broadcasts. |
| Bloom hosting | API-only container definition, per-project named volumes, protected file references, stopped retries and retained rollback images. | Linux Docker, PostgreSQL and actual deployment acceptance are pending. Bloom changes belong to its own repository. |

The product interface and repository documentation are in English. The violet
flower identity and genuine Minecraft imagery are retained. The restricted
repository license and GitHub proposal workflow remain in place; hosted content
keeps its author's license. No generated illustrations, bundled service keys or
production credentials are part of this delivery.

## Verification evidence

These results describe the final local checks supplied for this delivery, not
external infrastructure acceptance.

| Check | Result |
| :--- | :--- |
| Petal automated suite, run sequentially | **79/79 passed** |
| Bloom automated suite | **61/61 passed** |
| OpenAPI lint | **Valid, zero warnings** |
| Source Electron UI smoke | **6/6 passed** |
| Unpacked Windows application UI smoke | **6/6 passed** |
| Final Windows portable build | **Passed**; fresh unsigned `dist/Petal 0.2.0.exe`, 416,693,996 bytes. |
| Final portable executable UI smoke | **6/6 passed**, process exit 0, with fresh isolated smoke data. |
| Official game/runtime preparation | Six isolated preparations and complete launch-argument checks passed: Vanilla 1.21.1, Vanilla 24w14a, Fabric 0.19.5, Forge 52.1.16, NeoForge 21.1.255 and Quilt 0.30.1; modded cases used Minecraft 1.21.1. |
| Public website in the actual browser | Inspected at 390px and 1440px without horizontal document overflow; discovery, resource-pack filtering and separate creator/account entry points exercised. |
| Account and publication browser flows | Isolated synthetic sign-in, verification, logout, recovery request and moderated revision visibility exercised. Password changes were covered through HTTP tests. |
| Community browser flows | An isolated account created a private collection, followed an approved test project and saved it to the collection. |
| Populated backup and restore | Normal and MFA login, identical approved download bytes/checksums, private pending files and refusal of corrupt or populated restore targets verified locally. |
| Docker/PostgreSQL/public host | **Not run on actual infrastructure**. Integration fixtures and operator procedures are provided. |

The six Electron checks cover profile creation, a real Sodium installation,
persistent settings, rejection of an unknown IPC method, snapshot selection and
invalid loader selection. Smoke runs use isolated data and `--disable-gpu`
because of an offscreen rendering issue in the capture environment. That does
not establish a requirement for every user's graphics configuration.

The live official manifest contained 917 validated entries when checked. The
catalog remains dynamic; this number is not a hardcoded support limit. Real
preparation and argument generation do not constitute an authenticated game
launch or exhaustive validation of historical Minecraft releases.

Detailed checkpoint evidence is in [VERIFICATION.md](../VERIFICATION.md).
Private integration data and local execution logs remain in ignored artifact
directories. No real account secrets or production fixtures are published.

## Independent review and corrections

One fresh-context whole-branch review examined Petal's platform changes and the
corresponding Bloom changes. It raised four Important findings, no Critical
findings and no additional Minor findings. One correction pass addressed the
four findings, with regression checks demonstrating the failing cases before
the fixes and the passing behavior afterward. The final full suites above passed
after that pass; no second independent review is claimed.

| Finding | Correction |
| :--- | :--- |
| A manifest target could rename an updated mod over an unrelated existing JAR. | Installation checks ownership of the exact final destination, including manifest target names, and refuses unrelated existing files. The regression preserves the unrelated bytes and the installed record. |
| The API image omitted loader modules used when submitting a non-Vanilla release. | The Docker source copy includes the loader directory and retry module. A dependency-closure regression checks relative runtime imports against the image copy allowlist. This verifies packaging inputs, not an actual Docker build. |
| Bloom restart reconciliation could delete the previous successful image while a replacement was cloning or building. | Cleanup identifies the interrupted attempt's generated image rather than assuming the project's saved image belongs to it. Restart regressions cover cloning, building and starting while retaining the known-good image. |
| Minecraft 1.21 did not select NeoForge 21.0.x because an optional-prefix expression backtracked incorrectly. | Minecraft components are parsed explicitly and a missing patch defaults to zero; authoritative POM verification remains. |

Two additional finishing corrections were made: **Your account** opens
`/account`, and password recovery revokes scoped API tokens as well as sessions.
The latter resolves the review's requested credential-lifecycle decision:
recovery invalidates previously issued credentials, so integrations must create
new tokens afterward. MFA enrollment remains intact.

This review and the regression suites are development evidence. They are not a
claim of an independent security audit, a tested Linux deployment or universal
Minecraft compatibility.

## Executor decisions, in chronological order

The following decisions record how the approved plan was executed and the cost
if a decision proves unsuitable. They are included so future changes can revisit
the tradeoffs without silently widening the delivered scope.

| Checkpoint | Decision | Cost if unsuitable or wrong |
| :--- | :--- | :--- |
| Start | Preserve the active checkout and its existing API work on `codex/petal-platform`; execute directly as approved by the user. | Shared pre-existing work requires careful attribution and review; switching checkouts later would need a deliberate transfer. |
| Start | Use a Windows-native execution ledger and the plan's L/P/B task identifiers because the installed brief scripts expect different task headings. | Automation expecting the original brief format cannot consume the ledger directly; evidence must remain equivalent and readable. |
| Pre-flight | Coordinate the shared game-version/loader interfaces; preserve preview rows during migration; implement readiness before container acceptance. | Interface drift or a mistaken migration dependency could break profile selection, existing accounts or deployment sequencing. |
| L1 | Keep the new L2 regression out of the baseline commit until its implementation passes. | Baseline verification does not cover the future feature; that coverage must land with the corresponding implementation. |
| L2 | Preserve the existing versions IPC array until the coordinated renderer upgrade; add authoritative loader choices through L3. | The transitional interface needs coordinated follow-up and cannot independently expose the final selection model. |
| L3–L5 | Commit the shared loader, IPC, UI and hosting interfaces together. Limit NeoForge to the latest 30 POM-verified matching builds; document pre-1.6 Forge and exhaustive historical launch exclusions. | A broader commit needs coordinated review, and users needing older loader builds or historical runtimes may need later adapter work. |
| P1 | Extract route services as their features arrive while retaining the existing service behavior. | Some server structure remains shared; future complexity may require further extraction. |
| P2 | Preserve Petal's actual branding and product captures after the design helper returned broad marketplace guidance. | The result may need later design iteration, but no fabricated testimonials or irrelevant marketplace content are introduced. |
| P3 | Retain salted scrypt and existing parameter records. Exercise password changes through HTTP tests while browser automation covers the other account flows. | A later password-parameter migration needs explicit compatibility work; the browser password-change interaction has less direct visual evidence. |
| P4 | Render descriptions as escaped plain text; validate and re-encode raster images, with changes subject to revision approval. | Rich-text authoring is unavailable, and image conversion may discard source metadata or formats authors wanted to retain. |
| P4 | Restore the creator portal's Quilt choice and official-version datalist observed missing during browser checks. | These controls still depend on official metadata availability and require visible error handling when providers fail. |
| P5 | Run test files sequentially after Windows virtual-memory exhaustion; retain focused concurrent-upload checks within the suite. Include the previously omitted documented bootstrap script. | File-level scheduling races receive less concurrent execution; the deliberate concurrency regressions must continue covering upload invariants. |
| P6 | Invoke the OpenAPI linter with an explicit pnpm package/executable selection. Reject invalid search bounds with 400 while preserving valid offset/limit compatibility. | Clients that relied on silently accepted malformed bounds must correct their requests; reproducible tooling depends on the explicit invocation. |
| P7 | Record required external secret-manager configuration in backups without exporting those environment credentials into the manifest. | Operators must preserve external secrets separately; a database/file backup alone cannot restore an installation that has lost its encryption key or provider configuration. |
| B1 | Use a separately pinned API-only dependency lock for the container. | Runtime dependencies need maintenance in both the desktop and API packaging contexts; an omitted import can otherwise pass local startup and fail in the image. |
| B2 | Opt into storage through restricted Petal image labels, fixed `/var/lib/petal` and UID 1000. Change only the mount root with the ownership helper. Retain named volumes after project deletion. | Other app/storage layouts need an explicit extension; retained volumes consume operator-managed disk space, and real Linux ownership remains an acceptance check. |
| B3 | Keep secret values outside dashboard settings and PostgreSQL runtime configuration. Use protected regular files and read-only mounts; never import application stdout into dashboard errors. | Operators must provision and rotate files on the host; detailed startup diagnosis requires private host logs. Incorrect host permissions can still prevent startup. |
| B4 | Retain previous successful images until explicit operator pruning and refuse live redeployment. Use stopped retries with the same data/configuration. | Old images consume disk and upgrades require downtime; an image rollback still needs a schema-compatible snapshot. |
| P8 | Define Petal pack v1 as references to pinned provider files; exclude bundled overrides and native `.mrpack`/CurseForge conversion. Preserve provider download permissions. Require an existing shader runtime. | Some popular packs need later conversion support or manual setup; a provider's disabled third-party download cannot be bypassed. |
| P9 | Deliver private collections and in-app approval notifications with explicit account limits and 500 retained notifications. Exclude public sharing and email broadcasts. | Community discovery/sharing is limited, old notifications expire from retention and users cannot receive update emails from this checkpoint. |
| Final review | Perform one independent whole-branch review and one correction pass, then verify the final code with full suites. | Fixes have regression evidence but no second independent review; consequential future changes should receive their own review. |
| Final corrections | Protect exact destination ownership, include the API runtime import closure, preserve Bloom's known-good image and parse NeoForge components explicitly. | Incorrect future extensions can reintroduce data loss, packaging failures, lost rollback images or hidden version choices; the regressions must remain. |
| Recovery policy | Revoke scoped API tokens on password recovery as well as sessions, preserving MFA. | Existing integrations stop after recovery and must issue new tokens; this is a deliberate credential invalidation policy. |
| Delivery | Keep actual Linux, PostgreSQL, mail, scanner, CurseForge and owned-game acceptance pending until suitable infrastructure/credentials exist. | The implementation can still fail in those environments; publication must not be treated as proof that deployment acceptance passed. |
| Windows packaging | Disable portable archive compression after repeated allocation failures on the 8 GB development PC; build with a 512 MB JavaScript heap and compression level 0. | The unsigned portable executable is approximately 417 MB, so downloads and storage are larger. This changes archive size rather than supported product behavior. |
| Repository publication | Publish the Petal and Bloom changes as two draft pull requests without merging, keeping Linux acceptance visible to reviewers. | The repositories' main branches do not yet include this platform; a later merge is needed before cloning the default branch provides these changes. |

There are **no deferred Minor findings from the independent review**. Scope
exclusions and unverified acceptance checks below are tracked separately from
review severity; they have not been relabeled as completed features.

## Explicit exclusions and limitations

- Forge installers before Minecraft 1.6 and exhaustive runtime/gameplay checks
  across all historical Minecraft versions.
- Native Modrinth `.mrpack` or CurseForge modpack conversion and bundled pack
  overrides. Petal v1 packs reference pinned files rather than embed external mods.
- Automatic installation of a shader loader or runtime.
- Multiple Microsoft accounts in the launcher.
- Public collection sharing and notification email broadcasts.
- Automatic recovery after a process crash during launcher file replacement.
  Handled installation/persistence errors have rollback coverage; a forced
  process termination is a different failure mode.
- A distributed or multi-writer API deployment. Operate one process per data
  directory; no horizontal scaling or capacity claim is made.
- An approved CurseForge API key, an approved Microsoft application registration,
  an authenticated owned-game session, and a public production deployment.

Declared compatibility and collision checks cannot guarantee that arbitrary
mods work together. Matching names across catalogs do not merge project identity.
Petal does not automatically mirror third-party projects or bypass an author's
distribution choice.

## Remaining acceptance before public operation

The host must be configured before these checks can produce meaningful evidence.
Keep the current implementation and local test results distinct from the
following uncompleted acceptance steps:

1. **Linux image and volume:** build the actual root image, run
   `node scripts/container-smoke.mjs`, verify non-root writes, readiness and data
   persistence after container recreation. Submit a non-Vanilla release through
   the running image to verify the publishing dependency path.
2. **Bloom PostgreSQL and Docker:** run its
   `node --test tests/database.integration.mjs` against a test PostgreSQL database
   and `node tests/docker.integration.mjs` on the intended Docker host. Verify
   migrations, per-project volumes, host ownership and protected file mounts.
3. **Bloom replacement and failure recovery:** deploy Petal, publish an isolated
   approved fixture and verify it across Bloom restart and stopped retry. Exercise
   failed startup, port collision and interrupted replacement without losing
   files, private references or the previous successful image. Retained data and
   images require an explicit operator retention/pruning policy.
4. **Mail, scanner and HTTPS:** deliver verification/recovery mail using the real
   provider, exercise the actual scanner, test HTTPS cookie/CSRF/MFA behavior and
   protect Bloom's operator surface with a trusted network or authenticated
   gateway. Configuration presence in readiness is insufficient evidence here.
5. **Host backup and restore:** take a populated snapshot on the host, preserve
   external secrets separately, restore into an isolated empty target and verify
   normal/MFA login, pending privacy and byte-identical approved downloads before
   any traffic switch. Record the image/schema pair for rollback.
6. **Authorized external integrations:** exercise CurseForge with an approved key,
   then Microsoft sign-in and an authenticated Minecraft game session with the
   project's own approved application registration.
7. **Public rollout:** use a configured HTTPS origin, confirm the acceptance above,
   define operator access and backup retention, and perform a separate rollout
   review. No production endpoint or capacity has been invented for this delivery.

## Operator and contributor references

- [Setup and launcher configuration](SETUP.md)
- [Petal API and creator portal](../api/README.md)
- [Accounts, email, MFA and bootstrap](ACCOUNTS.md)
- [Storage and scanning policy](STORAGE.md)
- [Content rights and publication policy](CONTENT_POLICY.md)
- [Supported content and Petal pack format](CONTENT_TYPES.md)
- [Follows, collections and notifications](COMMUNITY.md)
- [Readiness, containers, backup and restore](OPERATIONS.md)
- [Bloom hosting and pending acceptance](https://github.com/P1kaCat/Bloom/blob/codex/petal-hosting/docs/PETAL_HOSTING.md)
- [Approved platform specification](superpowers/specs/2026-10-05-petal-platform-design.md)
- [Master implementation plan](superpowers/plans/2026-10-05-petal-platform.md)
- [GitHub contribution workflow](../CONTRIBUTING.md) and [repository license](../LICENSE)
