# OpenPMM CLI

The first-party, API-only command line client for OpenPMM.

```bash
npx -y @openpmm/cli --help
export OPENPMM_API_KEY=opm_live_...
npx -y @openpmm/cli workspaces list --json
npx -y @openpmm/cli post-groups create launch --workspace ws_... --channel x --body 'Draft copy'
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
