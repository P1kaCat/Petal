# Petal validation

Checks performed on Windows on October 4, 2026 for the 0.1.0 alpha and the
0.1.1 banner update. Unit tests were rerun successfully on October 5, 2026.

| Check | Result |
| :--- | :--- |
| Persistence, API, dependency, installation, and retry tests | 13 passed |
| Electron startup with the real IPC bridge | Passed |
| Profile creation through the UI | Passed |
| Live Modrinth search | Passed |
| Real Sodium installation through the UI | Passed |
| Persistent settings with Windows secure storage available | Passed |
| Rejection of an unknown IPC method | Passed |
| Installation of Iris and its required Sodium dependency | Passed |
| Minecraft 1.21.1 + Java 21 + Fabric 0.19.5 preparation | Passed |
| Minecraft 1.21.1 + Java 21 + Forge 52.1.0 preparation | Passed |
| Minecraft 1.21.1 + Java 21 + NeoForge 21.1.255 preparation | Passed |
| Launch arguments for all three profiles | Passed; no unresolved parameters |
| Windows portable build | Passed |
| Packaged executable UI checks | Passed: profile, Sodium, settings, IPC |
| CurseForge with an authorized API key | Not verified; no key supplied |
| Microsoft authentication and an authenticated game session | Not verified; no account or approved client ID supplied |

Initial game preparation encountered network failures. A retry completed the
cache; bounded connection pooling and three retry attempts were then added.
The three loader profiles and launch arguments were checked again afterward.

Integration data is isolated in ignored `artifacts/` folders. No existing
Minecraft installation was changed. Local reports are written to
`artifacts/integration/report.json` and `artifacts/smoke-final/checks.json`.
The documentation [Discover screenshot](docs/media/discover.png) and
[Profiles screenshot](docs/media/profiles.png) are unmodified real UI captures.

These game preparation results apply to the specific versions above. They do
not verify every Minecraft version, every mod combination, or actual gameplay.

## Version 0.1.1 visuals

The banner uses the original cherry-grove title panorama from Minecraft Java
1.20.6. Its hash matches the official Mojang asset index. The earlier proposed
generated illustration was removed from application assets. Layout and text
legibility were inspected in the actual Electron UI, and all four UI smoke
checks passed with this banner.

## Version 0.1.2 English interface

All application-owned labels, accessible names, placeholders, notifications,
validation errors, progress messages, and file-picker titles now use English.
Number formatting uses the English locale. User-entered profile names and
third-party catalog content are preserved.

On October 5, 2026, all 13 automated tests passed with the translated error
messages. The actual Electron UI smoke checks passed for profile creation,
real Sodium installation, persistent settings with secure storage, and
rejection of an unknown IPC method. Discover, Profiles, and Settings were
visually inspected. The README screenshots were recaptured from the English
application using isolated data in `artifacts/smoke-english`.

The Windows portable `Petal 0.1.2.exe` was rebuilt successfully and passed the
same four UI checks with fresh isolated data in
`artifacts/smoke-english-portable`, including a real Sodium download. The
portable process exited with code 0.

## Moderated Petal API preview (0.2.0)

On October 5, 2026, the 17 preview regression tests passed. They exercise
account ownership/logout, private submissions, approval and withdrawal,
archive/upload rejection, dependency installation and exact configured download
origin restrictions. This is local preview evidence, not public hosting validation.

The Windows portable build completed successfully. Source, unpacked and portable
application smoke runs each passed four checks: IPC profile creation, an actual
Sodium installation, persistent settings with encryption, and unknown IPC rejection.
The capture environment required `--disable-gpu` after an offscreen rendering error;
this does not establish that every computer needs that flag. README screenshots
were captured from the actual English preview using isolated artifact data.

Public SMTP delivery, malware scanning and Docker/Bloom deployment
are not yet verified. The server is a single-process local preview with moderated
mod hosting; the full platform specification is a separate implementation effort.

## Official versions and loader adapters

The live Mojang manifest returned 917 validated version entries across release,
snapshot, old_beta and old_alpha categories. The catalog is dynamic; this count
is evidence from this check, not a fixed supported-version limit.

Real isolated installations and complete launch-argument generation passed for:
Vanilla 1.21.1, Vanilla 24w14a, Fabric 0.19.5, Forge 52.1.16,
NeoForge 21.1.255 and Quilt 0.30.1 (all modded cases on Minecraft 1.21.1).
These checks installed games, libraries and assets; they did not sign in or start
an owned Minecraft session. Historical versions are discoverable; their full
runtime behavior has not been exhaustively verified.

NeoForge selection verifies published neoform Minecraft dependencies and exposes
the latest 30 matching builds. Forge installers before Minecraft 1.6 are not
offered. Loader metadata failure is visible in the profile dialog.

The expanded 35-test suite passed. Source Electron smoke passed six checks,
including snapshot selection and invalid loader IPC rejection. Delayed obsolete
loader results are covered by race regression tests. The creator API accepts
official snapshot IDs and Quilt descriptors. CurseForge edge CDN requests attach
the key only to the exact HTTPS edge host, with redirects refused; an authorized
CurseForge end-to-end download still requires a real approved API key.

## Public web platform

The 39-test suite passed after adopting transactional migrations and public
discovery/project/author pages. Tests verify preview data preservation, migration
rollback, unpublished content privacy, escaped script payloads and static-file
allowlisting. The public website was inspected through the actual browser at
390px and 1440px widths, with no horizontal document overflow. Empty-result
search and separate creator dashboard entry points were verified. Screenshots
show the real empty local catalog, not seeded production records.

## Recoverable accounts checkpoint

The full suite passed 47 tests on the account checkpoint, including legacy scrypt login,
cookie/CSRF enforcement, reset and verification expiry/replay, session revocation,
current-role checks, public MFA, authenticator replay prevention and one-time bootstrap.
CUA verified synthetic-account login, email confirmation, logout and recovery request
on a separate loopback instance at port 4319. Password reset was exercised by HTTP
tests rather than changing a user credential through browser automation. Real SMTP
delivery remains unverified.

## Moderated publication checkpoint

52 full tests passed. Project revisions retain approved content through pending and
rejected changes; stale and repeated decisions are rejected. Tests cover accepted
teams, owner-only transfers, private notes/reports, image conversion/visibility and
withdrawn downloads with preserved bytes. CUA verified an isolated author submitting
a changed title, the old public title before approval and the new title after a
real local review request. Synthetic project captures remain in ignored artifacts.
