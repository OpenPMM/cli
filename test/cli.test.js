import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { OPERATIONS } from '../src/operations.js'
import { run } from '../src/openpmm.js'
import { crc64NvmeBase64 } from '../src/crc64.js'
import { PublicApiTransport } from '../src/transport.js'

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

async function withApiKey(callback) {
  const previous = process.env.OPENPMM_API_KEY
  process.env.OPENPMM_API_KEY = 'test-key'
  try {
    return await callback()
  } finally {
    if (previous === undefined) delete process.env.OPENPMM_API_KEY
    else process.env.OPENPMM_API_KEY = previous
  }
}

test('every operation has one unique, guessable command and a /v1-safe path', () => {
  assert.equal(
    new Set(OPERATIONS.map((operation) => operation.id)).size,
    OPERATIONS.length
  )
  assert.equal(
    new Set(OPERATIONS.map((operation) => operation.command)).size,
    OPERATIONS.length
  )
  for (const operation of OPERATIONS) {
    assert.match(
      operation.command,
      /^[a-z]+(?:-[a-z]+)*(?: (?:--)?[a-z]+(?:-[a-z]+)*)+$/
    )
    assert.ok(operation.path.startsWith('/'))
    assert.ok(!operation.path.startsWith('/api/'))
  }
})

test('analytics selects post and group resources without private routes', async () => {
  const requests = []
  await withApiKey(async () => {
    for (const args of [
      ['analytics', 'show', '--post', 'post_1'],
      ['analytics', 'show', '--group', 'launch group'],
    ]) {
      const exitCode = await run(
        [...args, '--workspace', 'ws_1', '--json'],
        {
          stdin: process.stdin,
          stdout: output().stream,
          stderr: output().stream,
        },
        {
          fetchImpl: async (url) => {
            requests.push(String(url))
            return new Response(JSON.stringify({ object: 'analytics' }), {
              headers: { 'content-type': 'application/json' },
            })
          },
        }
      )
      assert.equal(exitCode, 0)
    }
  })
  assert.deepEqual(requests, [
    'https://api.openpmm.com/v1/workspaces/ws_1/analytics/posts/post_1',
    'https://api.openpmm.com/v1/workspaces/ws_1/analytics/post-groups/launch%20group',
  ])
})

test('analytics report sends a bounded publication-cohort query', async () => {
  let requestUrl
  await withApiKey(async () => {
    const exitCode = await run(
      [
        'analytics',
        'report',
        '--workspace',
        'ws_1',
        '--from',
        '2026-08-01',
        '--until',
        '2026-08-08',
        '--bucket',
        'week',
        '--channel',
        'linkedin',
        '--limit',
        '25',
        '--json',
      ],
      {
        stdin: process.stdin,
        stdout: output().stream,
        stderr: output().stream,
      },
      {
        fetchImpl: async (url) => {
          requestUrl = String(url)
          return new Response(JSON.stringify({ data: [] }), {
            headers: { 'content-type': 'application/json' },
          })
        },
      }
    )
    assert.equal(exitCode, 0)
  })
  const url = new URL(requestUrl)
  assert.equal(
    url.pathname,
    '/v1/workspaces/ws_1/analytics'
  )
  assert.deepEqual(Object.fromEntries(url.searchParams), {
    from: '2026-08-01',
    until: '2026-08-08',
    bucket: 'week',
    channel: 'linkedin',
    limit: '25',
  })
})

test('analytics refresh returns immediately or waits for current values', async () => {
  const calls = []
  const sleeps = []
  const stdout = output()
  await withApiKey(async () => {
    const exitCode = await run(
      [
        'analytics',
        'refresh',
        '--post',
        'post_1',
        '--workspace',
        'ws_1',
        '--idempotency-key',
        'analytics_test_1',
        '--wait',
        '--json',
      ],
      { stdin: process.stdin, stdout: stdout.stream, stderr: output().stream },
      {
        sleep: async (milliseconds) => sleeps.push(milliseconds),
        fetchImpl: async (url, init) => {
          calls.push({ url: String(url), method: init.method, headers: init.headers })
          if (init.method === 'POST')
            return new Response(
              JSON.stringify({ object: 'post_analytics', state: 'pending' }),
              {
                status: 202,
                headers: {
                  'content-type': 'application/json',
                  location: '/v1/workspaces/ws_1/analytics/posts/post_1',
                },
              }
            )
          return new Response(
            JSON.stringify({ object: 'post_analytics', state: 'ready', metrics: { comments: 4 } }),
            { headers: { 'content-type': 'application/json' } }
          )
        },
      }
    )
    assert.equal(exitCode, 0)
  })
  assert.deepEqual(sleeps, [2_000])
  assert.equal(calls.length, 2)
  assert.equal(calls[0].headers['Idempotency-Key'], 'analytics_test_1')
  assert.equal(calls[1].url, 'https://api.openpmm.com/v1/workspaces/ws_1/analytics/posts/post_1')
  const rendered = JSON.parse(stdout.read())
  assert.equal(rendered.data.metrics.comments, 4)
  assert.equal(rendered.meta.waited, true)
})

