import assert from 'node:assert/strict'
import { test } from 'node:test'
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

Publish posts through the public API.
Calls POST /workspaces/{workspace_id}/posts/publish.
Required scope: posts:write
Workspace: required
Side effects: Requires --yes. This can publish, disconnect, or delete data.
Input: common flags or --file <request.json>; use --file - for stdin. Include every draft Post in the group.
Output: human by default; --json, -json, --jsonl (lists), or --quiet.
Relevant exits: 0 success, 2 input, 3 auth, 4 scope, 5 not found, 6 conflict, 7 validation, 8 unavailable, 9 ambiguous, 10 confirmation.

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
  assert.match(stdout.read(), /Mastodon requires --instance-origin <url>/)
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
