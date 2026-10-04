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
