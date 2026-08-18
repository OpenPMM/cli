<div align="center">
  <img src="assets/openpmm-logo.png" alt="OpenPMM" width="160" />
  <h1>OpenPMM CLI</h1>
  <p>The first-party, API-only command line client for OpenPMM.</p>
  <p>
    <a href="https://docs.openpmm.com/cli/overview">Documentation</a>
    ·
    <a href="https://github.com/OpenPMM/cli/issues">Issues</a>
  </p>
</div>

OpenPMM CLI gives your terminal and CI workflows one command line interface
for the OpenPMM public API. Manage workspaces, posts, assets, destinations,
notifications, and webhooks without a browser session or a private server
module.

The CLI has no runtime dependencies. Its source is public, and it calls only
the public `/v1` API.

## Install

Use `npx` for a one-off command:

```bash
npx -y @openpmm/cli --help
```

Or install it globally:

```bash
npm install --global @openpmm/cli
openpmm --version
```

Node.js 22 or newer is required.

## Authenticate

Set `OPENPMM_API_KEY` in your shell or CI environment:

```bash
export OPENPMM_API_KEY=opm_live_...
```

For local development, save a key for the default API URL. Pipe the key so it
does not appear in shell history:

```bash
printf '%s' "$OPENPMM_API_KEY" | openpmm auth login --with-token
openpmm auth logout
```

Saved credentials live in
`~/.config/openpmm/credentials.json`. The CLI creates the directory with mode
`0700`, writes the file with mode `0600`, and refuses to read a file that is
accessible by other users. Environment variables are useful for CI and always
take precedence over saved credentials.

## Quick start

```bash
export OPENPMM_API_KEY=opm_live_...
export OPENPMM_WORKSPACE=ws_...

# Inspect the workspace as machine-readable JSON.
npx -y @openpmm/cli workspaces list --json

# Create a draft post.
npx -y @openpmm/cli posts create \
  --workspace "$OPENPMM_WORKSPACE" \
  --when draft \
  --group launch \
  --channel x \
  --body 'Draft copy' \
  --json

# List drafts.
npx -y @openpmm/cli posts list \
  --workspace "$OPENPMM_WORKSPACE" \
  --view drafts \
  --json
```

Every workspace-scoped command accepts `--workspace <id>` or
`OPENPMM_WORKSPACE`. Use the explicit flag when a script works with more than
one workspace.

Repeat `--body` to publish an ordered self-reply chain on X, Bluesky, Mastodon,
or Threads. Media attaches to the opening post:

```bash
openpmm posts create \
  --workspace "$OPENPMM_WORKSPACE" \
  --destination dst_... \
  --body 'Opening post' \
  --body 'First reply' \
  --body 'Second reply' \
  --yes
```

## Common workflows

### Publish a post

Publishing is explicit and irreversible. Review the request, then add `--yes`:

```bash
openpmm posts publish \
  --workspace "$OPENPMM_WORKSPACE" \
  --post post_... \
  --post-version 1 \
  --destination dst_... \
  --yes \
  --json
```

For a complete request body, use a JSON file or stdin:

```bash
openpmm posts publish \
  --workspace "$OPENPMM_WORKSPACE" \
  --file publish.json \
  --yes \
  --json

cat publish.json | openpmm posts publish \
  --workspace "$OPENPMM_WORKSPACE" \
  --file - \
  --yes \
  --json
```

Create-post requests also require `--yes` unless they create a draft. Other
publishing, disconnect, delete, cancel, reschedule, and retry operations require
`--yes`.

### Upload and download an asset

```bash
openpmm assets upload video.mp4 \
  --workspace "$OPENPMM_WORKSPACE" \
  --kind reel \
  --json

openpmm assets download asset_... \
  --workspace "$OPENPMM_WORKSPACE" \
  --output video.mp4
```

Uploads stream through public API operations. Downloads never overwrite an
existing file.

### Send feedback

Send product feedback for the active workspace:

```bash
openpmm feedback submit \
  --workspace "$OPENPMM_WORKSPACE" \
  --message 'The scheduled Posts view did not refresh.' \
  --json
```

OpenPMM includes the workspace and CLI environment in the feedback email. The
account email for the API credential creator is the reply-to address.

### Manage webhooks

List and manage workspace webhook endpoints through the API:

```bash
openpmm webhooks list --workspace "$OPENPMM_WORKSPACE" --json
openpmm webhooks test webhook_... --workspace "$OPENPMM_WORKSPACE" --json
```

Verify a received webhook locally against its exact body bytes. This command
does not call the API:

```bash
OPENPMM_WEBHOOK_SECRET=whsec_... openpmm webhooks verify \
  --signature 't=...,v1=...' \
  --file payload.json
```

Use `--file -` for a payload from stdin or `--secret-file <path>` when the
signing secret is stored outside the environment.

Connect Slack once for the Account. `slack connect`, `slack sessions show`,
and `slack disconnect` do not use `--workspace`. Channel selection, channel
listing, status, and tests remain Workspace-scoped.

## Command groups

| Group | Examples |
| --- | --- |
| Account and workspaces | `accounts show`, `workspaces list`, `workspaces create` |
| Team | `team members list`, `team invitations create` |
| Posts | `posts create`, `posts list`, `posts update`, `posts publish` |
| Assets | `assets list`, `assets upload`, `assets validate`, `assets download` |
| Destinations | `destinations list`, `destinations connect`, `destinations refresh`, `destinations disconnect` |
| Notifications | `slack connect`, `slack disconnect`, `slack show`, `slack update`, `slack channels`, `slack test` |
| Webhooks | `webhooks list`, `webhooks create`, `webhooks rotate-secret`, `webhooks verify` |

The command tree is generated from the public API operation registry. Run help
at any level to discover flags, required scopes, request shape, side effects,
output modes, and an example:

```bash
openpmm --help
openpmm posts --help
openpmm posts publish --help
```

## Automation and output

The CLI is designed for both people and agents:

- Human-readable output is the default.
- `--json` emits one stable JSON value.
- `--jsonl` emits one item per line for list commands.
- `--quiet` emits IDs only.
- JSON stays on stdout. Diagnostics stay on stderr.
- `--limit` bounds total list items; `--page-size` controls API page size.
- `--file <path|->` supplies a complete JSON request body.
- Errors include actionable codes, request IDs, retryability, and recovery
  idempotency keys when the API returns them.

Use `--api-base-url <url>` or `OPENPMM_API_BASE_URL` to select a compatible API
environment. The default is `https://api.openpmm.com/v1`.

## Safety and scope

- The CLI calls only OpenPMM's public `/v1` API.
- It does not use private `/api` routes, a local database, or a browser session.
- Workspace-scoped commands require an explicit workspace selector or
  `OPENPMM_WORKSPACE`.
- Irreversible actions require explicit `--yes` confirmation.
- Exit codes are stable: `0` success, `2` input, `3` authentication, `4`
  scope, `5` not found, `6` conflict, `7` validation, `8` unavailable, `9`
  ambiguous, and `10` confirmation required.

## Development

Use Node.js 22 or newer. The package has no runtime dependencies.

```bash
npm test
npm run pack
```

Check command and API coverage against a deployed OpenPMM API:

```bash
npm run check:api-coverage -- https://api.openpmm.com/v1/openapi.json
```

See [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request. Keep
command names, flags, JSON output, stdout and stderr behavior, and exit codes
backward compatible.

## Documentation and support

- [CLI documentation](https://docs.openpmm.com/cli/overview)
- `openpmm --help` and `openpmm <command> --help`
- [Issue tracker](https://github.com/OpenPMM/cli/issues)
- [Security policy](SECURITY.md)