test('transport sends clean public API requests and parses request IDs', async () => {
  let seen
  const transport = new PublicApiTransport({
    apiKey: 'test-key',
    baseUrl: 'https://example.test',
    fetchImpl: async (url, init) => {
      seen = { url: String(url), init }
      return new Response(JSON.stringify({ id: 'ws_1' }), {
        headers: {
          'content-type': 'application/json',
          'openpmm-request-id': 'req_1',
        },
      })
    },
  })
  const result = await transport.request({ method: 'GET', path: '/workspaces' })
  assert.equal(seen.url, 'https://example.test/v1/workspaces')
  assert.equal(seen.init.headers.Authorization, 'Bearer test-key')
  assert.equal(result.requestId, 'req_1')
})

test('transport returns accepted background preparation responses immediately', async () => {
  const transport = new PublicApiTransport({
    apiKey: 'opm_live_test',
    baseUrl: 'https://api.openpmm.com/v1',
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          object: 'post_set',
          posts: [{ id: 'post_123', state: 'preparing' }],
        }),
        {
          status: 202,
          headers: {
            'content-type': 'application/json',
            'retry-after': '5',
          },
        }
      ),
  })

  const result = await transport.request({
    method: 'POST',
    path: '/workspaces/ws_123/posts/publish',
    headers: { 'Idempotency-Key': 'publish_123' },
    body: { confirmed: true },
  })

  assert.equal(result.status, 202)
  assert.equal(result.data.posts[0].state, 'preparing')
  assert.equal(result.headers.get('retry-after'), '5')
})

test('signup creates a hosted link without reading or sending an API key', async () => {
  const previous = process.env.OPENPMM_API_KEY
  delete process.env.OPENPMM_API_KEY
  let seen
  const stdout = output()
  try {
    const exitCode = await run(
      [
        'signup',
        'create',
        '--email',
        'publisher@example.com',
        '--workspace-name',
        'Product Marketing',
        '--json',
      ],
      { stdin: process.stdin, stdout: stdout.stream, stderr: output().stream },
      {
        fetchImpl: async (url, init) => {
          seen = { url: String(url), init, body: JSON.parse(init.body) }
          return new Response(
            JSON.stringify({
              object: 'signup_intent',
              signup_url: 'https://app.openpmm.com/signup/token',
              expires_at: '2026-08-18T12:30:00.000Z',
            }),
            { status: 201, headers: { 'content-type': 'application/json' } }
          )
        },
      }
    )
    assert.equal(exitCode, 0)
  } finally {
    if (previous === undefined) delete process.env.OPENPMM_API_KEY
    else process.env.OPENPMM_API_KEY = previous
  }
  assert.equal(seen.url, 'https://api.openpmm.com/v1/signup-intents')
  assert.equal(seen.init.headers.Authorization, undefined)
  assert.deepEqual(seen.body, {
    email: 'publisher@example.com',
    workspace_name: 'Product Marketing',
  })
  assert.match(stdout.read(), /https:\/\/app\.openpmm\.com\/signup\/token/)
})

test('Slack connection starts at Account scope without a Workspace selector', async () => {
  let requestUrl
  await withApiKey(async () => {
    const exitCode = await run(
      ['slack', 'connect', '--json'],
      {
        stdin: process.stdin,
        stdout: output().stream,
        stderr: output().stream,
      },
      {
        fetchImpl: async (url) => {
          requestUrl = String(url)
          return new Response(
            JSON.stringify({
              id: 'dcs_1',
              object: 'slack_connection_session',
              status: 'pending',
              authorization_url: 'https://app.openpmm.com/connect',
              expires_at: '2026-08-12T22:00:00.000Z',
            }),
            {
              status: 201,
              headers: { 'content-type': 'application/json' },
            }
          )
        },
      }
    )
    assert.equal(exitCode, 0)
  })
  assert.equal(
    requestUrl,
    'https://api.openpmm.com/v1/account/slack-connection-sessions'
  )
})

