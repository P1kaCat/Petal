# Petal Launcher and Minecraft Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve the moderated API preview and support official Minecraft version categories with explicit, compatible loader selection.

**Architecture:** Add a shared metadata service and loader adapters without replacing the existing Electron IPC, profile store, or staged mod installer. Profile paths remain UUID-based. Integrate loaders through @xmcl where supported and verified official launch metadata otherwise.

**Tech Stack:** Electron, Node.js 24+, CommonJS, @xmcl/core and installer, built-in fetch/node:test, existing HTML/CSS.

**Spec:** [Approved platform specification](../specs/2026-10-05-petal-platform-design.md), sections 2, 4, 8, 10.

## Global Constraints

- Inherit every constraint from [the parent plan](2026-10-05-petal-platform.md).
- Supported first adapters: `vanilla`, `fabric`, `forge`, `neoforge`, `quilt`.
- Official Minecraft categories: `release`, `snapshot`, `old_beta`, `old_alpha`.
- Version IDs are opaque values validated against trusted metadata; directories use profile UUIDs.
- Discovery, installation, and successful launch are distinct verification claims.

## Review Focus

- Snapshot/alpha IDs and hostile path characters: L2 fixture tests.
- Provider timeout with a previously cached catalog: L2 clock-injected tests.
- Loader compatibility and missing releases: L3 adapter fixtures.
- Fast selection changes: L4 browser interaction check.
- Existing profiles with a stored runtimeVersion: L5 migration/regression tests.

## File map and interfaces

- Create `src/minecraft-metadata.cjs`: `MinecraftMetadata({ fetcher, cacheFile, now })`, `versions({ refresh=false }={}) -> Promise<{ versions: GameVersion[], stale: boolean }>`, `loaders(gameVersion, { includePrerelease=false }={}) -> Promise<LoaderChoice[]>`, `assertSelection({ version, loader, loaderVersion }) -> Promise<void>`.
- `GameVersion = { id, type, releaseTime, url }`; `LoaderChoice = { id, version, stable, gameVersion }`.
- Create `src/loaders/{index,vanilla,fabric,forge,neoforge,quilt}.cjs`: adapters expose `list(gameVersion, options) -> Promise<LoaderChoice[]>` and `install({ profile, resources, javaPath, notify }) -> Promise<{ runtimeVersion, loaderVersion }>`; `getLoader(id)` rejects unimplemented adapters.
- Modify `src/store.cjs`, `src/game.cjs`, `src/main.cjs`, `src/renderer.js`, `src/index.html`, `src/catalog.cjs`, `src/mods.cjs`, `api/server.cjs`, `api/public/portal.js` for selection and validation.
- Tests: `test/minecraft.test.cjs`, `test/loaders.test.cjs`, existing launcher/API tests; metadata fixtures in `test/fixtures/minecraft/`.

### L1. Preserve and ship the existing API preview baseline

- [x] Read `api/server.cjs`, `src/petal-url.cjs`, existing tests and uncommitted changes; verify `api/data`, credentials, artifacts and SQLite files are ignored before staging.
- [x] Run `node --test test/*.test.cjs`; require the current 17 tests to pass. Review permission checks, archive claims, and exact configured download-origin restrictions.
- [x] Run source Electron smoke with the existing `PETAL_SMOKE_TEST` flow in an isolated artifact data directory; capture real English Discover/Profiles/Settings screens. Build using `pnpm dist` and inspect the packaged app before claiming a new portable executable works.
- [x] Update `README.md`, `docs/SETUP.md`, `VERIFICATION.md`, and `docs/media/` to match actual preview behavior; document email/recovery/public-hosting limitations. Do not describe archive parsing as malware scanning.
- [x] Stage only intended source, docs, lockfile and tests; commit `feat: add moderated Petal API preview` and push the verified checkpoint. Do not stage server data or test accounts.

### L2. Discover all official Minecraft versions safely

**Consumes:** Official Mojang manifest and existing Store UUID paths. **Produces:** `MinecraftMetadata.versions()` and `assertSelection()`.

