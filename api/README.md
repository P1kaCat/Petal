# Petal API & creator portal

Petal can host its own Minecraft mods alongside its Modrinth and CurseForge
integrations. This is a separate HTTP service with an English author portal,
a moderated release workflow, SQLite metadata, and private disk storage.

## Run locally

The server requires **Node.js 24 or later**. From the repository root:

```powershell
pnpm install --frozen-lockfile
pnpm api
```

Open **http://127.0.0.1:4318/** for the public website and **/dashboard** for the creator portal. The API listens only on
loopback by default. No hosting subscription is needed for local development.

On first startup, the server generates a random administrator token in
`api/data/admin-token.txt`. Open that local file and paste its contents into
the portal's **Review desk** form. Never share or commit it. You can instead
supply a token of at least 32 characters through `PETAL_ADMIN_TOKEN`.

In the launcher, enter `http://127.0.0.1:4318` under **Settings → Petal API**
and save. The **Petal** catalog and **All mods** then include approved releases.
The launcher needs no administrator or author token to download published mods.

## Author workflow

1. Create an author account in the portal. Usernames contain 3–40 letters,
   numbers, underscores, or hyphens; passwords contain 12–256 characters.
2. Create a project with a title, description, unique slug, and the mod's license.
   An HTTPS source or author website is optional.
3. Submit a version, supported Minecraft releases, mod loader, and a `.jar` file.
   Optional dependencies reference other Petal project IDs.
4. Confirm that you own the mod or have permission to host and distribute it.
5. The release becomes **pending**, visible only to its author and administrators.
6. An administrator inspects the project, rights, license, metadata, and file,
   then approves or rejects the release with a note.
7. Approved releases appear in search and can be installed through Petal,
   including required Petal dependencies and SHA-512 verification.

Submission grants permission to store and distribute the submitted files under
the mod's declared license. Petal's repository license does not replace the
author's mod license. Do not copy another platform's mods into this service
without the necessary permission. The server does not mirror external catalogs.

## Moderation

The review desk has **Pending**, **Published**, and **Rejected** queues.
Pending files can be downloaded for inspection with administrator authorization.
Approving publishes a release. Rejecting a published release removes it from
public search and downloads; copies already downloaded by users are unaffected.

Uploads are immutable once submitted. To replace a file, submit a new version.
Project metadata cannot currently be edited after creation, which prevents
unreviewed metadata changes to published projects.

## HTTP API

All endpoints below are under `/v1`. Write bodies use JSON except file uploads,
which use a raw JAR body with `Content-Type: application/java-archive` and a
positive `Content-Length`. Authentication uses `Authorization: Bearer <token>`.
Tokens belong in request headers, never URL parameters.

| Method | Endpoint | Access / purpose |
| :--- | :--- | :--- |
| GET | `/health` (outside `/v1`) | Service health |
| POST | `/auth/register` | Create author account; returns a 24-hour session |
| POST | `/auth/login` | Sign in; returns a 24-hour session |
| POST | `/auth/logout` | Revoke the current author session |
| GET | `/search?q=&version=&loader=&offset=0&limit=20` | Published compatible projects |
| GET | `/projects/:id` | Public project, or owner-only unpublished project |
| GET | `/projects/:id/versions` | Published versions; owners can see their submissions |
| GET | `/versions/:id` | Version metadata, subject to publication / ownership |
| GET | `/versions/:id/download` | Public approved file; owner/admin-only review file |
| GET | `/me/projects` | Current author's projects |
| POST | `/projects` | Create own project |
| POST | `/projects/:id/versions` | Create version draft and confirm distribution rights |
| PUT | `/versions/:id/file` | Upload the draft's file; moves it to pending |
| GET | `/admin/reviews?status=pending` | Administrator review queue (first 100) |
| POST | `/admin/versions/:id/review` | Administrator action: `approve` or `reject` |

Project JSON example:

```json
{
  "slug": "my-mod",
  "title": "My Mod",
  "description": "What the mod does.",
  "license": "MIT",
  "sourceUrl": "https://github.com/your-account/your-mod"
}
```

Version JSON example:

```json
{
  "name": "1.0.0",
  "filename": "my-mod-1.0.0.jar",
  "gameVersions": ["1.21.1"],
  "loaders": ["fabric"],
  "rightsConfirmed": true,
  "dependencies": []
}
```

Dependencies use `{ "id": "<Petal project UUID>" }` and optionally
`"versionId": "<version UUID>"`. Cross-platform dependencies are not yet supported.

## Storage & limits

Metadata, password hashes, and hashed session tokens are stored in
`api/data/catalog.sqlite`. Files use server-generated UUID filenames under
`api/data/files`; unvalidated uploads go to `api/data/incoming`. This entire
directory is excluded from Git and Docker build context.

- Uploads: 64 MB per file, at most four concurrent uploads.
- Storage: 2 GB total recorded files by default. Set `PETAL_API_STORAGE_MB`
  and `PETAL_API_UPLOAD_MB` only after planning disk space and proxy limits.
- Archives: at most 30,000 entries and 1 GB declared expanded size; encrypted
  archives, unsafe archive paths, damaged archives, and missing mod descriptors
  are rejected. Entries are read without extracting or executing them.
- Requests: 300 per minute per direct peer IP; account endpoints: 20 per
  15 minutes per direct peer IP. Limits are process-local. A reverse proxy must
  implement appropriate client-level limits because the service does not trust
  forwarded IP headers.
- Author accounts: at most 100 projects; 500 versions per project.
- JSON request bodies: 64 KB. Sessions expire after 24 hours.

Passwords are derived with salted scrypt. Session tokens are hashed on disk.
The admin token remains a server secret. No cross-origin write requests are
accepted. The portal uses same-origin scripts and bearer sessions, not cookies.

## Prepare deployment

This preview is designed for **one server process and a persistent disk**.
Use HTTPS through a reverse proxy and set the public origin explicitly:

```powershell
$env:PETAL_PUBLIC_URL = 'https://mods.your-domain.example'
$env:PETAL_API_HOST = '0.0.0.0'
pnpm api
```

The domain above is a placeholder; replace it with your actual domain. Keep
the backend port private behind the proxy. `PETAL_API_PORT` defaults to `4318`;
`PETAL_API_DATA_DIR` overrides the data directory. Configure your process manager
and backups before operating a public service.

A [Dockerfile](../deploy/Dockerfile) and [Compose file](../compose.yaml) are
provided. For a local container:

```sh
docker compose up --build -d
```

Compose publishes the backend port on loopback only and persists `api/data`.
Set `PETAL_PUBLIC_URL` in your deployment environment for public HTTPS links.
An [example Caddy configuration](../deploy/Caddyfile.example) shows the reverse
proxy arrangement. Replace its domain and review it before use. These deployment
files have not been executed against a live hosting provider.

Back up SQLite and stored files together while the process is stopped, or use
a consistent SQLite backup mechanism. Include WAL files in a live-file backup;
copying the database file alone while running is not a reliable backup.

## Preview limits

This is a working moderated hosting preview, not a high-traffic platform.
It has no email verification, password reset, account recovery, malware scanner,
S3/CDN storage, resumable uploads, or distributed rate limiting. Archive
validation does not establish that a mod is safe or that its author has rights.
Administrators must review submissions; declared compatibility is not
automatically proven. Interrupted uploads can leave an orphan file after a
process crash, and storage cleanup / retention tools are not implemented yet.

The admin token grants full moderation access. Public operations need no token;
author registration does not confer moderation rights. Keep all API data and
secrets out of public repositories and screenshots.

## Validation

```powershell
pnpm test
```

API tests use real local HTTP requests and a synthetic mod fixture. They cover
accounts, ownership, private submissions, approval, search filtering, actual
launcher installation and checksum verification, dependencies, unpublishing,
invalid uploads, size limits, origin restrictions, and blocked download origins.