test('billing subscribe sends the interval, confirmation, and idempotency key', async () => {
  let seen
  await withApiKey(async () => {
    const exitCode = await run(
      [
        'billing',
        'subscribe',
        '--interval',
        'year',
        '--idempotency-key',
        'billing_test_1',
        '--yes',
        '--json',
      ],
      { stdin: process.stdin, stdout: output().stream, stderr: output().stream },
      {
        fetchImpl: async (url, init) => {
          seen = {
            url: String(url),
            headers: init.headers,
            body: JSON.parse(init.body),
          }
          return new Response(
            JSON.stringify({
              object: 'billing_checkout_session',
              url: 'https://checkout.stripe.com/test',
            }),
            { status: 201, headers: { 'content-type': 'application/json' } }
          )
        },
      }
    )
    assert.equal(exitCode, 0)
  })
  assert.equal(seen.url, 'https://api.openpmm.com/v1/billing/checkout-sessions')
  assert.equal(seen.headers['Idempotency-Key'], 'billing_test_1')
  assert.deepEqual(seen.body, { interval: 'year', confirmed: true })
})

test('workspace creation requires confirmation before a prorated charge', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'openpmm-cli-'))
  const requestPath = join(directory, 'workspace.json')
  await writeFile(
    requestPath,
    JSON.stringify({ name: 'Product Marketing', time_zone: 'Europe/Berlin' })
  )
  let seen
  await withApiKey(async () => {
    const rejected = await run(
      ['workspaces', 'create', '--file', requestPath],
      {
        stdin: process.stdin,
        stdout: output().stream,
        stderr: output().stream,
      },
      {
        fetchImpl: async () => {
          throw new Error('The API must not be called without --yes.')
        },
      }
    )
    assert.equal(rejected, 10)

    const accepted = await run(
      [
        'workspaces',
        'create',
        '--file',
        requestPath,
        '--idempotency-key',
        'workspace_test_1',
        '--yes',
        '--json',
      ],
      {
        stdin: process.stdin,
        stdout: output().stream,
        stderr: output().stream,
      },
      {
        fetchImpl: async (url, init) => {
          seen = {
            url: String(url),
            headers: init.headers,
            body: JSON.parse(init.body),
          }
          return new Response(
            JSON.stringify({ id: 'ws_created', object: 'workspace' }),
            { status: 201, headers: { 'content-type': 'application/json' } }
          )
        },
      }
    )
    assert.equal(accepted, 0)
  })
  assert.equal(seen.url, 'https://api.openpmm.com/v1/workspaces')
  assert.equal(seen.headers['Idempotency-Key'], 'workspace_test_1')
  assert.deepEqual(seen.body, {
    name: 'Product Marketing',
    time_zone: 'Europe/Berlin',
    confirmed: true,
  })
})

test('media validation sends destination IDs through the public API', async () => {
  let seen
  const stdout = output()
  await withApiKey(async () => {
    const exitCode = await run(
      [
        'assets',
        'validate',
        'asset_1',
        '--workspace',
        'ws_1',
        '--destination',
        'dst_1',
        '--destination',
        'dst_2',
        '--json',
      ],
      { stdin: process.stdin, stdout: stdout.stream, stderr: output().stream },
      {
        fetchImpl: async (url, init) => {
          seen = { url: String(url), body: JSON.parse(init.body) }
          return new Response(
            JSON.stringify({
              object: 'media_validation',
              media_kind: 'image',
              asset_id: 'asset_1',
              metadata_version: 1,
              status: 'compatible_original',
              issues: [],
            }),
            { headers: { 'content-type': 'application/json' } }
          )
        },
      }
    )
    assert.equal(exitCode, 0)
  })
  assert.equal(
    seen.url,
    'https://api.openpmm.com/v1/workspaces/ws_1/assets/asset_1/validations'
  )
  assert.deepEqual(seen.body, { destination_ids: ['dst_1', 'dst_2'] })
  assert.match(stdout.read(), /"media_validation"/)
})

test('Bluesky connection sends the account identifier', async () => {
  let seen
  await withApiKey(async () => {
    const exitCode = await run(
      [
        'destinations',
        'connect',
        '--workspace',
        'ws_1',
        '--provider',
        'bluesky',
        '--account',
        'alice.bsky.social',
        '--json',
      ],
      { stdin: process.stdin, stdout: output().stream, stderr: output().stream },
      {
        fetchImpl: async (url, init) => {
          seen = { url: String(url), body: JSON.parse(init.body) }
          return new Response(
            JSON.stringify({
              id: 'dcs_1',
              object: 'destination_connection_session',
              provider: 'bluesky',
              status: 'pending',
              authorization_url: 'https://app.openpmm.com/authorize',
            }),
            { status: 201, headers: { 'content-type': 'application/json' } }
          )
        },
      }
    )
    assert.equal(exitCode, 0)
  })
  assert.match(seen.url, /destination-connection-sessions$/)
  assert.deepEqual(seen.body, {
    provider: 'bluesky',
    account_identifier: 'alice.bsky.social',
  })
})

