# Contributing

Thank you for improving the OpenPMM CLI.

## Development

Use Node.js 22 or newer. The package has no runtime dependencies.

```bash
npm test
npm run pack
```

To compare the CLI operation and command registry with a deployed OpenPMM API:

```bash
npm run check:api-coverage -- https://api.openpmm.com/v1/openapi.json
```

Keep command names, flags, JSON output, stdout and stderr behavior, and exit
codes backward compatible. These are public interfaces. Add or update tests
for every behavioral change.

Do not add private OpenPMM routes, server modules, provider credentials, or
application database access. The CLI can call only the public `/v1` API.

## Pull requests

Explain the customer job that changes. Include the validation commands you
ran. Do not include API keys, webhook signing secrets, customer content, or
production resource identifiers in issues, fixtures, logs, or pull requests.
