import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

const PACKAGE_ROOT = new URL('../', import.meta.url)

test('the distributed package has no server or private-route dependency', async () => {
  const packageJson = JSON.parse(
    await readFile(new URL('package.json', PACKAGE_ROOT), 'utf8')
  )
  assert.equal(packageJson.dependencies, undefined)

  for (const file of [
    'src/openpmm.js',
    'src/operations.js',
    'src/transport.js',
  ]) {
    const source = await readFile(new URL(file, PACKAGE_ROOT), 'utf8')
    assert.doesNotMatch(source, /from ['"]@\//)
    assert.doesNotMatch(source, /drizzle|postgres|supabase|safe-runner/)
    if (file !== 'src/transport.js') assert.doesNotMatch(source, /['"]\/api\//)
    assert.doesNotMatch(source, /lib\/distribution|lib\/db|system\/send/)
  }
})

test('every documented exit class is stable', async () => {
  const { PublicApiTransport } = await import('../src/transport.js')
  const cases = [
    [401, 3],
    [403, 4],
    [404, 5],
    [409, 6],
    [422, 7],
  ]
  for (const [status, exitCode] of cases) {
    const transport = new PublicApiTransport({
      apiKey: 'test-key',
      baseUrl: 'https://example.test',
      fetchImpl: async () =>
        new Response(JSON.stringify({ detail: `HTTP ${status}` }), {
          status,
          headers: { 'content-type': 'application/problem+json' },
        }),
    })
    await assert.rejects(
      transport.request({ method: 'GET', path: '/me' }),
      (error) => error.exitCode === exitCode
    )
  }
})

test('a publishing safety response exits without waiting and keeps its fields', async () => {
  const { PublicApiTransport } = await import('../src/transport.js')
  let calls = 0
  const transport = new PublicApiTransport({
    apiKey: 'test-key',
    baseUrl: 'https://example.test',
    fetchImpl: async () => {
      calls += 1
      return new Response(
        JSON.stringify({
          detail: 'Publishing is temporarily limited.',
          code: 'publishing_admission_limited',
          reason: 'velocity',
          retry_at: '2026-08-13T12:05:00.000Z',
          retryable: true,
        }),
        {
          status: 429,
          headers: {
            'content-type': 'application/problem+json',
            'retry-after': '300',
          },
        }
      )
    },
  })

  await assert.rejects(
    transport.request({
      method: 'POST',
      path: '/workspaces/ws_1/posts',
      headers: { 'Idempotency-Key': 'idem_1' },
      body: {},
    }),
    (error) =>
      error.exitCode === 8 &&
      error.reason === 'velocity' &&
      error.retryAt === '2026-08-13T12:05:00.000Z'
  )
  assert.equal(calls, 1)
})
