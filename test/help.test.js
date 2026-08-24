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
  const help = stdout.read()
  assert.match(help, /Calls POST \/workspaces\/\{workspace_id\}\/posts\/publish\./)
  assert.match(help, /Exit 0 means OpenPMM accepted the state change/)
  assert.match(help, /Do not send publish again for a pending Post/)
  for (const flag of [
    '--workspace <id>',
    '--file <path|->',
    '--post <id>',
    '--post-version <number>',
    '--destination <id>',
    '--at <now|queue|timestamp>',
    '--time-zone <iana-name>',
    '--wait',
    '--wait-timeout <seconds>',
    '--idempotency-key <key>',
    '--yes',
    '--json',
  ])
    assert.match(help, new RegExp(flag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  assert.match(
    help,
    /openpmm posts publish --workspace ws_01JABCDEF --file request\.json --yes --json/
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
  const help = stdout.read()
  assert.match(help, /openpmm assets upload <path> \[flags\]/)
  assert.match(help, /--workspace <id>/)
  assert.match(help, /--kind <card\|reel\|poster>/)
  assert.match(help, /--content-type <type>/)
  assert.match(help, /--idempotency-key <key>/)
})

test('direct post creation help exposes the conditional confirmation gate', async () => {
  const stdout = output()
  const exitCode = await run(['posts', 'create', '--help'], {
    stdin: process.stdin,
    stdout: stdout.stream,
    stderr: output().stream,
  })

  assert.equal(exitCode, 0)
  const help = stdout.read()
  assert.match(
    help,
    /Side effects: Requires --yes unless the request creates a draft\./
  )
  assert.match(help, /--file request\.json --yes --json/)
  assert.match(help, /Use --when queue/)
  for (const flag of [
    '--when <draft|now|queue|timestamp>',
    '--group <value>',
    '--channel <channel>',
    '--body <text>',
    '--destination <id>',
    '--file <path|->',
    '--yes',
    '--json',
  ])
    assert.match(help, new RegExp(flag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
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

test('agent help keeps credentials and publication status inside the CLI', async () => {
  const login = output()
  const doctor = output()
  const wait = output()

  await run(['auth', 'login', '--help'], {
    stdin: process.stdin,
    stdout: login.stream,
    stderr: output().stream,
  })
  await run(['doctor', '--help'], {
    stdin: process.stdin,
    stdout: doctor.stream,
    stderr: output().stream,
  })
  await run(['posts', 'wait', '--help'], {
    stdin: process.stdin,
    stdout: wait.stream,
    stderr: output().stream,
  })

  assert.match(login.read(), /credential file is an internal implementation detail/)
  assert.match(login.read(), /Do not read, parse, copy, export, or reuse it/)
  assert.match(login.read(), /separate API credential/)
  assert.match(doctor.read(), /This command never prints an API key/)
  assert.match(wait.read(), /Do not send posts publish again/)
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
