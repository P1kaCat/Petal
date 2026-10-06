# Petal Bloom Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Verify durable Petal hosting with Bloom, including configuration, persistent storage, replacement and recovery.

**Architecture:** Package Petal's site/API in one non-root container with one port and health check. Extend Bloom's existing deployment lifecycle with generated, project-owned storage and protected runtime configuration. Keep Bloom's Docker control interface on a trusted operator network; public Petal HTTPS routing is a separate infrastructure requirement.

**Tech Stack:** Docker/Compose on Linux, Node.js 24, Bloom's existing PostgreSQL metadata, DockerRuntime argument-array commands, Petal SQLite and filesystem storage.

**Spec:** [Approved platform specification](../specs/2026-10-05-petal-platform-design.md), sections 9–10. Bloom reference commit: `7bbd35c2f34794d16e60bee6735c647dd203e38f`.

## Global Constraints

- Inherit every constraint from [the parent plan](2026-10-05-petal-platform.md).
- Root `Dockerfile`; exactly one TCP port `4318`; bind `0.0.0.0`; persist data at `/var/lib/petal`.
- No arbitrary host mounts, Docker socket in Petal, committed runtime secrets, or synthetic claims of deployment success.
- Bloom changes belong in its own checkout. Docker is absent in the current Windows workspace; Linux runtime checks require an available Docker host.
- Local/LAN persistence support and public hosting readiness are separate gates.

## Review Focus

- Docker runtime UID cannot write the mounted data volume: B1/B2 tests.
- Host-path/secret injection from project settings: B2/B3 tests.
- Retry/replacement after an interrupted deployment: B4 restart tests.
- Migration failure followed by image rollback: B4 recovery check.
- HTTPS/proxy origin and cookie behavior: B4 public-readiness review.

## File map and interfaces

- Petal: create root `Dockerfile`; update `compose.yaml`, `.dockerignore`, `docs/OPERATIONS.md`, `deploy/Caddyfile.example`; add `test/deployment.test.cjs` and a Linux container smoke script.
- Bloom: modify `apps/api/src/{schema.sql,database.mjs,store.mjs,settings.mjs,validation.mjs,docker.mjs,deployments.mjs}` and dashboard settings in `apps/web/public/{dashboard.js,index.html}`.
- Bloom: create `apps/api/src/app-storage.mjs` exposing `provision(projectId, containerUid) -> Promise<{ volumeName, containerPath }>` with `containerPath='/var/lib/petal'`; use Docker-managed volumes labeled by project ID.
- Bloom: create `apps/api/src/runtime-config.mjs` exposing `resolve(projectId) -> Promise<{ env: string[], secrets: SecretMount[] }>`; `SecretMount = { protectedHostPath, containerPath }`, derived exclusively from operator-owned secret references.
- Bloom tests: add `tests/{app-storage,runtime-config}.test.mjs`, extend `tests/{deployments.test.mjs,docker.integration.mjs}`.

### B1. Verify Petal as a standalone container

**Consumes:** P7 health/readiness and backup scripts. **Produces:** independently working image and Compose deployment.

- [ ] Add `test/deployment.test.cjs` configuration checks for one port, non-root user, no data/credentials in build context, explicit persistent path and health endpoint. Assert `assert.equal(exposedPorts.length, 1)` in image inspection on Linux. **Status: code/unit evidence complete where applicable; external acceptance pending. See VERIFICATION.md and docs/DELIVERY.md.**
- [x] Run static checks before moving the existing `deploy/Dockerfile`; record expected missing root image contract.
- [x] Create a root image build that includes only API runtime requirements, listens on `0.0.0.0:4318`, sets `/var/lib/petal`, and checks `/ready`. Update Compose to mount a named volume and require explicit external origin for non-loopback operation. Retain an explicit loopback local development path.
- [ ] On a Docker-capable Linux host, build and start; create a test author/project, recreate the container, verify hashes/accounts persist and run a backup restore. If no host exists, record this as pending rather than installing or deploying to an invented target. **Status: code/unit evidence complete where applicable; external acceptance pending. See VERIFICATION.md and docs/DELIVERY.md.**
- [x] Commit `build: package persistent Petal web and API container` in Petal.