test('a destructive command exits 10 before making a request', async () => {
  const out = output()
  const err = output()
  let calls = 0
  const exitCode = await run(
    [
      'destinations',
      'disconnect',
      'dst_42',
      '--workspace',
      'ws_1',
      '--json',
    ],
    { stdin: process.stdin, stdout: out.stream, stderr: err.stream },
    {
      fetchImpl: async () => {
        calls += 1
        return new Response()
      },
    }
  )
  assert.equal(exitCode, 10)
  assert.equal(calls, 0)
  assert.equal(out.read(), '')
  assert.match(err.read(), /confirmation_required/)
})

test('webhook creation sends typed endpoint configuration', async () => {
  let request
  await withApiKey(async () => {
    const exitCode = await run(
      [
        'webhooks',
        'create',
        '--workspace',
        'ws_1',
        '--name',
        'Production events',
        '--url',
        'https://hooks.example.com/openpmm',
        '--events',
        'post.published,post.failed',
        '--destination-filter',
        'selected',
        '--destinations',
        'dst_1,dst_2',
        '--content-mode',
        'metadata',
        '--json',
      ],
      {
        stdin: process.stdin,
        stdout: output().stream,
        stderr: output().stream,
      },
      {
        fetchImpl: async (url, init) => {
          request = { url: String(url), init, body: JSON.parse(init.body) }
          return new Response(
            JSON.stringify({
              id: 'wh_1',
              object: 'webhook_endpoint',
              secret: 'whsec_once',
            }),
            {
              status: 201,
              headers: { 'content-type': 'application/json' },
            }
          )
        },
      }
    )
    assert.equal(exitCode, 0)
  })

  assert.equal(
    request.url,
    'https://api.openpmm.com/v1/workspaces/ws_1/webhook-endpoints'
  )
  assert.deepEqual(request.body, {
    name: 'Production events',
    url: 'https://hooks.example.com/openpmm',
    event_types: ['post.published', 'post.failed'],
    destination_filter_mode: 'selected',
    destination_ids: ['dst_1', 'dst_2'],
    content_mode: 'metadata',
  })
  assert.ok(request.init.headers['Idempotency-Key'])
})

test('feedback submission sends a message through the public API', async () => {
  let request
  const stdout = output()
  await withApiKey(async () => {
    const exitCode = await run(
      [
        'feedback',
        'submit',
        '--workspace',
        'ws_1',
        '--message',
        'The scheduled Posts view did not refresh.',
        '--idempotency-key',
        'feedback-request',
        '--json',
      ],
      {
        stdin: process.stdin,
        stdout: stdout.stream,
        stderr: output().stream,
      },
      {
        fetchImpl: async (url, init) => {
          request = { url: String(url), init, body: JSON.parse(init.body) }
          return new Response(
            JSON.stringify({
              id: 'fb_1',
              object: 'feedback',
              sent: true,
              submitted_at: '2026-08-17T12:00:00.000Z',
            }),
            {
              status: 201,
              headers: { 'content-type': 'application/json' },
            }
          )
        },
      }
    )
    assert.equal(exitCode, 0)
  })

  assert.equal(
    request.url,
    'https://api.openpmm.com/v1/workspaces/ws_1/feedback'
  )
  assert.deepEqual(request.body, {
    message: 'The scheduled Posts view did not refresh.',
  })
  assert.equal(request.init.headers['Idempotency-Key'], 'feedback-request')
  assert.match(request.init.headers['User-Agent'], /^@openpmm\/cli\/0\.1\.0 /)
  assert.match(stdout.read(), /"feedback"/)
})

test('webhook secret operations reject output modes that discard the secret', async () => {
  let calls = 0
  const stderr = output()
  const exitCode = await run(
    [
      'webhooks',
      'create',
      '--workspace',
      'ws_1',
      '--name',
      'Production',
      '--url',
      'https://hooks.example.com/openpmm',
      '--quiet',
    ],
    { stdin: process.stdin, stdout: output().stream, stderr: stderr.stream },
    {
      fetchImpl: async () => {
        calls += 1
        return new Response()
      },
    }
  )

  assert.equal(exitCode, 2)
  assert.equal(calls, 0)
  assert.match(stderr.read(), /one-time secret is not discarded/)
})

test('webhooks verify checks the timestamp and exact payload bytes locally', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'openpmm-webhook-'))
  const payloadPath = join(directory, 'payload.json')
  const payload = Buffer.from('{"event":"published"}\n')
  await writeFile(payloadPath, payload)
  const timestamp = Math.floor(Date.now() / 1000)
  const previous = process.env.OPENPMM_WEBHOOK_SECRET
  process.env.OPENPMM_WEBHOOK_SECRET = 'whsec_test'
  try {
    const signature = createHmac('sha256', 'whsec_test')
      .update(`${timestamp}.`)
      .update(payload)
      .digest('hex')
    const stdout = output()
    const exitCode = await run(
      [
        'webhooks',
        'verify',
        '--signature',
        `t=${timestamp},v1=${signature}`,
        '--file',
        payloadPath,
        '--json',
      ],
      { stdin: process.stdin, stdout: stdout.stream, stderr: output().stream }
    )

    assert.equal(exitCode, 0)
    assert.deepEqual(JSON.parse(stdout.read()), { valid: true, timestamp })
  } finally {
    if (previous === undefined) delete process.env.OPENPMM_WEBHOOK_SECRET
    else process.env.OPENPMM_WEBHOOK_SECRET = previous
  }
})

