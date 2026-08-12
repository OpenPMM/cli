import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { OPERATIONS } from '../src/operations.js'
import { run } from '../src/openpmm.js'
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
      /^[a-z]+(?:-[a-z]+)*(?: [a-z]+(?:-[a-z]+)*)+$/
    )
    assert.ok(operation.path.startsWith('/'))
    assert.ok(!operation.path.startsWith('/api/'))
  }
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

test('video validation sends destination IDs through the public API', async () => {
  let seen
  const stdout = output()
  await withApiKey(async () => {
    const exitCode = await run(
      [
        'assets',
        'validate-video',
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
              object: 'video_validation',
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
    'https://api.openpmm.com/v1/workspaces/ws_1/assets/asset_1/video-validations'
  )
  assert.deepEqual(seen.body, { destination_ids: ['dst_1', 'dst_2'] })
  assert.match(stdout.read(), /"video_validation"/)
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

test('updating a draft Post is reversible and does not require --yes', async () => {
  const methods = []
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
          return init.method === 'GET'
              ? new Response(JSON.stringify({ object: 'post' }), {
                headers: {
                  'content-type': 'application/json',
                  etag: '"post:post_1:1"',
                },
              })
            : new Response(JSON.stringify({ object: 'post' }), {
                headers: { 'content-type': 'application/json' },
              })
        },
      }
    )
    assert.equal(exitCode, 0)
  })
  assert.deepEqual(methods, ['GET', 'PATCH'])
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

test('assets upload streams bytes to storage without the API credential', async () => {
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
          if (String(url) === 'https://storage.test/upload') {
            for await (const chunk of init.body) {
              // Consume the file stream like the storage service does.
              void chunk
            }
            return new Response(null, { status: 200 })
          }
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
              upload_url: 'https://storage.test/upload',
              required_headers: { 'Content-Type': 'image/png' },
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
  assert.equal(requests[1].init.headers['Content-Type'], 'image/png')
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
