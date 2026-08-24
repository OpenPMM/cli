import assert from 'node:assert/strict'
import { test } from 'node:test'
import { OPERATIONS } from '../src/operations.js'
import { run } from '../src/openpmm.js'

function output() {
  let value = ''
  return {
    stream: {
      write(chunk) {
        value += chunk
      },
    },
    read: () => value,
  }
}

test('publishing help is a stable, copy-pasteable public contract', async () => {
  const stdout = output()
  const exitCode = await run(['posts', 'publish', '--help'], {
    stdin: process.stdin,
    stdout: stdout.stream,
    stderr: output().stream,
  })

  assert.equal(exitCode, 0)
  assert.equal(
    stdout.read(),
    `posts publish

Usage:
  openpmm posts publish [flags]

Publish posts through the public API.
Calls POST /workspaces/{workspace_id}/posts/publish.
Required scope: posts:write
Workspace: required
Side effects: Requires --yes. This can publish, disconnect, or delete data.
Input: common flags or --file <request.json>; use --file - for stdin. Include every draft Post in the group. Use --at queue to use the next destination queue slot.
Output: human by default; --json, -json, --jsonl (lists), or --quiet.
Relevant exits: 0 success, 1 error, 2 input, 3 auth, 4 scope, 5 not found, 6 conflict, 7 validation, 8 unavailable, 9 ambiguous, 10 confirmation.

Example:
  openpmm posts publish  --workspace ws_01JABCDEF --file request.json --yes --json
`
  )
})

test('asset workflow help states every required input', async () => {
  const stdout = output()
  const exitCode = await run(['assets', 'upload', '--help'], {
    stdin: process.stdin,
    stdout: stdout.stream,
    stderr: output().stream,
  })

  assert.equal(exitCode, 0)
  assert.equal(
    stdout.read(),
    `openpmm assets upload <path> --workspace <id> [--kind card|reel|poster] [--content-type <type>]

Create an upload session, stream the file to storage, and complete it through public /v1 operations.
`
  )
})

test('direct post creation help exposes the conditional confirmation gate', async () => {
  const stdout = output()
  const exitCode = await run(['posts', 'create', '--help'], {
    stdin: process.stdin,
    stdout: stdout.stream,
    stderr: output().stream,
  })

  assert.equal(exitCode, 0)
  assert.match(
    stdout.read(),
    /Side effects: Requires --yes unless the request creates a draft\./
  )
  assert.match(stdout.read(), /--file request\.json --yes --json/)
  assert.match(stdout.read(), /Use --when queue/)
})

test('queue move help explains one Post and atomic multi-Post input', async () => {
  const stdout = output()
  const exitCode = await run(['posts', 'move-in-queue', '--help'], {
    stdin: process.stdin,
    stdout: stdout.stream,
    stderr: output().stream,
  })

  assert.equal(exitCode, 0)
  assert.match(stdout.read(), /Use --post, --expected-scheduled-at, and --local-date/)
  assert.match(stdout.read(), /Use --file for an atomic multi-Post move/)
})

test('destination connection help explains provider-specific inputs', async () => {
  const stdout = output()
  const exitCode = await run(['destinations', 'connect', '--help'], {
    stdin: process.stdin,
    stdout: stdout.stream,
    stderr: output().stream,
  })

  assert.equal(exitCode, 0)
  assert.match(stdout.read(), /Bluesky requires --account <handle-or-did>/)
  assert.match(
    stdout.read(),
    /bluesky\|x\|youtube\|facebook\|instagram\|threads\|mastodon\|linkedin\|tiktok/
  )
  assert.match(stdout.read(), /Mastodon requires --instance-origin <url>/)
  assert.match(stdout.read(), /Use --provider bluesky\|x\|youtube/)
})

test('every API command help includes a usage line', async () => {
  for (const operation of OPERATIONS) {
    if (
      operation.command === 'auth login' ||
      operation.command.startsWith('analytics ')
    )
      continue
    const stdout = output()
    const exitCode = await run(
      [...operation.command.split(' '), '--help'],
      {
        stdin: process.stdin,
        stdout: stdout.stream,
        stderr: output().stream,
      }
    )
    assert.equal(exitCode, 0, operation.command)
    assert.match(stdout.read(), /\nUsage:\n  openpmm /, operation.command)
  }
})

test('root help lists logout and logout help identifies its target', async () => {
  const root = output()
  const logout = output()
  await run(['--help'], {
    stdin: process.stdin,
    stdout: root.stream,
    stderr: output().stream,
  })
  await run(['auth', 'logout', '--help'], {
    stdin: process.stdin,
    stdout: logout.stream,
    stderr: output().stream,
  })
  assert.match(root.read(), /  auth logout\n/)
  assert.match(logout.read(), /--api-base-url <url>/)
})

