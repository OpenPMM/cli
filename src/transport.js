import { randomUUID } from 'node:crypto'

export class CliError extends Error {
  constructor(message, options = {}) {
    super(message)
    this.code = options.code ?? 'cli_error'
    this.status = options.status ?? 0
    this.requestId = options.requestId ?? null
    this.retryable = options.retryable ?? false
    this.reason = options.reason ?? null
    this.retryAt = options.retryAt ?? null
    this.details = options.details ?? []
    this.exitCode = options.exitCode ?? exitCodeFor(this.status, this.code)
  }
}

export function normalizeApiBaseUrl(value) {
  let url
  try {
    url = new URL(value)
  } catch {
    throw new CliError(`Invalid API base URL: ${value}`, { exitCode: 2 })
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password
  )
    throw new CliError(
      'The API base URL must be an HTTP(S) origin without credentials.',
      { exitCode: 2 }
    )
  url.search = ''
  url.hash = ''
  const pathname = url.pathname.replace(/\/+$/, '')
  url.pathname = pathname.endsWith('/v1') ? pathname : `${pathname}/v1`
  if (url.pathname.includes('/api/'))
    throw new CliError('The CLI can only use the public /v1 API.', {
      exitCode: 2,
    })
  return url.toString().replace(/\/$/, '')
}

export class PublicApiTransport {
  constructor({
    apiKey,
    baseUrl,
    fetchImpl = fetch,
    stderr = process.stderr,
    userAgent = '@openpmm/cli/unknown',
  }) {
    if (!apiKey)
      throw new CliError(
        'No API key is configured. Set OPENPMM_API_KEY or run `openpmm auth login --with-token`.',
        { exitCode: 3 }
      )
    this.apiKey = apiKey
    this.baseUrl = normalizeApiBaseUrl(baseUrl)
    this.fetchImpl = fetchImpl
    this.stderr = stderr
    this.userAgent = userAgent
  }

  async request(input) {
    if (!input.path.startsWith('/') || input.path.startsWith('/api/'))
      throw new CliError('The CLI can only call public /v1 paths.', {
        exitCode: 2,
      })
    const url = new URL(`${this.baseUrl}${input.path}`)
    for (const [key, value] of Object.entries(input.query ?? {}))
      if (value !== undefined && value !== null)
        url.searchParams.set(key, String(value))
    const headers = {
      Authorization: `Bearer ${this.apiKey}`,
      Accept: 'application/json',
      'OpenPMM-Request-Id': `cli_${randomUUID()}`,
      'User-Agent': this.userAgent,
      ...input.headers,
    }
    if (input.body !== undefined) headers['Content-Type'] = 'application/json'
    const safeToRetry =
      input.method === 'GET' || Boolean(headers['Idempotency-Key'])
    let lastError
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const response = await this.fetchImpl(url, {
          method: input.method,
          headers,
          ...(input.body === undefined
            ? {}
            : { body: JSON.stringify(input.body) }),
          signal: AbortSignal.timeout(30_000),
        })
        const requestId = response.headers.get('openpmm-request-id')
        const payload = await response.json().catch(() => null)
        if (response.ok)
          return {
            data: payload,
            headers: response.headers,
            requestId,
            status: response.status,
          }
        const retryable = response.status >= 500
        if (retryable && safeToRetry && attempt < 2) {
          const retryAfter = Number(response.headers.get('retry-after') ?? 0)
          await delay(
            Math.max(retryAfter * 1000, 250 * 2 ** attempt) +
              Math.floor(Math.random() * 100)
          )
          continue
        }
        throw problemError(payload, response.status, requestId)
      } catch (error) {
        if (error instanceof CliError) throw error
        lastError = error
        if (!safeToRetry || attempt === 2) break
        await delay(250 * 2 ** attempt + Math.floor(Math.random() * 100))
      }
    }
    throw new CliError(
      input.method === 'GET'
        ? `The API request did not complete. Check the API origin and try again.`
        : `The mutation outcome is unknown. Retry with the same idempotency key or inspect the resource before continuing.`,
      {
        code: 'ambiguous_outcome',
        retryable: false,
        exitCode: input.method === 'GET' ? 8 : 9,
        details: lastError ? [{ message: lastError.message }] : [],
      }
    )
  }
}

function problemError(payload, status, requestId) {
  return new CliError(payload?.detail ?? `The API returned HTTP ${status}.`, {
    code: payload?.code ?? 'remote_error',
    status,
    requestId: payload?.request_id ?? requestId,
    retryable: Boolean(payload?.retryable),
    reason: payload?.reason ?? null,
    retryAt: payload?.retry_at ?? null,
    details: payload?.errors ?? [],
  })
}

function exitCodeFor(status, code) {
  if (status === 401) return 3
  if (status === 403) return 4
  if (status === 404) return 5
  if ([409, 412, 428].includes(status)) return 6
  if (status === 400 || status === 422) return 7
  if (status === 429 || status >= 500) return 8
  if (code === 'ambiguous_outcome') return 9
  return 1
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}