test('webhook deletion reads an ETag and requires explicit confirmation', async () => {
  const requests = []
  await withApiKey(async () => {
    const exitCode = await run(
      ['webhooks', 'delete', 'wh_1', '--workspace', 'ws_1', '--yes', '--json'],
      {
        stdin: process.stdin,
        stdout: output().stream,
        stderr: output().stream,
      },
      {
        fetchImpl: async (url, init) => {
          requests.push({ url: String(url), init })
          if (init.method === 'GET')
            return new Response(
              JSON.stringify({ id: 'wh_1', object: 'webhook_endpoint' }),
              {
                headers: {
                  'content-type': 'application/json',
                  etag: '"webhook-endpoint:wh_1:v1"',
                },
              }
            )
          return new Response(
            JSON.stringify({
              id: 'wh_1',
              object: 'webhook_endpoint',
              deleted: true,
            }),
            { headers: { 'content-type': 'application/json' } }
          )
        },
      }
    )
    assert.equal(exitCode, 0)
  })

  assert.deepEqual(
    requests.map((request) => request.init.method),
    ['GET', 'DELETE']
  )
  assert.equal(
    requests[1].init.headers['If-Match'],
    '"webhook-endpoint:wh_1:v1"'
  )
})

test('direct publishing requires --yes for flag and file input', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'openpmm-cli-'))
  const requestPath = join(directory, 'publish.json')
  await writeFile(
    requestPath,
    JSON.stringify({
      confirmed: true,
      when: 'now',
      posts: [{ destination_id: 'dst_1', body: ['Publish me'] }],
    })
  )
  let calls = 0
  await withApiKey(async () => {
    for (const args of [
      [
        'posts',
        'create',
        '--workspace',
        'ws_1',
        '--destination',
        'dst_1',
        '--body',
        'Publish me',
      ],
      ['posts', 'create', '--workspace', 'ws_1', '--file', requestPath],
    ]) {
      const exitCode = await run(
        args,
        {
          stdin: process.stdin,
          stdout: output().stream,
          stderr: output().stream,
        },
        {
          fetchImpl: async () => {
            calls += 1
            return new Response()
          },
        }
      )
      assert.equal(exitCode, 10)
    }
  })
  assert.equal(calls, 0)
})

test('direct publishing sends confirmation after --yes', async () => {
  let body
  await withApiKey(async () => {
    const exitCode = await run(
      [
        'posts',
        'create',
        '--workspace',
        'ws_1',
        '--destination',
        'dst_1',
        '--body',
        'Publish me',
        '--yes',
        '--json',
      ],
      {
        stdin: process.stdin,
        stdout: output().stream,
        stderr: output().stream,
      },
      {
        fetchImpl: async (_url, init) => {
          body = JSON.parse(init.body)
          return new Response(
            JSON.stringify({ object: 'post_set', posts: [] }),
            {
              status: 201,
              headers: { 'content-type': 'application/json' },
            }
          )
        },
      }
    )
    assert.equal(exitCode, 0)
  })
  assert.equal(body.confirmed, true)
})

test('updates draft or scheduled Post content without requiring --yes', async () => {
  const methods = []
  let patchedBody
  await withApiKey(async () => {
    const exitCode = await run(
      [
        'posts',
        'update',
        'post_1',
        '--workspace',
        'ws_1',
        '--body',
        'Updated copy',
        '--options',
        '{"channel":"linkedin","visibility":"CONNECTIONS","allowResharing":false}',
        '--json',
      ],
      {
        stdin: process.stdin,
        stdout: output().stream,
        stderr: output().stream,
      },
      {
        fetchImpl: async (_url, init) => {
          methods.push(init.method)
          if (init.method === 'PATCH') patchedBody = JSON.parse(init.body)
          return init.method === 'GET'
            ? new Response(
                JSON.stringify({ object: 'post', state: 'scheduled' }),
                {
                  headers: {
                    'content-type': 'application/json',
                    etag: '"post:post_1:1"',
                  },
                }
              )
            : new Response(JSON.stringify({ object: 'post' }), {
                headers: { 'content-type': 'application/json' },
              })
        },
      }
    )
    assert.equal(exitCode, 0)
  })
  assert.deepEqual(methods, ['GET', 'PATCH'])
  assert.deepEqual(patchedBody, {
    body: ['Updated copy'],
    options: {
      channel: 'linkedin',
      visibility: 'CONNECTIONS',
      allowResharing: false,
    },
  })
})

