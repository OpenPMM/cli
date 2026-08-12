# CLI staging acceptance

Use the `Smoke OpenPMM CLI` workflow after you publish a release candidate. It
runs the installed npm package outside the application process. It uses only
the public `/v1` origin, covers every read family, and creates and removes one
reversible draft.

The `staging-cli-smoke` GitHub Environment contains a restricted staging API
key and the public staging API origin. Give the key only the scopes that the
workflow needs. Rotate it in the product portal if workflow access may be
exposed.

## Operator-gated acceptance

The following checks can create external provider side effects. Run them only
in the designated staging Workspace and destinations after you review the
exact command and grant the GitHub Environment approval:

- Upload an approved fixture. Attach it to one channel draft. Download and
  remove it.
- Create a draft Post, publish the same Post ID, schedule it, observe it,
  reschedule it, cancel it, and inspect its embedded delivery status.
- Publish an approved immediate fixture and inspect its receipts.
- Initiate each configured provider connection and observe its session.
- Refresh destinations. Disconnect only the designated disposable destination.
- Select the staging Slack channel. Send the confirmed test. Confirm the CLI
  returns the Slack message timestamp. Disconnect the disposable installation.
- Validate YouTube readiness. Publish the approved private test video.
- Create, update, and delete a disposable Workspace with the exact deletion
  confirmation.
- Create, resend, and revoke an invitation to the designated test mailbox.

Provider consent and invitation acceptance complete in a browser. Never put
API keys, provider tokens, signed media URLs, post copy, or user email
addresses in workflow logs or acceptance evidence. Record only the CLI
version, request IDs, exit codes, and public resource IDs.
