# Changelog

## Unreleased

- Renamed the generic video Asset kind from `reel` to `video`. The retired
  `reel` Asset kind is rejected.
- Added the unavailable reason to the human-readable Destination list.
- Removed `assets validate`. OpenPMM now handles compatible media preparation
  without exposing conversion status or rendition details.
- Made Facebook placement automatic and rejected the retired
  `destination_options.facebook` input before any API request.
- Added publication `outcome` values and exit code `11` when a Post needs
  action while preserving structured results and receipts.
- Marked browser authorization metadata as sensitive.

## 0.4.1 - 2026-08-25

- Added structured browser-login recovery commands and removed the fake HTTP
  status from local errors.
- Split `doctor` readiness into draft and publication workflows.
- Added separate draft and publication examples to `posts create --help`.
- Added media-only thread item support for X, Bluesky, Mastodon, and Threads.

## 0.4.0 - 2026-08-24

- Added `openpmm doctor` for read-only compatibility, authentication, scope,
  Workspace, Destination, and credential permission checks.
- Added bounded `posts publish --wait`, immediate `posts create --wait`, and
  `posts wait` status handling through the CLI.
- Added complete command-specific flag tables and rejected flags that belong
  to another command before a request.
- Documented the CLI credential boundary, deterministic agent workflow,
  publication acceptance contract, and global-install `PATH` diagnostics.
- Removed the `writing-assistant settings show` and
  `writing-assistant settings update` commands after the public API dropped the
  `writing-refinement-settings` endpoints.

## 0.3.0 - 2026-08-24

- Restored the `writing-assistant settings show` and
  `writing-assistant settings update` commands, which a merge in #32 had
  accidentally reverted after #31 added them.
- Upgraded CI GitHub Actions: `actions/checkout` 6 → 7.0.1 and
  `actions/setup-node` 5 → 7.0.0 (both migrated to the Node 24 runtime).

## 0.2.0 - 2026-08-20

- Added browser-authorized login and agent-safe signup handoff.
- Added billing, analytics, feedback, thread media, queue movement, and
  scheduled Post editing commands.
- Improved command usage help, destination and Post list output, and logout
  reporting.
- Flattened machine-readable list output so items are available at `data[]`.
- Gated `posts delete` behind `--yes` so it can no longer delete drafts or
  scheduled Posts without confirmation, matching every other destructive
  command.
- Rejected unknown flags with a clear exit 2 instead of silently ignoring an
  unrecognized flag that carries a value, and stopped an unknown flag without a
  value from escaping the error handler as a raw stack trace and exit 1.
- Documented the `--etag` override in the global flag help.

## 0.1.0 - 2026-08-11

- Added complete command coverage for the OpenPMM public `/v1` API.
- Added protected API-key storage with environment-first authentication.
- Added stable JSON, JSONL, quiet output, actionable errors, and exit codes.
- Added explicit confirmation, ETag handling, idempotency, pagination, and safe
  retries.
- Added workspace webhook management, one-time signing-secret rotation, test
  delivery, and local exact-byte signature verification.
