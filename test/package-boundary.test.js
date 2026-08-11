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
