# Your Petal library

Signed-in accounts can follow approved projects, create private collections and receive in-app notifications when a followed release or project revision is approved. Pending, rejected and withdrawn files never become downloadable through these features. Project pages provide follow and save buttons; `/library` contains the account-owned lists and notification preference.

Follows and collection membership are idempotent. Collections are visible only to their owning account: unrelated accounts receive 404. All lists accept a stable cursor and a limit of 1–100 (default 20). Each account can keep 1,000 follows, 100 collections and 1,000 items per collection. At most 500 notifications are retained per account. Preferences disable future approval notifications; read state belongs to the recipient.

Notifications are created in the approval transaction, once per recipient and approved event. Following requires an already published project, so the first approval is not broadcast to strangers. Rejection, pending upload and repeated approval of the same release do not generate new notices. No email broadcasts or external messages are sent.

API tokens require `community:read` or `community:write` as appropriate. Tokens with only project permissions cannot change follows; account sessions remain required for security settings. Cookie mutations require CSRF protection.
