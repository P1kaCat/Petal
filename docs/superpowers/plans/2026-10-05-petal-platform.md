# Petal Platform Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a coherent Minecraft launcher and moderated content platform, then verify persistent deployment with Bloom.

**Architecture:** Extend the current Electron launcher and Node.js server. Serve the site and API from one origin; keep metadata in SQLite and files on persistent disk behind explicit interfaces. Split execution into three independently verifiable plans rather than treating the entire platform as one change.

**Tech Stack:** Existing Electron, CommonJS JavaScript, Node.js 24+, node:sqlite, yauzl, @xmcl, HTML/CSS, Docker, and the existing Bloom Node/PostgreSQL deployment service.

**Spec:** [Approved platform specification](../specs/2026-10-05-petal-platform-design.md).

## Global Constraints

- English product UI, documentation, and GitHub presentation.
- Authors submit their own content; approval precedes publication.
- Local operation first, followed by deployment, preferably using Bloom.
- Preserve the violet flower branding and use actual Minecraft imagery or genuine application captures. Do not generate illustrations with AI.
- Preserve the existing restricted repository license and GitHub contribution workflow. Hosted projects retain their authors' licenses.
- One operator, one initial server process, a persistent disk; no invented production domain, credentials, capacity, or pricing.
- Preserve existing launcher profiles and existing API users/files through migrations.
- No claim of successful Minecraft launch, Docker execution, Bloom hosting, or Modrinth parity without corresponding evidence.

## Review Focus

1. Historical Minecraft IDs must not become paths or be rejected merely for failing a release-number regex: launcher plan task L2.
2. Delayed provider results must not replace the loader list for a newer user selection: launcher plan task L4.
3. Editing published content must not expose unapproved text/files: platform plan task P4.
4. Concurrent uploads and crashes must not bypass quotas or strand untracked storage: platform plan task P5.
5. Replacing a container must retain data without exposing host files or secrets: Bloom plan tasks B2–B4.

## Execution order

| Checkpoint | Plan | Result that can be reviewed |
| --- | --- | --- |
| 1 | [Launcher and Minecraft](2026-10-05-petal-launcher.md), L1 | Existing API preview safely committed with genuine verification |
| 2 | Launcher, L2–L5 | Full official version catalog, compatible loader selection and installations |
| 3 | [Web platform](2026-10-05-petal-web-api.md), P1–P3 | Modular service, public site, accounts and recovery |
| 4 | Web platform, P4–P7 | Moderated revisions, author teams, storage safeguards, documented API |
| 5 | [Bloom deployment](2026-10-05-petal-bloom.md), B1–B4 | Standalone container, durable Bloom configuration/storage, real Linux checks |
| 6 | Web platform, P8–P9 | Additional content types and initial community features |

Each task uses focused regression checks and an explicit commit. Publish validated checkpoints to the existing Petal repository. Changes to Bloom belong in its own working checkout and commits, not in the ignored reference clone inside Petal. Public production deployment requires a configured target and separate rollout review.

## Handoff and review

- [x] Specification approved in conversation.
- [x] Plans written and self-reviewed for specification coverage, interfaces, and failure cases.
- [x] User reviews the implementation plans and selects execution method.
- [ ] Execute the selected method, update checkboxes only after checks pass, and report actual results at each checkpoint. **Status: code/unit evidence complete where applicable; external acceptance pending. See VERIFICATION.md and docs/DELIVERY.md.**

Selected method: **Native**, with implementation in the current session and an independent final review, because the launcher/API interfaces need coordinated edits and the user prioritizes rapid progress. **Subagent-driven** remains an alternative with per-task independent implementation/review. The user approved direct execution in conversation. Implementation and the independent final review are complete; Linux deployment acceptance remains pending.