test('Slack help separates Account connection from Workspace settings', async () => {
  const connect = output()
  const update = output()

  assert.equal(
    await run(['slack', 'connect', '--help'], {
      stdin: process.stdin,
      stdout: connect.stream,
      stderr: output().stream,
    }),
    0
  )
  assert.match(connect.read(), /Calls POST \/account\/slack-connection-sessions\./)
  assert.match(connect.read(), /Required scope: notifications:write/)
  assert.match(connect.read(), /Workspace: not required/)

  assert.equal(
    await run(['slack', 'update', '--help'], {
      stdin: process.stdin,
      stdout: update.stream,
      stderr: output().stream,
    }),
    0
  )
  assert.match(update.read(), /Workspace: required/)
})

test('webhook help exposes the public endpoint and scope', async () => {
  const stdout = output()
  const exitCode = await run(['webhooks', 'create', '--help'], {
    stdin: process.stdin,
    stdout: stdout.stream,
    stderr: output().stream,
  })

  assert.equal(exitCode, 0)
  assert.match(
    stdout.read(),
    /Calls POST \/workspaces\/\{workspace_id\}\/webhook-endpoints\./
  )
  assert.match(stdout.read(), /Required scope: webhooks:write/)
})

test('feedback help exposes the public endpoint, scope, and message flag', async () => {
  const stdout = output()
  const exitCode = await run(['feedback', 'submit', '--help'], {
    stdin: process.stdin,
    stdout: stdout.stream,
    stderr: output().stream,
  })

  assert.equal(exitCode, 0)
  assert.match(
    stdout.read(),
    /Calls POST \/workspaces\/\{workspace_id\}\/feedback\./
  )
  assert.match(stdout.read(), /Required scope: feedback:write/)
  assert.match(stdout.read(), /Use --message <text>/)
})

test('Writing Assistant settings help exposes the full replacement contract', async () => {
  const show = output()
  const update = output()

  assert.equal(
    await run(['writing-assistant', 'settings', 'show', '--help'], {
      stdin: process.stdin,
      stdout: show.stream,
      stderr: output().stream,
    }),
    0
  )
  assert.match(
    show.read(),
    /Calls GET \/workspaces\/\{workspace_id\}\/writing-refinement-settings\./
  )
  assert.match(show.read(), /Required scope: workspaces:read/)
  assert.match(show.read(), /Workspace: required/)

  assert.equal(
    await run(['writing-assistant', 'settings', 'update', '--help'], {
      stdin: process.stdin,
      stdout: update.stream,
      stderr: output().stream,
    }),
    0
  )
  assert.match(
    update.read(),
    /Provide a complete JSON request body with an actions object for all seven refinement options/
  )
  assert.match(update.read(), /Each action requires title, prompt, and icon/)
  assert.match(update.read(), /Required scope: workspaces:write/)
})

test('signup help states the anonymous browser handoff', async () => {
  const stdout = output()
  const exitCode = await run(['signup', 'create', '--help'], {
    stdin: process.stdin,
    stdout: stdout.stream,
    stderr: output().stream,
  })

  assert.equal(exitCode, 0)
  assert.match(stdout.read(), /Calls POST \/signup-intents\./)
  assert.match(stdout.read(), /does not require an API key/)
  assert.match(stdout.read(), /Google or an email address and password/)
})

test('billing help explains the trial and payment confirmation', async () => {
  const subscribe = output()
  const convert = output()
  assert.equal(
    await run(['billing', 'subscribe', '--help'], {
      stdin: process.stdin,
      stdout: subscribe.stream,
      stderr: output().stream,
    }),
    0
  )
  assert.match(subscribe.read(), /Required scope: billing:write/)
  assert.match(subscribe.read(), /Use --interval month or --interval year/)
  assert.match(subscribe.read(), /Signup starts the 14-day trial automatically/)
  assert.match(subscribe.read(), /beta offer without a promotion code/)
  assert.match(subscribe.read(), /Annual costs \$75\.62 for the first year/)
  assert.match(subscribe.read(), /start paid service immediately and unlock X/)
  assert.match(subscribe.read(), /Requires --yes/)

  assert.equal(
    await run(['billing', 'convert-trial', '--help'], {
      stdin: process.stdin,
      stdout: convert.stream,
      stderr: output().stream,
    }),
    0
  )
  assert.match(convert.read(), /only for legacy Stripe-hosted trials/)
  assert.match(convert.read(), /New trials use billing subscribe/)
})

test('webhook verification help explains the local security check', async () => {
  const stdout = output()
  const exitCode = await run(['webhooks', 'verify', '--help'], {
    stdin: process.stdin,
    stdout: stdout.stream,
    stderr: output().stream,
  })

  assert.equal(exitCode, 0)
  assert.match(stdout.read(), /exact payload bytes/)
  assert.match(stdout.read(), /does not call the API/)
})