### B2. Add safe per-project persistence to Bloom

**Consumes:** Existing Bloom DockerRuntime/store and B1 volume target. **Produces:** `app-storage.provision` and persisted storage attachment metadata.

- [x] In a proper Bloom checkout, write tests rejecting `../../`, arbitrary host paths and cross-project volume reuse; assert a generated labeled volume survives container deletion. Test mounted-directory ownership for the image's declared non-root UID.
- [x] Run `node --test tests/app-storage.test.mjs`; require missing storage support to fail.
- [x] Add transactional storage metadata migration and a fixed declared mount policy; create labeled Docker-managed volumes, initialize ownership through a controlled helper, and attach only the matching project's volume. Never use global chmod or broad Docker pruning.
- [ ] Run Bloom unit and Docker integration checks; recreate a fixture container and assert its counter/file survives. Confirm unrelated projects cannot mount that volume and project deletion does not silently delete data. **Status: code/unit evidence complete where applicable; external acceptance pending. See VERIFICATION.md and docs/DELIVERY.md.**
- [x] Commit `feat: persist Bloom application data across replacement` in Bloom.

### B3. Add validated configuration and protected secret references

**Consumes:** B2 project storage metadata and existing Bloom settings. **Produces:** `runtime-config.resolve` and operator project configuration UI/API.

- [x] Write tests for unsafe env names, duplicate entries, secret redaction, path traversal in secret IDs, cross-project access and restart persistence. Assert serialized logs/project responses do not contain the fixture secret.
- [x] Run `node --test tests/runtime-config.test.mjs`; require absent config support to fail.
- [x] Add nonsecret configuration persistence and operator-managed secret references. Permit explicit Petal origin/path/limit/mail configuration, deny Docker/host control settings, mount secrets read-only at generated paths and support Petal `_FILE` configuration where needed. Keep secret values out of DB public views, command logs and UI responses.
- [ ] Verify test configuration survives Bloom restart and reaches only the intended container. Keep operator UI on the trusted LAN; configure protected filesystem secret ownership and rotation in operations docs. **Status: code/unit evidence complete where applicable; external acceptance pending. See VERIFICATION.md and docs/DELIVERY.md.**
- [x] Commit `feat: configure Bloom apps with protected runtime secrets` in Bloom.

### B4. Verify replacement, recovery and public readiness

**Consumes:** B1–B3 and P7 restore support. **Produces:** evidenced durable Petal deployment and explicit public-hosting checklist.

- [ ] Extend deployment tests for failed/stopped retry preserving configuration/volume, image health failure, port collision, crash reconciliation and migration failure. Assert `assert.equal(after.volumeName, before.volumeName)` and data hashes remain unchanged. **Status: unit lifecycle checks pass; real container data-hash and PostgreSQL migration acceptance remain pending on Linux.**
- [x] Run Bloom unit tests and confirm missing replacement safeguards fail before changes.
- [x] Implement stopped-container replacement with labeled resource checks and retained data/configuration. Preserve the existing no-live-redeploy behavior unless a replacement strategy is separately reviewed; record current/new image IDs and schema migration implications. Add operator backup/restore and rollback commands.
- [ ] On the intended Linux server, deploy the actual Petal image, publish an approved fixture, restart Bloom, stop/retry Petal and restore into an isolated instance. Verify health, sessions, downloads and quotas. For public use, separately verify HTTPS routing, trusted proxy rules, secure cookies, actual mail delivery, privileged MFA, scanner/manual review policy and protected Bloom operator access. **Status: code/unit evidence complete where applicable; external acceptance pending. See VERIFICATION.md and docs/DELIVERY.md.**
- [ ] Record exact host/image/check evidence in both repositories, commit verified integration docs, and present the rollout/rollback result before any public production deployment. **Status: code/unit evidence complete where applicable; external acceptance pending. See VERIFICATION.md and docs/DELIVERY.md.**