- [x] Write `test/minecraft.test.cjs` cases for release `1.21.1`, snapshot `24w14a`, prerelease `1.21-pre1`, beta `b1.7.3`, alpha `a1.2.6`, duplicate/unknown IDs, path payloads, and malformed manifest entries. Assert four distinct category types, rejection of `../outside`, and UUID-contained instance paths.
- [x] Run `node --test test/minecraft.test.cjs`; confirm missing metadata implementation fails these tests.
- [x] Implement the metadata module with a 1-hour cache, 15-second request timeout, atomic cache writes, injected clock/fetcher, and stale fallback. Make create/prepare paths call authoritative selection validation; Store retains length/path-safe syntax checks without imposing release-number grammar. Only refresh failures may use a previously validated cache.
- [x] Add tests proving cache expiry, corrupt cache rejection, offline stale fallback, unknown-version failure and no writes outside the profile directory; run metadata and existing launcher tests.
- [x] Commit `feat: discover official Minecraft version categories` with the module, fixtures and integration changes.

### L3. Add compatible loader adapters and explicit versions

**Consumes:** L2 `GameVersion`. **Produces:** `LoaderChoice`, `getLoader()`, per-adapter `list()` and `install()` contracts.

- [x] Write `test/loaders.test.cjs` provider fixtures: Vanilla returns its game ID; Fabric and Quilt return compatible stable/prerelease choices; Forge honors legacy/current metadata; NeoForge distinguishes `1.20.1`, `1.20.2` and `1.21.1`. Assert unsupported combinations return no choices and unknown adapter IDs fail.
- [x] Run `node --test test/loaders.test.cjs`; require failure before adapters exist.
- [x] Extract existing installation branches into adapters, preserving bounded downloads and Java selection. Add Vanilla and Quilt using authoritative metadata; resolve provider version IDs instead of guessing NeoForge prefixes. Persist the explicitly selected loaderVersion and runtimeVersion. Do not expose LiteLoader/Rift until their adapters work.
- [x] Test installer calls with injected provider/install functions and missing/corrupt metadata. Perform real installations in isolated directories for Vanilla release, Vanilla snapshot, Fabric, Forge, NeoForge and Quilt, recording selected exact versions and failures separately; account-owned launch verification remains a separate check.
- [x] Run `node --test test/*.test.cjs`; commit `feat: install compatible Vanilla and mod loader versions`.

### L4. Expose version categories and loader selection in the launcher

**Consumes:** L2/L3 metadata APIs. **Produces:** IPC `versions({ refresh })` and `loaders({ version, includePrerelease })`; profile creation accepts optional `loaderVersion`.

- [x] Add IPC validation tests for invalid category/version/loader arguments and incompatible loaderVersion. Add a reproducible UI check selecting a snapshot and then a release before the first request completes; assert only the newest selection's loaders remain visible.
- [x] Run the focused tests and verify the old selector cannot satisfy category/prerelease controls.
- [x] Update `src/main.cjs` handlers and renderer profile dialog with category filters, search, loader version, prerelease opt-in, loading/error/stale states and a selection generation counter. Remove the release-only input pattern in `src/index.html`.
- [x] Verify keyboard creation, empty compatibility results, failed metadata refresh and existing-profile display in real Electron UI; run source smoke and the full tests. Retain branded English UI.
- [x] Commit `feat: select Minecraft categories and compatible loaders`.

### L5. Keep installation and hosted compatibility consistent

**Consumes:** L2 `assertSelection`, L3 adapters, existing Catalog and installMods. **Produces:** profile-safe installations and shared hosted metadata validation.

- [x] Add API/launcher regressions for Quilt descriptors and snapshot IDs, reject a fake unknown version, reject mod installation into Vanilla, and preserve existing runtimeVersion profiles after restart. Assert loader changes cannot reuse an incompatible runtime.
- [x] Run these tests and confirm the old release-only API/loader list fails.
- [x] Use the shared metadata selection service in hosted release validation and creator controls; allow `quilt.mod.json` descriptors. Ensure vanilla bypasses loader installation and mod actions. Update authenticated CurseForge downloads according to its current official API contract without exposing the key to arbitrary URLs or redirects.
- [x] Run full tests, verify unavailable CurseForge preserves other sources, and update genuine README screenshots and `VERIFICATION.md`. Publish supported-installation evidence and remaining launch/legacy gaps.
- [x] Commit and push `feat: align launcher and hosted Minecraft compatibility`.