test('JSON output stays on stdout and diagnostics stay on stderr', async () => {
  const out = output()
  const err = output()
  await withApiKey(async () => {
    const exitCode = await run(
      ['workspaces', 'list', '--json'],
      { stdin: process.stdin, stdout: out.stream, stderr: err.stream },
      {
        fetchImpl: async () =>
          new Response(
            JSON.stringify({
              data: [{ id: 'ws_1', name: 'Demo' }],
              has_more: false,
              next_cursor: null,
            }),
            {
              headers: {
                'content-type': 'application/json',
                'openpmm-request-id': 'req_1',
              },
            }
          ),
      }
    )
    assert.equal(exitCode, 0)
    assert.equal(err.read(), '')
    const parsed = JSON.parse(out.read())
    assert.equal(parsed.data.data[0].id, 'ws_1')
    assert.equal(parsed.meta.request_id, 'req_1')
  })
})

test('posts create composes the public draft operation', async () => {
  let request
  const out = output()
  await withApiKey(async () => {
    const exitCode = await run(
      [
        'posts',
        'create',
        '--workspace',
        'ws_1',
        '--channel',
        'x',
        '--when',
        'draft',
        '--group',
        'launch',
        '--body',
        'Draft copy',
        '--json',
      ],
      { stdin: process.stdin, stdout: out.stream, stderr: output().stream },
      {
        fetchImpl: async (url, init) => {
          request = { url: String(url), body: JSON.parse(init.body) }
          return new Response(
            JSON.stringify({ object: 'post_set', group: 'launch', posts: [] }),
            { status: 201, headers: { 'content-type': 'application/json' } }
          )
        },
      }
    )
    assert.equal(exitCode, 0)
  })
  assert.match(request.url, /\/v1\/workspaces\/ws_1\/posts$/)
  assert.equal(request.body.when, 'draft')
  assert.equal(request.body.group, 'launch')
  assert.equal(request.body.posts[0].channel, 'x')
})

test('posts create preserves repeated body flags for provider threads', async () => {
  let body
  await withApiKey(async () => {
    const exitCode = await run(
      [
        'posts',
        'create',
        '--workspace',
        'ws_1',
        '--destination',
        'dst_mastodon',
        '--body',
        'Opening',
        '--body',
        'Reply',
        '--yes',
        '--json',
      ],
      {
        stdin: process.stdin,
        stdout: output().stream,
        stderr: output().stream,
      },
      {
        fetchImpl: async (_url, init) => {
          body = JSON.parse(init.body)
          return new Response(
            JSON.stringify({ object: 'post_set', posts: [] }),
            {
              status: 201,
              headers: { 'content-type': 'application/json' },
            }
          )
        },
      }
    )
    assert.equal(exitCode, 0)
  })
  assert.deepEqual(body.posts[0].body, ['Opening', 'Reply'])
})

test('posts create queue uses the Workspace timezone', async () => {
  let body
  await withApiKey(async () => {
    const exitCode = await run(
      [
        'posts',
        'create',
        '--workspace',
        'ws_1',
        '--destination',
        'dst_1',
        '--when',
        'queue',
        '--body',
        'Queue me',
        '--yes',
        '--json',
      ],
      {
        stdin: process.stdin,
        stdout: output().stream,
        stderr: output().stream,
      },
      {
        fetchImpl: async (_url, init) => {
          body = JSON.parse(init.body)
          return new Response(
            JSON.stringify({ object: 'post_set', posts: [] }),
            {
              status: 201,
              headers: { 'content-type': 'application/json' },
            }
          )
        },
      }
    )
    assert.equal(exitCode, 0)
  })
  assert.equal(body.when, 'queue')
  assert.equal(body.confirmed, true)
  assert.ok(!Object.hasOwn(body, 'time_zone'))
})

test('posts create assigns media to a specific thread item', async () => {
  let body
  await withApiKey(async () => {
    const exitCode = await run(
      [
        'posts',
        'create',
        '--workspace',
        'ws_1',
        '--destination',
        'dst_threads',
        '--body',
        'Opening',
        '--body',
        'Reply',
        '--media-item',
        '1:ast_reply',
        '--yes',
        '--json',
      ],
      {
        stdin: process.stdin,
        stdout: output().stream,
        stderr: output().stream,
      },
      {
        fetchImpl: async (_url, init) => {
          body = JSON.parse(init.body)
          return new Response(
            JSON.stringify({ object: 'post_set', posts: [] }),
            {
              status: 201,
              headers: { 'content-type': 'application/json' },
            }
          )
        },
      }
    )
    assert.equal(exitCode, 0)
  })
  assert.deepEqual(body.posts[0].media_items, [
    { asset_id: 'ast_reply', item_index: 1 },
  ])
  assert.equal('media' in body.posts[0], false)
})

