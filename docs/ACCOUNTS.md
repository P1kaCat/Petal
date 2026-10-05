# Accounts and operator access

Petal serves the account page at `/account` and the creator dashboard at
`/dashboard`. Website sign-in uses a 24-hour HTTP-only, SameSite=Lax cookie,
with Secure enabled for an HTTPS public origin. Writes from cookie sessions
require the random `X-Petal-CSRF` value returned by `/v1/me`. Cross-origin
writes are rejected. Website code never stores session credentials in browser
storage; the previous preview portal credential is removed on load.

For API clients, register/login can still return a hashed-on-disk bearer session.
Pass `sessionType: "cookie"` for website sessions; these responses omit the bearer
token. Scoped API tokens arrive in the next API-contract task. Existing preview
bearer sessions retain their expiry and become individually revocable during
migration. Existing salted scrypt passwords retain their original parameters.

## Email and recovery

Registration supports email in local development and requires it in public HTTPS
mode. `/v1/me/email` allows a legacy account to add an address or resend verification
after confirming its password. Changing an existing address currently requires
operator support. Email verification is mandatory before public project creation
and release submission. Links use random tokens whose SHA-256 digests are stored
in the database: verification lasts 24 hours, password recovery 30 minutes.
Each link is single-use. A password reset revokes every session but preserves MFA.

Local development writes messages into `PETAL_API_DATA_DIR/mail-outbox`. This
directory is operator-only and has no HTTP route. Use it only on a private local
machine. Protect the entire data directory with the operating system's access
controls, especially on Windows where POSIX mode bits do not provide an ACL.
No external email is sent by this adapter.

For delivery, configure `PETAL_SMTP_HOST`, `PETAL_SMTP_PORT` (465 by default),
`PETAL_MAIL_FROM`, and, if required, `PETAL_SMTP_USER` and `PETAL_SMTP_PASSWORD`.
Port 465 uses TLS; other ports require STARTTLS. Certificate validation stays
enabled. Public mode disables the local outbox. Missing mail configuration gives
explicit service-unavailable feedback; recovery responses remain generic when
an individual delivery fails, so they do not disclose registered addresses.

The mail adapter uses [Nodemailer's SMTP transport](https://nodemailer.com/smtp).
Test delivery with the actual provider before opening public registration.

## MFA and bootstrap

The account page supports authenticator enrollment and ten single-use recovery
codes. Save those codes when shown; their hashes are stored and plaintext codes
cannot be retrieved later. TOTP codes use
[otplib](https://otplib.yeojz.dev/api/otplib/functional/functions/verify.html),
with a 30-second tolerance and replay prevention. Enrollment requires the current
password and a confirming code. After enabling MFA, sign in again with a fresh
code or an unused recovery code before using public moderation.

MFA secrets are encrypted using AES-256-GCM. Set `PETAL_MFA_KEY` to a persistent
32-byte hexadecimal key, or preserve the generated `mfa-key.txt` in the private
data directory. Losing this key makes enrolled authenticators unusable. Back it
up separately with protected configuration and never put it in GitHub.

Initialize the first administrator once, from the server's terminal:

```text
node scripts/bootstrap-api.cjs YOUR_USERNAME
```

The account must already have a verified email and enabled MFA. Bootstrap revokes
its existing sessions and permanently disables the preview operator token. Sign
in again using the account's authenticator. A second bootstrap fails. Public mode
rejects the preview administrator token even before bootstrap. Local preview can
still use it until bootstrap; it is never a launcher credential.

Roles are loaded from the database on every request. Removing a moderator role
immediately removes moderation access, without waiting for session expiry.
Public moderation additionally checks verified email, enrolled MFA and an
MFA-authenticated session. Audit rows record authentication/permission outcomes,
without passwords, mail-link tokens, authenticator codes or session credentials.

## Account endpoints

All paths below use `/v1`:

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/auth/register`, `/auth/login` | Sign up or sign in; optional cookie session |
| POST | `/auth/logout` | Revoke the current session |
| POST | `/auth/recovery` | Request a generic recovery response |
| POST | `/auth/reset` | Redeem a recovery token and change password |
| POST | `/auth/verify` | Redeem an email verification token |
| GET | `/me` | Account view and cookie session's CSRF value |
| GET | `/me/sessions` | Up to 100 active sessions without credential hashes |
| DELETE | `/me/sessions/{id}` | Revoke an owned session |
| POST | `/me/email` | Add an address or resend verification |
| POST | `/me/mfa/setup` | Begin authenticator setup after password confirmation |
| POST | `/me/mfa/confirm` | Confirm enrollment; return recovery codes once |
| GET | `/auth/capabilities` | Whether the local preview review desk is available |

Sensitive account operations are subject to the same authentication rate limit
as sign-in. These controls have local automated coverage; they are not a claim
of an independent security audit or a tested public SMTP deployment.
