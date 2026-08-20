# Changelog

## 0.2.0 - 2026-08-20

- Added browser-authorized login and agent-safe signup handoff.
- Added billing, analytics, feedback, thread media, queue movement, and
  scheduled Post editing commands.
- Improved command usage help, destination and Post list output, and logout
  reporting.
- Flattened machine-readable list output so items are available at `data[]`.

## 0.1.0 - 2026-08-11

- Added complete command coverage for the OpenPMM public `/v1` API.
- Added protected API-key storage with environment-first authentication.
- Added stable JSON, JSONL, quiet output, actionable errors, and exit codes.
- Added explicit confirmation, ETag handling, idempotency, pagination, and safe
  retries.
- Added workspace webhook management, one-time signing-secret rotation, test
  delivery, and local exact-byte signature verification.
