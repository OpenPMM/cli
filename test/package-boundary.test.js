import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:http'
import { test } from 'node:test'
import { promisify } from 'node:util'

const PACKAGE_ROOT = new URL('../', import.meta.url)
const execFileAsync = promisify(execFile)

test('the distributed package has no server or private-route dependency', async () => {
  const packageJson = JSON.parse(
    await readFile(new URL('package.json', PACKAGE_ROOT), 'utf8')
  )
  assert.equal(packageJson.dependencies, undefined)

  for (const file of [
    'src/bin.js',
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

test('the packed CLI runs through its installed executable', async () => {
  const packageJson = JSON.parse(
    await readFile(new URL('package.json', PACKAGE_ROOT), 'utf8')
  )
  const directory = await mkdtemp(join(tmpdir(), 'openpmm-package-'))
  const environment = {
    ...process.env,
    npm_config_audit: 'false',
    npm_config_cache: join(directory, 'cache'),
    npm_config_fund: 'false',
    npm_config_update_notifier: 'false',
  }

  try {
    const packed = await execFileAsync(
      process.platform === 'win32' ? 'npm.cmd' : 'npm',
      ['pack', '--pack-destination', directory],
      { cwd: PACKAGE_ROOT, env: environment }
    )
    const tarball = join(directory, packed.stdout.trim())
    const prefix = join(directory, 'global')
    await execFileAsync(
      process.platform === 'win32' ? 'npm.cmd' : 'npm',
      ['install', '--global', '--prefix', prefix, tarball],
      { env: environment }
    )
    const executable =
      process.platform === 'win32'
        ? join(prefix, 'openpmm.cmd')
        : join(prefix, 'bin', 'openpmm')
    const version = await execFileAsync(executable, ['--version'])

    assert.equal(version.stdout, `${packageJson.version}\n`)
    assert.equal(version.stderr, '')

    const server = createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(
        JSON.stringify({
          id: 'dest_x',
          object: 'destination',
          channel: 'x',
          display_name: '@openpmm',
          status: 'ready',
          is_default: true,
          capabilities: {
            max_body_items: 25,
            body_text_limit: {
              maximum: 25_000,
              unit: 'weighted_characters',
            },
          },
        })
      )
    })
    await new Promise((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    try {
      const address = server.address()
      if (!address || typeof address === 'string')
        throw new Error('The package-boundary server did not expose a port.')
      const destination = await execFileAsync(
        executable,
        [
          'destinations',
          'show',
          'dest_x',
          '--workspace',
          'ws_1',
          '--json',
          '--api-base-url',
          `http://127.0.0.1:${address.port}/v1`,
        ],
        { env: { ...environment, OPENPMM_API_KEY: 'test-key' } }
      )
      const parsed = JSON.parse(destination.stdout)
      assert.deepEqual(parsed.data.capabilities.body_text_limit, {
        maximum: 25_000,
        unit: 'weighted_characters',
      })
      assert.equal(destination.stderr, '')
    } finally {
      await new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      )
    }
  } finally {
    await rm(directory, { recursive: true, force: true })
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

test('an unknown idempotency outcome uses the ambiguous exit class', async () => {
  const { PublicApiTransport } = await import('../src/transport.js')
  const transport = new PublicApiTransport({
    apiKey: 'test-key',
    baseUrl: 'https://example.test',
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          code: 'public_idempotency_outcome_unknown',
          detail: 'Inspect the affected resource before you create new work.',
        }),
        {
          status: 409,
          headers: { 'content-type': 'application/problem+json' },
        }
      ),
  })

  await assert.rejects(
    transport.request({ method: 'POST', path: '/workspaces/ws_1/posts' }),
    (error) => error.exitCode === 9
  )
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