test('posts publish composes a same-Post publication request', async () => {
  let body
  await withApiKey(async () => {
    const exitCode = await run(
      [
        'posts',
        'publish',
        '--workspace',
        'ws_1',
        '--post',
        'post_1',
        '--post-version',
        '3',
        '--destination',
        'dst_1',
        '--yes',
        '--json',
      ],
      {
        stdin: process.stdin,
        stdout: output().stream,
        stderr: output().stream,
      },
      {
        fetchImpl: async (_url, init) => {
          body = JSON.parse(init.body)
          return new Response(JSON.stringify({ posts: [] }), {
            headers: { 'content-type': 'application/json' },
          })
        },
      }
    )
    assert.equal(exitCode, 0)
  })
  assert.deepEqual(body, {
    confirmed: true,
    when: 'now',
    time_zone: 'UTC',
    posts: [{ id: 'post_1', version: 3, destination_id: 'dst_1' }],
  })
})

test('posts move-in-queue sends an atomic compare-and-swap request', async () => {
  let request
  await withApiKey(async () => {
    const exitCode = await run(
      [
        'posts',
        'move-in-queue',
        '--workspace',
        'ws_1',
        '--post',
        'post_1',
        '--expected-scheduled-at',
        '2026-08-20T08:00:00.000Z',
        '--local-date',
        '2026-08-22',
        '--yes',
        '--json',
      ],
      {
        stdin: process.stdin,
        stdout: output().stream,
        stderr: output().stream,
      },
      {
        fetchImpl: async (url, init) => {
          request = { url: String(url), body: JSON.parse(init.body) }
          return new Response(JSON.stringify({ posts: [] }), {
            headers: { 'content-type': 'application/json' },
          })
        },
      }
    )
    assert.equal(exitCode, 0)
  })
  assert.match(request.url, /\/posts\/move-in-queue$/)
  assert.deepEqual(request.body, {
    confirmed: true,
    local_date: '2026-08-22',
    posts: [
      {
        id: 'post_1',
        expected_scheduled_at: '2026-08-20T08:00:00.000Z',
      },
    ],
  })
})

test('destinations update accepts queue policy JSON', async () => {
  const requests = []
  const queuePolicy = {
    enabled_weekdays: ['monday'],
    windows: [
      {
        weekdays: ['monday'],
        start_time: '08:00',
        end_time: '10:00',
      },
    ],
  }
  await withApiKey(async () => {
    const exitCode = await run(
      [
        'destinations',
        'update',
        'dst_1',
        '--workspace',
        'ws_1',
        '--queue-policy',
        JSON.stringify(queuePolicy),
        '--json',
      ],
      {
        stdin: process.stdin,
        stdout: output().stream,
        stderr: output().stream,
      },
      {
        fetchImpl: async (url, init) => {
          requests.push({ url: String(url), init })
          if (init.method === 'GET')
            return new Response(JSON.stringify({ id: 'dst_1' }), {
              headers: {
                'content-type': 'application/json',
                etag: '"destination:dst_1:1"',
              },
            })
          return new Response(JSON.stringify({ id: 'dst_1' }), {
            headers: { 'content-type': 'application/json' },
          })
        },
      }
    )
    assert.equal(exitCode, 0)
  })
  assert.equal(requests[1].init.method, 'PATCH')
  assert.deepEqual(JSON.parse(requests[1].init.body), {
    queue_policy: queuePolicy,
  })
})

test('--dry-run explains that validation-only publication was removed', async () => {
  let calls = 0
  await withApiKey(async () => {
    const exitCode = await run(
      [
        'posts',
        'create',
        '--workspace',
        'ws_1',
        '--dry-run',
        '--json',
      ],
      { stdin: process.stdin, stdout: output().stream, stderr: output().stream },
      {
        fetchImpl: async () => {
          calls += 1
          return new Response()
        },
      }
    )
    assert.equal(exitCode, 2)
  })
  assert.equal(calls, 0)
})

