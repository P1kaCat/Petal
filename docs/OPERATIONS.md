# Operating Petal

Run one Petal API process per persistent data directory. Use Node.js 24 or newer.
The website and API share one HTTP service; the desktop launcher has its own data
and is not part of the server deployment.

## Health and protected configuration

`GET /health` reports process liveness. `GET /ready` checks SQLite and actual
writable storage. HTTPS public mode also requires mail configuration and a scanner
or explicitly configured manual review policy. A failed readiness check returns
503 with safe status labels, without paths, tokens or connection details.
Readiness checks configuration availability; test actual SMTP delivery and scanner
operation separately before opening registration.

Keep the backend private behind an HTTPS proxy, set `PETAL_PUBLIC_URL` to that
exact origin, and apply per-client proxy limits. The service does not trust
forwarded IP headers. Use [account setup](ACCOUNTS.md) and
[storage/scanning policy](STORAGE.md) before public operation. Protect the data
directory and runtime configuration with operating-system permissions.

Important persisted secrets are the generated `mfa-key.txt` and, for local preview,
`admin-token.txt`. If supplied through the environment, preserve `PETAL_MFA_KEY`
and other credentials separately in your secret manager. SMTP passwords and
external environment values are not copied into the backup manifest. Never place
data directories or backup bundles on a public web route or in GitHub.

## Create a consistent backup

Use a new destination outside the live data directory:

```text
node scripts/backup-api.cjs /srv/petal/data /srv/petal-backups/2026-10-06
```

On Windows, use your actual absolute data and backup paths. The parent backup
directory must already exist. Existing destinations are refused. The command uses
the [SQLite backup API](https://nodejs.org/docs/latest-v24.x/api/sqlite.html#sqlitebackupsourceDb-path-options)
to obtain a consistent live snapshot, then copies the immutable releases and
images referenced by that snapshot. Pending files are included in quarantine;
in-progress request bodies are not included. Generated secret files are included
with private permissions. The final `manifest.json` records schema version,
required external configuration and each file's SHA-512 and byte count.

A missing or changed referenced file causes backup failure. Only a bundle with
the final manifest and a successful command result is complete. Failed attempts
leave their separate incomplete directory for inspection; they do not alter the
running instance. Keep the bundle private because it contains account credentials,
session hashes and encrypted authenticator data with its key.

Configure a daily schedule in your operating system or hosting service. A reasonable
starting retention policy is seven daily and four weekly complete snapshots, with
one protected copy on another device. This is operator configuration: Petal does
not create scheduled jobs or delete backup directories automatically.

## Restore and verify

Restore into an absent or empty directory, never into the live instance:

```text
node scripts/restore-api.cjs /srv/petal-backups/2026-10-06 /srv/petal-restore-test
```

The restore command validates bounded manifest records, safe storage paths and
every checksum before copying. It refuses a populated target and never overwrites
existing files. It checks copied bytes again. Invalid bundles or interrupted
restores must not be started as a production instance. Re-create missing external
configuration and secret references before startup; losing the MFA encryption key
makes enrolled authenticators unusable.

Start the restored instance on a separate loopback port and data directory. Verify
readiness, normal and MFA sign-in, approved project visibility, private pending
submissions and byte-identical downloads. Keep real user traffic on the original
instance until the restored copy has been verified. Then stop the original before
switching the service's data path. Do not run two writers against the same directory.

Before an upgrade, record the image/code version and take a complete backup. Database
migrations can prevent an older image from reading updated data. An image rollback
alone is not a data rollback: restore the matching pre-upgrade snapshot into a
separate target and verify it before switching paths.

## Verification evidence

Automated operations tests back up a populated live instance and restore it into
a separate directory. Both normal password login and TOTP login succeed after
restore. Published download bytes and SHA-512 headers match, pending downloads
remain private, populated-target restore is refused and altered backup bytes fail
checksum validation. Separate tests force unwritable storage and database outage;
readiness returns 503 without private details while liveness stays available.

These are local Node/SQLite checks. Live SMTP, a real ClamAV daemon, Docker execution
and Bloom's intended Linux host require their own deployment acceptance evidence.
# Container deployment

The root Dockerfile packages only API dependencies, runs as UID 1000 (`node`), exposes port 4318 and stores all state in `/var/lib/petal`. The named Compose volume retains accounts, encryption keys and files across container recreation. Never remove it with `down --volumes` unless intentionally deleting that installation.

For local development, set `PETAL_PUBLIC_URL=http://127.0.0.1:4318` and `PETAL_REVIEW_POLICY=local-manual`, then run `docker compose up --build -d`. Published ports bind to loopback. For public use, supply the actual HTTPS origin and configure SMTP and a scanner (or explicitly select manual review) before routing traffic. `/ready` must return 200; configuration presence does not prove SMTP or scanner connectivity.

On Linux, run `node scripts/container-smoke.mjs` to verify image port declarations, non-root volume writes and persistence after recreation. Follow the backup/restore acceptance procedure below with an actual account and approved release. Docker is unavailable on the development PC: image build, Linux ownership, recreation and public deployment are pending host validation.

