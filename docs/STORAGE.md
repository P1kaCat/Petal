# Storage, quarantine and retention

Uploads reserve capacity in SQLite before accepting bytes. Reservations count
against global and per-author usage alongside stored releases and images, and
limit the service to four uploads at once. Defaults are 64 MB per release,
256 MB per uploading author, 2 GB globally. Override them with
`PETAL_API_UPLOAD_MB`, `PETAL_API_AUTHOR_MB` and `PETAL_API_STORAGE_MB`.
An image reserves its 5 MB maximum during decoding; unused capacity is released
when its re-encoded bytes are committed. Maintainers' uploads count against
their own author quota, which remains attributed to them after an ownership
transfer.

Raw uploads stream into private `incoming` files, with bounded byte measurement
and a SHA-512 digest. Validated releases move into `quarantine` and remain private
while pending. Approval moves the immutable file into `files`; downloads still
check database visibility, so knowing a storage key is not authorization.
The server can also read pre-migration files that already reside in `files`.

Startup reconciles abandoned reservations and generated orphan files. Hourly
cleanup removes expired reservations and drafts older than 24 hours. Withdrawn
or rejected files are retained for seven days, with published pinned dependency
references preventing collection. Current and retained approved/pending revision
images are kept. Cleanup only visits validated generated keys in declared storage
directories; it never recursively deletes arbitrary paths. Operate one server
process per data directory.

## Scanning policy

Local development defaults to manual operator review. HTTPS public mode defaults
to requiring a scanner. Configure `PETAL_CLAMAV_HOST` and optionally
`PETAL_CLAMAV_PORT` (3310) for a private ClamAV daemon. The adapter sends bytes
using [ClamAV INSTREAM](https://docs.clamav.net/manual/Usage/ClamdProtocol.html),
without executing uploaded code. Keep ClamAV's socket private and signatures
updated. Set its `StreamMaxLength` at least as high as Petal's upload limit.

Scanner outages, invalid responses and detected files stay private and cannot be
approved. Moderators can retry `POST /v1/admin/versions/{id}/scan` after a scanner
outage; it does not publish the file. Review is still required after a clean scan.

If the operator deliberately uses human review for a public instance, explicitly
set `PETAL_REVIEW_POLICY=manual` and document how the review team inspects files.
This is an operator policy, not an assurance that files are safe. A recorded
scanner failure or detection still blocks publication, even in manual mode.
`local-manual` is restricted to development. No scanner daemon is installed or
configured automatically.

Synthetic socket tests verify protocol framing and detection handling, and HTTP
tests verify failure remains pending, retry succeeds and only then approval works.
A real ClamAV daemon and public deployment have not been exercised on this PC.