test('auto-pagination preserves list metadata from the first page', async () => {
  let calls = 0
  const out = output()
  await withApiKey(async () => {
    const exitCode = await run(
      ['posts', 'list', '--workspace', 'ws_1', '--json'],
      { stdin: process.stdin, stdout: out.stream, stderr: output().stream },
      {
        fetchImpl: async () => {
          calls += 1
          return new Response(
            JSON.stringify(
              calls === 1
                ? {
                    data: [{ id: 'one' }],
                    next_cursor: 'next',
                    worker: { server_time: 'now' },
                    time_zone: 'Europe/Berlin',
                  }
                : { data: [{ id: 'two' }], next_cursor: null }
            ),
            { headers: { 'content-type': 'application/json' } }
          )
        },
      }
    )
    assert.equal(exitCode, 0)
  })
  const result = JSON.parse(out.read()).data
  assert.deepEqual(
    result.data.map((item) => item.id),
    ['one', 'two']
  )
  assert.equal(result.time_zone, 'Europe/Berlin')
  assert.equal(result.worker.server_time, 'now')
})

test('--limit bounds auto-pagination and --jsonl emits only items', async () => {
  let calls = 0
  const out = output()
  await withApiKey(async () => {
    const exitCode = await run(
      ['workspaces', 'list', '--limit', '1', '--jsonl'],
      { stdin: process.stdin, stdout: out.stream, stderr: output().stream },
      {
        fetchImpl: async () => {
          calls += 1
          return new Response(
            JSON.stringify({
              data: [{ id: 'ws_1' }],
              next_cursor: 'another-page',
            }),
            { headers: { 'content-type': 'application/json' } }
          )
        },
      }
    )
    assert.equal(exitCode, 0)
  })
  assert.equal(calls, 1)
  assert.equal(out.read(), '{"id":"ws_1"}\n')
})

test('assets upload sends checksum-pinned multipart data without the API credential', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'openpmm-cli-'))
  const filePath = join(directory, 'card.png')
  await writeFile(filePath, Buffer.from('image'))
  const requests = []
  const out = output()
  await withApiKey(async () => {
    const exitCode = await run(
      ['assets', 'upload', filePath, '--workspace', 'ws_1', '--json'],
      { stdin: process.stdin, stdout: out.stream, stderr: output().stream },
      {
        fetchImpl: async (url, init = {}) => {
          requests.push({ url: String(url), init })
          if (String(url) === 'https://storage.test/upload/1')
            return new Response(null, {
              status: 200,
              headers: { ETag: '"part-1"' },
            })
          if (String(url).endsWith('/complete'))
            return new Response(
              JSON.stringify({ id: 'ast_1', object: 'asset' }),
              {
                headers: { 'content-type': 'application/json' },
              }
            )
          return new Response(
            JSON.stringify({
              id: 'upl_1',
              object: 'asset_upload',
              asset_id: 'ast_1',
              protocol: 'multipart',
              part_size: 8 * 1024 * 1024,
              byte_size: 5,
              parts: [
                {
                  part_number: 1,
                  upload_url: 'https://storage.test/upload/1',
                  required_headers: {
                    'x-amz-checksum-crc64nvme': crc64NvmeBase64(
                      Buffer.from('image')
                    ),
                  },
                },
              ],
            }),
            { status: 201, headers: { 'content-type': 'application/json' } }
          )
        },
      }
    )
    assert.equal(exitCode, 0)
  })
  assert.equal(requests.length, 3)
  assert.equal(requests[1].init.headers.Authorization, undefined)
  assert.equal(
    requests[1].init.headers['x-amz-checksum-crc64nvme'],
    crc64NvmeBase64(Buffer.from('image'))
  )
  assert.deepEqual(JSON.parse(requests[0].init.body).parts, [
    {
      part_number: 1,
      checksum_crc64nvme: crc64NvmeBase64(Buffer.from('image')),
    },
  ])
  assert.deepEqual(JSON.parse(requests[2].init.body), {
    byte_size: 5,
    checksum_crc64nvme: crc64NvmeBase64(Buffer.from('image')),
    parts: [
      {
        part_number: 1,
        etag: '"part-1"',
        checksum_crc64nvme: crc64NvmeBase64(Buffer.from('image')),
      },
    ],
  })
  assert.equal(JSON.parse(out.read()).data.id, 'ast_1')
})

test('assets download writes a signed response without overwriting files', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'openpmm-cli-'))
  const outputPath = join(directory, 'asset.bin')
  await withApiKey(async () => {
    const exitCode = await run(
      [
        'assets',
        'download',
        'ast_1',
        '--workspace',
        'ws_1',
        '--output',
        outputPath,
      ],
      {
        stdin: process.stdin,
        stdout: output().stream,
        stderr: output().stream,
      },
      {
        fetchImpl: async (url) =>
          String(url) === 'https://storage.test/download'
            ? new Response(Buffer.from('asset bytes'))
            : new Response(
                JSON.stringify({
                  download_url: 'https://storage.test/download',
                }),
                { headers: { 'content-type': 'application/json' } }
              ),
      }
    )
    assert.equal(exitCode, 0)
  })
  assert.equal((await readFile(outputPath)).toString(), 'asset bytes')
})
