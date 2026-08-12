# OpenPMM CLI

The first-party, API-only command line client for OpenPMM.

The complete source is public so you can audit what runs in your terminal and
CI environment. The CLI has no runtime dependencies. It calls only the public
OpenPMM `/v1` API.

## Install or run once

```bash
npx -y @openpmm/cli --help
npm install --global @openpmm/cli
openpmm --version
```

Node.js 22 or newer is required.

## Quick start

```bash
export OPENPMM_API_KEY=opm_live_...
npx -y @openpmm/cli workspaces list --json
npx -y @openpmm/cli post-groups create launch --workspace ws_... --channel x --body 'Draft copy'
npx -y @openpmm/cli webhooks list --workspace ws_... --json
```

Verify a received webhook locally against its exact body bytes:

```bash
OPENPMM_WEBHOOK_SECRET=whsec_... npx -y @openpmm/cli webhooks verify \
  --signature 't=...,v1=...' \
  --file payload.json
```

Every Workspace command requires `--workspace ws_...` or
`OPENPMM_WORKSPACE`. The CLI calls only the public `/v1` API. Publishing,
disconnecting, and destructive commands require `--yes`.

For a protected local credential, pipe the API key through stdin:

```bash
printf '%s' "$OPENPMM_API_KEY" | openpmm auth login --with-token
```

Run `openpmm --help` and `openpmm <command> --help` for the complete command
tree, scopes, examples, output modes, and exit codes.

Read the [CLI documentation](https://docs.openpmm.com/cli/overview) for
authentication, publishing workflows, machine output, safety behavior, and
webhook verification.

## Development

```bash
npm test
npm run pack
```

The release workflow also compares the command registry with the production
OpenAPI document. See [CONTRIBUTING.md](CONTRIBUTING.md) before you open a pull
request.
