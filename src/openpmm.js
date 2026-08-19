import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import {
  chmod,
  mkdir,
  open,
  readFile,
  rename,
  stat,
  writeFile,
} from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, extname, join } from 'node:path'
import { stdin, stdout, stderr } from 'node:process'
import { Crc64Nvme, crc64NvmeBase64 } from './crc64.js'
import { OPERATIONS, OPERATION_BY_COMMAND } from './operations.js'
import {
  CliError,
  PublicApiTransport,
  normalizeApiBaseUrl,
} from './transport.js'

export const VERSION = '0.1.0'
const DEFAULT_API_BASE_URL = 'https://api.openpmm.com/v1'
const ASSET_UPLOAD_PART_SIZE = 8 * 1024 * 1024
const CREDENTIAL_PATH = join(
  homedir(),
  '.config',
  'openpmm',
  'credentials.json'
)

export async function run(
  argv = process.argv.slice(2),
  io = { stdin, stdout, stderr },
  dependencies = {}
) {
  let recoveryKey = null
  try {
    const parsed = parseArguments(argv)
    if (parsed.flags.version) return write(io.stdout, `${VERSION}\n`)
    if (parsed.words.length === 0) return write(io.stdout, helpFor(''))
    if (parsed.flags.help) {
      const analytics = matchAnalyticsCommand(parsed, false)
      return write(
        io.stdout,
        helpFor(analytics?.operation.command ?? parsed.words.join(' '))
      )
    }

    const special = parsed.words.slice(0, 2).join(' ')
    if (special === 'auth login') return await authLogin(parsed, io)
    if (special === 'auth logout') return await authLogout(parsed, io)
    if (special === 'webhooks verify')
      return await verifyWebhookSignature(parsed, io)

    if (parsed.flags['dry-run']) {
      throw new CliError(
        'The public API has no validation-only operation. Remove --dry-run.',
        { exitCode: 2 }
      )
    }

    const assetWorkflow = ['assets upload', 'assets download'].includes(special)
      ? special
      : null

    const match = assetWorkflow
      ? null
      : (matchAnalyticsCommand(parsed) ?? matchCommand(parsed.words))
    if (!match && !assetWorkflow)
      throw new CliError(
        `Unknown command: ${parsed.words.join(' ')}. Run \`openpmm --help\` to see commands.`,
        { exitCode: 2 }
      )
    if (parsed.flags.help)
      return write(io.stdout, helpFor(assetWorkflow ?? match.operation.command))
    if (match?.operation.confirm && !parsed.flags.yes)
      throw new CliError(
        `This command can publish, disconnect, or delete data. Review it, then rerun with --yes.`,
        { code: 'confirmation_required', exitCode: 10 }
      )
    if (
      ['createWebhookEndpoint', 'rotateWebhookEndpointSecret'].includes(
        match?.operation.id
      ) &&
      (parsed.flags.quiet || parsed.flags.jsonl)
    )
      throw new CliError(
        'Webhook secret commands require human or --json output so the one-time secret is not discarded.',
        { exitCode: 2 }
      )

    const baseUrl = normalizeApiBaseUrl(
      parsed.flags['api-base-url'] ??
        process.env.OPENPMM_API_BASE_URL ??
        DEFAULT_API_BASE_URL
    )
    const anonymous = match?.operation.authentication === 'none'
    const apiKey = anonymous
      ? null
      : process.env.OPENPMM_API_KEY ?? (await storedCredential(baseUrl))
    const transport = new PublicApiTransport({
      apiKey,
      anonymous,
      baseUrl,
      fetchImpl: dependencies.fetchImpl,
      stderr: io.stderr,
      userAgent: `@openpmm/cli/${VERSION} (${process.platform}; ${process.arch})`,
    })
    const workspace =
      parsed.flags.workspace ?? process.env.OPENPMM_WORKSPACE ?? undefined
    if (
      (assetWorkflow || match.operation.path.includes('{workspace_id}')) &&
      !workspace
    )
      throw new CliError(
        'This command requires --workspace <id> or OPENPMM_WORKSPACE.',
        { exitCode: 2 }
      )

    if (assetWorkflow === 'assets upload') {
      recoveryKey = parsed.flags['idempotency-key'] ?? randomUUID()
      parsed.flags['idempotency-key'] = recoveryKey
      return await uploadAsset(transport, workspace, parsed, io)
    }
    if (assetWorkflow === 'assets download')
      return await downloadAsset(transport, workspace, parsed, io)

    const path = fillPath(match.operation.path, workspace, match.positionals)
    let body = await requestBody(match.operation, parsed, io)
    let etag = parsed.flags.etag

    if (match.operation.id === 'createPosts' && body?.when !== 'draft') {
      if (!parsed.flags.yes)
        throw new CliError(
          'This command publishes posts. Review it, then rerun with --yes.',
          { code: 'confirmation_required', exitCode: 10 }
        )
      body.confirmed = true
    }

    if (match.operation.ifMatch && !etag) {
      const readPath = etagReadPath(match.operation, path)
      const current = await transport.request({ method: 'GET', path: readPath })
      etag = current.headers.get('etag')
      if (!etag)
        throw new CliError(
          `The API did not return an ETag for this resource. Fetch it with the matching show command and pass --etag.`,
          { exitCode: 6 }
        )
    }
    const idempotencyKey = match.operation.idempotent
      ? (parsed.flags['idempotency-key'] ?? randomUUID())
      : null
    recoveryKey = idempotencyKey
    const headers = {
      ...(etag ? { 'If-Match': etag } : {}),
      ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
    }
    const query = queryFrom(parsed.flags, match.operation)
    const result = await requestAll(transport, match.operation, {
      path,
      body,
      headers,
      query,
      autoPage: !parsed.flags.after,
      maxItems: positiveIntegerFlag(parsed.flags.limit, 'limit'),
    })
    const waited =
      parsed.flags.wait &&
      ['refreshPostAnalytics', 'refreshPostGroupAnalytics'].includes(
        match.operation.id
      )
        ? await waitForAnalytics(
            transport,
            result,
            dependencies.sleep ?? defaultSleep
          )
        : null
    const output = {
      data: waited?.data ?? result.data,
      meta: {
        request_id: result.requestId,
        idempotency_key: idempotencyKey,
        operation_id: match.operation.id,
        ...(waited ? { waited: true } : {}),
      },
    }
    renderSuccess(output, parsed.flags, io)
    return 0
  } catch (error) {
    const normalized =
      error instanceof CliError
        ? error
        : new CliError(
            error instanceof Error ? error.message : 'The command failed.'
          )
    normalized.idempotencyKey = recoveryKey
    renderError(normalized, parseArguments(argv).flags, io)
    return normalized.exitCode
  }
}

function parseArguments(argv) {
  const flags = {}
  const words = []
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '-json') {
      flags.json = true
      continue
    }
    if (!argument.startsWith('-')) {
      words.push(argument)
      continue
    }
    const raw = argument.replace(/^--?/, '')
    const [name, inline] = raw.split(/=(.*)/s, 2)
    if (
      [
        'help',
        'version',
        'json',
        'jsonl',
        'quiet',
        'yes',
        'deferred',
        'dry-run',
        'with-token',
        'no-color',
        'wait',
      ].includes(name)
    ) {
      flags[name] = inline === undefined ? true : inline !== 'false'
      continue
    }
    const value = inline ?? argv[++index]
    if (value === undefined || value.startsWith('--'))
      throw new CliError(`Flag --${name} requires a value.`, { exitCode: 2 })
    flags[name] =
      flags[name] === undefined ? value : [...asArray(flags[name]), value]
  }
  return { words, flags }
}

function threadMediaItems(value) {
  if (value === undefined) return undefined
  return asArray(value).map((entry) => {
    const match = /^(\d+):(.+)$/.exec(entry)
    if (!match)
      throw new CliError(
        '--media-item must use the format <body-index>:<asset-id>.',
        { exitCode: 2 }
      )
    return { asset_id: match[2], item_index: Number(match[1]) }
  })
}

function matchCommand(words) {
  for (let length = Math.min(words.length, 5); length > 0; length -= 1) {
    const command = words.slice(0, length).join(' ')
    const operation = OPERATION_BY_COMMAND.get(command)
    if (operation) return { operation, positionals: words.slice(length) }
  }
  return null
}

function matchAnalyticsCommand(parsed, requireSelector = true) {
  const command = parsed.words.slice(0, 2).join(' ')
  if (!['analytics show', 'analytics refresh'].includes(command)) return null
  const selectors = ['post', 'group'].filter(
    (name) => parsed.flags[name] !== undefined
  )
  if (selectors.length !== 1) {
    if (!requireSelector) return null
    throw new CliError(
      `Use exactly one of --post <id> or --group <group> with ${command}.`,
      { exitCode: 2 }
    )
  }
  const selector = selectors[0]
  const operation = OPERATION_BY_COMMAND.get(`${command} --${selector}`)
  return { operation, positionals: [parsed.flags[selector]] }
}

function fillPath(template, workspace, positionals) {
  let position = 0
  return template.replace(/\{([^}]+)\}/g, (_match, name) => {
    const value = name === 'workspace_id' ? workspace : positionals[position++]
    if (!value)
      throw new CliError(`Missing required <${name}> argument.`, {
        exitCode: 2,
      })
    return encodeURIComponent(value)
  })
}

async function requestBody(operation, parsed, io) {
  const flags = parsed.flags
  if (flags.media !== undefined && flags['media-item'] !== undefined)
    throw new CliError('Use --media or --media-item, not both.', {
      exitCode: 2,
    })
  let body = flags.file ? await readJsonInput(flags.file, io.stdin) : undefined
  if (body === undefined && operation.body) body = {}
  if (body === undefined) return undefined

  if (operation.confirm) body.confirmed = true
  set(body, 'name', flags.name)
  set(body, 'time_zone', flags['time-zone'])
  set(body, 'confirmation', flags.confirmation)
  set(body, 'email', flags.email)
  set(body, 'workspace_name', flags['workspace-name'])
  set(body, 'interval', flags.interval)
  set(body, 'message', flags.message)
  set(body, 'enabled_channels', csv(flags['enabled-channels']))
  set(body, 'headline', flags.headline)
  set(body, 'body', flags.body === undefined ? undefined : asArray(flags.body))
  set(body, 'asset_ids', csv(flags.media))
  set(body, 'asset_items', threadMediaItems(flags['media-item']))
  set(body, 'slack_channel_id', nullValue(flags['slack-channel']))
  if (operation.id === 'validateAsset') {
    set(body, 'destination_ids', csv(flags.destination))
    set(body, 'channels', csv(flags.channel))
  } else set(body, 'destination_id', flags.destination)
  set(body, 'provider', flags.provider)
  set(body, 'instance_origin', flags['instance-origin'])
  set(body, 'account_identifier', flags.account)
  set(body, 'enabled', booleanValue(flags.enabled))
  set(body, 'is_default', booleanValue(flags.default))
  set(body, 'queue_policy', jsonValue(flags['queue-policy']))
  set(body, 'options', jsonValue(flags.options))
  set(body, 'url', flags.url)
  set(body, 'event_types', csv(flags.events))
  set(body, 'destination_filter_mode', flags['destination-filter'])
  set(body, 'destination_ids', csv(flags.destinations))
  set(body, 'content_mode', flags['content-mode'])

  if (operation.id === 'createSignupIntent' && !flags.file) {
    body = {
      email: requiredFlag(flags, 'email'),
      workspace_name: requiredFlag(flags, 'workspace-name'),
    }
  }

  if (operation.id === 'createPosts') {
    if (!flags.file) {
      const publish = flags.when !== 'draft'
      const when = flags.when ?? 'now'
      body = {
        when,
        ...(when === 'queue'
          ? {}
          : { time_zone: flags['time-zone'] ?? 'UTC' }),
        ...(flags.group ? { group: flags.group } : {}),
        posts: [
          {
            ...(publish
              ? { destination_id: requiredFlag(flags, 'destination') }
              : { channel: requiredFlag(flags, 'channel') }),
            headline: flags.headline ?? null,
            body: asArray(requiredFlag(flags, 'body')),
            ...(flags['media-item'] !== undefined
              ? { media_items: threadMediaItems(flags['media-item']) }
              : { media: csv(flags.media) ?? [] }),
            options: jsonValue(flags.options) ?? null,
          },
        ],
      }
    }
  }
  if (operation.id === 'publishPosts' && !flags.file) {
    const version = Number(requiredFlag(flags, 'post-version'))
    if (!Number.isSafeInteger(version) || version < 1)
      throw new CliError('--post-version must be a positive integer.', {
        exitCode: 2,
      })
    const when = flags.at ?? 'now'
    body = {
      confirmed: true,
      when,
      ...(when === 'queue'
        ? {}
        : { time_zone: flags['time-zone'] ?? 'UTC' }),
      posts: [
        {
          id: requiredFlag(flags, 'post'),
          version,
          destination_id: requiredFlag(flags, 'destination'),
        },
      ],
    }
  }
  if (operation.id === 'movePostsInQueue' && !flags.file) {
    body = {
      confirmed: true,
      local_date: requiredFlag(flags, 'local-date'),
      posts: [
        {
          id: requiredFlag(flags, 'post'),
          expected_scheduled_at: requiredFlag(
            flags,
            'expected-scheduled-at'
          ),
        },
      ],
    }
  }
  if (operation.id === 'reschedulePost') {
    body.scheduled_at = requiredFlag(flags, 'at')
    body.time_zone = requiredFlag(flags, 'time-zone')
  }
  return body
}

function etagReadPath(operation, path) {
  if (operation.ifMatch === 'workspace') return path
  if (operation.ifMatch === 'destination') return path
  if (operation.ifMatch === 'webhook-endpoint') return path
  if (operation.ifMatch === 'post')
    return path.replace(/\/(cancel|reschedule|retry)$/, '')
  return path
}

async function requestAll(transport, operation, input) {
  let response = await transport.request({
    method: operation.method,
    path: input.path,
    body: input.body,
    headers: input.headers,
    query: input.query,
  })
  if (!operation.paginated || !input.autoPage) return response
  const firstResponse = response
  const envelope = response.data ?? {}
  const data = [...(response.data?.data ?? [])]
  let cursor = response.data?.next_cursor ?? null
  while (cursor && (!input.maxItems || data.length < input.maxItems)) {
    const remaining = input.maxItems ? input.maxItems - data.length : null
    response = await transport.request({
      method: 'GET',
      path: input.path,
      headers: input.headers,
      query: {
        ...input.query,
        after: cursor,
        ...(remaining === null
          ? {}
          : { limit: Math.min(Number(input.query.limit ?? 100), remaining) }),
      },
    })
    data.push(...(response.data?.data ?? []))
    cursor = response.data?.next_cursor ?? null
  }
  return {
    ...firstResponse,
    data: {
      ...envelope,
      data: input.maxItems ? data.slice(0, input.maxItems) : data,
      has_more: Boolean(cursor),
      next_cursor: cursor,
    },
  }
}

function defaultSleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

async function waitForAnalytics(transport, refreshResult, sleep) {
  const location = refreshResult.headers.get('location')
  if (!location) return null
  const parsed = new URL(location, 'https://api.openpmm.invalid')
  const path = parsed.pathname.replace(/^\/v1(?=\/)/, '')
  let latest = null
  for (const delay of [2_000, 5_000, 10_000]) {
    await sleep(delay)
    latest = await transport.request({ method: 'GET', path })
    const data = latest.data
    const pending = Array.isArray(data?.posts)
      ? data.posts.some((post) => ['pending', 'running'].includes(post.state))
      : ['pending', 'running'].includes(data?.state)
    if (!pending) return latest
  }
  return latest
}

async function uploadAsset(transport, workspace, parsed, io) {
  const filePath = parsed.words[2]
  if (!filePath)
    throw new CliError(
      'Usage: openpmm assets upload <path> --workspace <id>.',
      { exitCode: 2 }
    )
  const metadata = await stat(filePath).catch(() => null)
  if (!metadata?.isFile())
    throw new CliError(`Asset file not found: ${filePath}`, { exitCode: 2 })
  const fileName = basename(filePath)
  const contentType = parsed.flags['content-type'] ?? contentTypeFor(fileName)
  const kind = parsed.flags.kind ?? kindFor(fileName)
  const workflowKey = parsed.flags['idempotency-key'] ?? randomUUID()
  const checksums = await checksumAssetParts(
    filePath,
    metadata.size,
    ASSET_UPLOAD_PART_SIZE
  )
  const beginKey = `${workflowKey}:begin`
  const begun = await transport.request({
    method: 'POST',
    path: `/workspaces/${encodeURIComponent(workspace)}/asset-uploads`,
    headers: { 'Idempotency-Key': beginKey },
    body: {
      kind,
      file_name: fileName,
      content_type: contentType,
      byte_size: metadata.size,
      parts: checksums.parts.map((part) => ({
        part_number: part.partNumber,
        checksum_crc64nvme: part.checksumCrc64Nvme,
      })),
    },
  })
  if (!parsed.flags.quiet && !parsed.flags.json)
    write(io.stderr, `Uploading ${fileName} (${metadata.size} bytes)...\n`)
  validateMultipartInstructions(begun.data, metadata.size, checksums.parts)
  const completedParts = []
  const handle = await open(filePath, 'r')
  try {
    for (const instruction of begun.data.parts) {
      const checksum = checksums.parts[instruction.part_number - 1]
      const offset = (instruction.part_number - 1) * ASSET_UPLOAD_PART_SIZE
      const bytes = await readFilePart(
        handle,
        offset,
        Math.min(ASSET_UPLOAD_PART_SIZE, metadata.size - offset)
      )
      const response = await uploadAssetPart(
        transport.fetchImpl,
        instruction,
        bytes,
        begun.data.id
      )
      const etag = response.headers.get('etag')
      if (!etag)
        throw new CliError('The storage upload did not return a part ETag.', {
          code: 'asset_upload_failed',
          exitCode: 8,
        })
      completedParts.push({
        part_number: instruction.part_number,
        etag,
        checksum_crc64nvme: checksum.checksumCrc64Nvme,
      })
    }
  } finally {
    await handle.close()
  }
  const completeKey = `${workflowKey}:complete`
  const completed = await transport.request({
    method: 'POST',
    path: `/workspaces/${encodeURIComponent(workspace)}/asset-uploads/${encodeURIComponent(begun.data.id)}/complete`,
    headers: { 'Idempotency-Key': completeKey },
    body: {
      byte_size: metadata.size,
      checksum_crc64nvme: checksums.full,
      parts: completedParts,
    },
  })
  renderSuccess(
    {
      data: completed.data,
      meta: {
        request_id: completed.requestId,
        idempotency_key: workflowKey,
        operation_id: 'completeAssetUpload',
        upload_id: begun.data.id,
      },
    },
    parsed.flags,
    io
  )
  return 0
}

async function checksumAssetParts(filePath, byteSize, partSize) {
  const handle = await open(filePath, 'r')
  const full = new Crc64Nvme()
  const parts = []
  try {
    for (let offset = 0, partNumber = 1; offset < byteSize; partNumber += 1) {
      const bytes = await readFilePart(
        handle,
        offset,
        Math.min(partSize, byteSize - offset)
      )
      full.update(bytes)
      parts.push({
        partNumber,
        checksumCrc64Nvme: crc64NvmeBase64(bytes),
      })
      offset += bytes.byteLength
    }
  } finally {
    await handle.close()
  }
  return { full: full.digestBase64(), parts }
}

async function readFilePart(handle, offset, length) {
  const bytes = Buffer.allocUnsafe(length)
  let read = 0
  while (read < length) {
    const result = await handle.read(bytes, read, length - read, offset + read)
    if (result.bytesRead === 0)
      throw new CliError('The asset file changed while it was read.', {
        code: 'asset_upload_failed',
        exitCode: 8,
      })
    read += result.bytesRead
  }
  return bytes
}

function validateMultipartInstructions(upload, byteSize, checksums) {
  if (
    upload.protocol !== 'multipart' ||
    upload.part_size !== ASSET_UPLOAD_PART_SIZE ||
    upload.byte_size !== byteSize ||
    !Array.isArray(upload.parts) ||
    upload.parts.length !== checksums.length ||
    upload.parts.some(
      (part, index) =>
        part.part_number !== index + 1 ||
        typeof part.upload_url !== 'string' ||
        !part.required_headers ||
        typeof part.required_headers !== 'object' ||
        part.required_headers['x-amz-checksum-crc64nvme'] !==
          checksums[index].checksumCrc64Nvme
    )
  )
    throw new CliError('The API returned invalid multipart instructions.', {
      code: 'asset_upload_failed',
      exitCode: 8,
    })
}

async function uploadAssetPart(fetchImpl, instruction, bytes, uploadId) {
  let response
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      response = await fetchImpl(instruction.upload_url, {
        method: 'PUT',
        headers: instruction.required_headers,
        body: bytes,
        signal: AbortSignal.timeout(30 * 60_000),
      })
      if (response.ok) return response
      if (response.status < 500 && response.status !== 429) break
    } catch (error) {
      if (attempt === 4) throw error
    }
    await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** attempt))
  }
  throw new CliError(
    `The storage upload failed with HTTP ${response?.status ?? 0}. The upload ID is ${uploadId}; inspect it with ‘openpmm asset-uploads show ${uploadId}’.`,
    {
      code: 'asset_upload_failed',
      status: response?.status ?? 0,
      exitCode: 8,
    }
  )
}

async function downloadAsset(transport, workspace, parsed, io) {
  const assetId = parsed.words[2]
  if (!assetId)
    throw new CliError(
      'Usage: openpmm assets download <asset_id> --output <path|-> --workspace <id>.',
      { exitCode: 2 }
    )
  const outputPath = requiredFlag(parsed.flags, 'output')
  const asset = await transport.request({
    method: 'GET',
    path: `/workspaces/${encodeURIComponent(workspace)}/assets/${encodeURIComponent(assetId)}`,
    query: { include: 'download' },
  })
  const response = await transport.fetchImpl(asset.data.download_url, {
    signal: AbortSignal.timeout(30 * 60_000),
  })
  if (!response.ok)
    throw new CliError(
      `The asset download failed with HTTP ${response.status}. Request a new download URL and try again.`,
      {
        code: 'asset_download_failed',
        status: response.status,
        exitCode: 8,
      }
    )
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (outputPath === '-') io.stdout.write(bytes)
  else
    await writeFile(outputPath, bytes, { flag: 'wx' }).catch((error) => {
      throw new CliError(`Cannot write ${outputPath}: ${error.message}`, {
        exitCode: 2,
      })
    })
  if (outputPath !== '-' && !parsed.flags.quiet)
    write(io.stderr, `Downloaded ${assetId} to ${outputPath}.\n`)
  return 0
}

function kindFor(fileName) {
  return ['.mp4', '.mov', '.webm'].includes(extname(fileName).toLowerCase())
    ? 'reel'
    : 'card'
}

function contentTypeFor(fileName) {
  const extension = extname(fileName).toLowerCase()
  const contentTypes = {
    '.gif': 'image/gif',
    '.jpeg': 'image/jpeg',
    '.jpg': 'image/jpeg',
    '.mov': 'video/quicktime',
    '.mp4': 'video/mp4',
    '.png': 'image/png',
    '.webm': 'video/webm',
    '.webp': 'image/webp',
  }
  const value = contentTypes[extension]
  if (!value)
    throw new CliError(
      `Cannot infer a content type for ${fileName}. Pass --content-type.`,
      { exitCode: 2 }
    )
  return value
}

function queryFrom(flags, operation) {
  if (operation.id === 'getAnalyticsReport') {
    requiredFlag(flags, 'from')
    requiredFlag(flags, 'until')
    if (flags.bucket !== undefined && !['day', 'week'].includes(flags.bucket))
      throw new CliError('--bucket must be day or week.', { exitCode: 2 })
  }
  const pageSize = positiveIntegerFlag(
    flags['page-size'] ?? flags.limit,
    flags['page-size'] === undefined ? 'limit' : 'page-size'
  )
  const names = [
    ...(operation.paginated ? ['after'] : []),
    ...(operation.id === 'listPosts' ? ['view', 'channel', 'group'] : []),
    ...(operation.id === 'getAsset' ? ['include'] : []),
    ...(operation.id === 'getAnalyticsReport'
      ? ['from', 'until', 'channel', 'after', 'limit']
      : []),
  ]
  return {
    ...(operation.id === 'getAnalyticsReport'
      ? { bucket: flags.bucket ?? 'day' }
      : {}),
    ...(operation.paginated && pageSize ? { limit: pageSize } : {}),
    ...Object.fromEntries(
      names.flatMap((name) =>
        flags[name] === undefined ? [] : [[name, flags[name]]]
      )
    ),
  }
}

async function readJsonInput(path, input) {
  const text =
    path === '-' ? await readStream(input) : await readFile(path, 'utf8')
  try {
    return JSON.parse(text)
  } catch {
    throw new CliError(
      `Input from ${path === '-' ? 'stdin' : path} is not valid JSON.`,
      { exitCode: 2 }
    )
  }
}

async function authLogin(parsed, io) {
  if (!parsed.flags['with-token'])
    throw new CliError(
      'Use `openpmm auth login --with-token` and pipe the API key through stdin.',
      { exitCode: 2 }
    )
  const token = (await readStream(io.stdin)).trim()
  if (!token)
    throw new CliError('stdin did not contain an API key.', { exitCode: 2 })
  const baseUrl = normalizeApiBaseUrl(
    parsed.flags['api-base-url'] ??
      process.env.OPENPMM_API_BASE_URL ??
      DEFAULT_API_BASE_URL
  )
  const store = await readCredentialStore()
  store.credentials[baseUrl] = token
  await writeCredentialStore(store)
  write(io.stdout, `Saved an API key for ${baseUrl}.\n`)
  return 0
}

async function authLogout(parsed, io) {
  const baseUrl = normalizeApiBaseUrl(
    parsed.flags['api-base-url'] ??
      process.env.OPENPMM_API_BASE_URL ??
      DEFAULT_API_BASE_URL
  )
  const store = await readCredentialStore()
  delete store.credentials[baseUrl]
  await writeCredentialStore(store)
  write(io.stdout, `Removed the saved API key for ${baseUrl}.\n`)
  return 0
}

async function verifyWebhookSignature(parsed, io) {
  if (parsed.words.length !== 2)
    throw new CliError(
      'Usage: openpmm webhooks verify --signature <header> --file <payload|->.',
      { exitCode: 2 }
    )
  const signature = requiredFlag(parsed.flags, 'signature')
  const payloadPath = requiredFlag(parsed.flags, 'file')
  const secret = parsed.flags['secret-file']
    ? (await readFile(parsed.flags['secret-file'], 'utf8')).trim()
    : process.env.OPENPMM_WEBHOOK_SECRET?.trim()
  if (!secret)
    throw new CliError(
      'Set OPENPMM_WEBHOOK_SECRET or pass --secret-file <path>.',
      { exitCode: 2 }
    )
  const payload =
    payloadPath === '-'
      ? await readStreamBuffer(io.stdin)
      : await readFile(payloadPath)
  const tolerance = positiveIntegerFlag(
    parsed.flags['tolerance-seconds'] ?? '300',
    'tolerance-seconds'
  )
  const parts = String(signature)
    .split(',')
    .map((part) => part.trim().split(/=(.*)/s, 2))
  const timestamps = parts
    .filter(([name]) => name === 't')
    .map(([, value]) => value)
  const signatures = parts
    .filter(([name]) => name === 'v1')
    .map(([, value]) => value)
  if (
    timestamps.length !== 1 ||
    signatures.length === 0 ||
    !/^\d+$/.test(timestamps[0])
  )
    throw new CliError('The webhook signature header is malformed.', {
      code: 'webhook_signature_invalid',
      exitCode: 7,
    })
  const timestamp = Number(timestamps[0])
  const now = Math.floor(Date.now() / 1000)
  if (!Number.isSafeInteger(timestamp) || Math.abs(now - timestamp) > tolerance)
    throw new CliError(
      'The webhook signature timestamp is outside tolerance.',
      {
        code: 'webhook_signature_invalid',
        exitCode: 7,
      }
    )
  const expected = createHmac('sha256', secret)
    .update(`${timestamp}.`)
    .update(payload)
    .digest()
  const valid = signatures.reduce((matched, candidate) => {
    const actual = /^[0-9a-f]{64}$/i.test(candidate)
      ? Buffer.from(candidate, 'hex')
      : Buffer.alloc(0)
    return (
      (actual.length === expected.length &&
        timingSafeEqual(actual, expected)) ||
      matched
    )
  }, false)
  if (!valid)
    throw new CliError('The webhook signature does not match the payload.', {
      code: 'webhook_signature_invalid',
      exitCode: 7,
    })
  if (parsed.flags.json)
    return write(io.stdout, `${JSON.stringify({ valid: true, timestamp })}\n`)
  if (!parsed.flags.quiet)
    write(io.stdout, `Webhook signature is valid (${timestamp}).\n`)
  return 0
}

async function storedCredential(baseUrl) {
  return (await readCredentialStore()).credentials[baseUrl] ?? null
}

async function readCredentialStore() {
  try {
    const metadata = await stat(CREDENTIAL_PATH)
    if (process.platform !== 'win32' && (metadata.mode & 0o077) !== 0)
      throw new CliError(
        `Refusing to read ${CREDENTIAL_PATH} because it is accessible by other users. Run \`chmod 600 ${CREDENTIAL_PATH}\` or use OPENPMM_API_KEY.`,
        { exitCode: 3 }
      )
    const parsed = JSON.parse(await readFile(CREDENTIAL_PATH, 'utf8'))
    return parsed?.version === 1 && parsed.credentials
      ? parsed
      : { version: 1, credentials: {} }
  } catch (error) {
    if (error instanceof CliError) throw error
    return { version: 1, credentials: {} }
  }
}

async function writeCredentialStore(store) {
  await mkdir(dirname(CREDENTIAL_PATH), { recursive: true, mode: 0o700 })
  if (process.platform !== 'win32') await chmod(dirname(CREDENTIAL_PATH), 0o700)
  const temporary = `${CREDENTIAL_PATH}.${process.pid}.tmp`
  await writeFile(temporary, `${JSON.stringify(store)}\n`, { mode: 0o600 })
  await chmod(temporary, 0o600)
  await rename(temporary, CREDENTIAL_PATH)
}

function renderSuccess(output, flags, io) {
  if (flags.quiet) {
    const value =
      output.data?.id ??
      output.data?.signup_url ??
      output.data?.draft_id ??
      output.data?.group ??
      output.data?.data
        ?.map((item) => item.id)
        .filter(Boolean)
        .join('\n') ??
      ''
    return write(io.stdout, `${value}\n`)
  }
  if (flags.jsonl) {
    const values = output.data?.data
    if (!Array.isArray(values))
      throw new CliError('--jsonl is available only for list commands.', {
        exitCode: 2,
      })
    for (const value of values) write(io.stdout, `${JSON.stringify(value)}\n`)
    return
  }
  if (flags.json) return write(io.stdout, `${JSON.stringify(output)}\n`)
  if (Array.isArray(output.data?.data)) {
    if (output.data.data.length === 0) return write(io.stdout, 'No results.\n')
    for (const value of output.data.data)
      write(
        io.stdout,
        `${value.id ?? value.name ?? value.object ?? 'result'}${value.name ? `\t${value.name}` : ''}\n`
      )
    return
  }
  write(io.stdout, `${JSON.stringify(output.data, null, 2)}\n`)
}

function renderError(error, flags, io) {
  const payload = {
    code: error.code,
    message: error.message,
    status: error.status,
    request_id: error.requestId,
    retryable: error.retryable,
    reason: error.reason,
    retry_at: error.retryAt,
    details: error.details,
    idempotency_key: error.idempotencyKey ?? null,
  }
  if (flags.json) write(io.stderr, `${JSON.stringify(payload)}\n`)
  else {
    write(io.stderr, `Error: ${error.message}\n`)
    if (error.requestId) write(io.stderr, `Request ID: ${error.requestId}\n`)
    if (error.reason) write(io.stderr, `Reason: ${error.reason}\n`)
    if (error.retryAt) write(io.stderr, `Retry at: ${error.retryAt}\n`)
    if (error.idempotencyKey)
      write(
        io.stderr,
        `Recovery key: ${error.idempotencyKey}. Retry with --idempotency-key ${error.idempotencyKey}.\n`
      )
  }
}

function helpFor(command) {
  if (!command)
    return `OpenPMM CLI ${VERSION}\n\nUse every OpenPMM customer workflow through the public /v1 API.\n\nCommon path:\n  openpmm signup create --email you@example.com --workspace-name "Product Marketing"\n  export OPENPMM_API_KEY=opm_live_...\n  openpmm workspaces list --json\n  openpmm posts create --workspace ws_... --when draft --channel x --body "Draft copy"\n  openpmm posts list --workspace ws_... --view drafts --json\n  openpmm posts publish --workspace ws_... --post post_... --post-version 1 --destination dst_... --yes\n\nCommands:\n${[
      ...OPERATIONS.map((operation) => operation.command),
      'assets download',
      'assets upload',
      'webhooks verify',
    ]
      .sort()
      .map((value) => `  ${value}`)
      .join(
        '\n'
      )}\n\nGlobal flags:\n  --workspace <id>       Workspace ID (or OPENPMM_WORKSPACE)\n  --api-base-url <url>   Public API origin (or OPENPMM_API_BASE_URL)\n  --file <path|->        Complete JSON request body\n  --json, -json          Stable JSON output\n  --jsonl                One list item per line\n  --limit <count>        Bound total list items\n  --page-size <count>    Control the public API page size\n  --quiet                IDs only\n  --yes                  Confirm publishing or destructive work\n  --help                  Show help\n  --version               Show version\n\nRun openpmm <command> --help for command details.\n`
  const convenienceHelp = {
    'assets upload':
      'openpmm assets upload <path> --workspace <id> [--kind card|reel|poster] [--content-type <type>]\n\nCreate an upload session, stream the file to storage, and complete it through public /v1 operations.\n',
    'assets download':
      'openpmm assets download <asset_id> --workspace <id> --output <path|->\n\nRequest a short-lived download URL through the public /v1 API, then download the asset. Existing files are not overwritten.\n',
    'webhooks verify':
      'openpmm webhooks verify --signature <header> --file <payload|-> [--secret-file <path>] [--tolerance-seconds 300]\n\nVerify OpenPMM-Signature against the exact payload bytes. Set OPENPMM_WEBHOOK_SECRET or pass a protected secret file. This local command does not call the API.\n',
  }
  if (convenienceHelp[command]) return convenienceHelp[command]
  const operation = OPERATION_BY_COMMAND.get(command)
  if (!operation) return helpFor('')
  const positional = [...operation.path.matchAll(/\{([^}]+)\}/g)]
    .map((match) => match[1])
    .filter((name) => name !== 'workspace_id')
    .map((name) => `<${name}>`)
    .join(' ')
  const confirmation = requiresConfirmation(operation)
  const sideEffects = operation.confirm
    ? operation.id === 'createWorkspace'
      ? 'Requires --yes. This can charge a prorated Workspace subscription amount immediately.'
      : operation.id === 'cancelWorkspaceSubscription'
        ? 'Requires --yes. This schedules Workspace subscription cancellation at the paid term end.'
        : operation.path.startsWith('/billing')
          ? 'Requires --yes. This can start or charge a subscription.'
          : 'Requires --yes. This can publish, disconnect, or delete data.'
    : operation.id === 'createPosts'
      ? 'Requires --yes unless the request creates a draft.'
      : 'No extra confirmation.'
  const inputNote =
    operation.id === 'publishPosts'
      ? ' Include every draft Post in the group. Use --at queue to use the next destination queue slot.'
      : operation.id === 'createPosts'
        ? ' Use --when queue to use the next destination queue slot. Repeat --body in order to publish a self-reply chain on X, Bluesky, Mastodon, or Threads. Repeat --media-item <body-index>:<asset-id> to attach media to a specific item.'
      : operation.id === 'patchPost'
        ? ' You can change copy and publishing options on a draft or scheduled Post. Cancel a schedule before you change assets or thread structure.'
      : operation.id === 'movePostsInQueue'
        ? ' Use --post, --expected-scheduled-at, and --local-date for one Post. Use --file for an atomic multi-Post move.'
      : operation.id === 'patchDestination'
        ? ' Use --queue-policy <json> or provide a complete JSON request body.'
      : operation.id === 'submitFeedback'
        ? ' Use --message <text> or provide a JSON request body.'
      : operation.id === 'createSignupIntent'
        ? ' Use --email and --workspace-name. This command does not require an API key. Open the returned signup_url to finish with Google or an email address and password.'
      : operation.id === 'createDestinationConnectionSession'
        ? ' Bluesky requires --account <handle-or-did>. Mastodon requires --instance-origin <url>.'
      : operation.id === 'createBillingCheckoutSession'
        ? ' Use --interval month or --interval year. Signup starts the 14-day trial automatically. Open the returned URL to start paid service immediately and unlock X.'
      : operation.id === 'convertBillingTrial'
        ? ' This command is only for legacy Stripe-hosted trials. New trials use billing subscribe.'
      : operation.id === 'getAnalyticsReport'
        ? ' Use --from <date>, --until <date>, and --bucket day|week. Use --channel to filter the report.'
      : ['getPostAnalytics', 'refreshPostAnalytics'].includes(operation.id)
        ? ' Use --post <id>. Refresh returns after OpenPMM accepts or coalesces the request. Add --wait to poll for a bounded time.'
      : ['getPostGroupAnalytics', 'refreshPostGroupAnalytics'].includes(operation.id)
        ? ' Use --group <group>. Refresh returns per-Post outcomes. Add --wait to poll for a bounded time.'
      : ''
  return `${command}\n\n${operationTitle(operation)} through the public API.\nCalls ${operation.method} ${operation.path}.\nRequired scope: ${scopeFor(operation)}\nWorkspace: ${operation.path.includes('{workspace_id}') ? 'required' : 'not required'}\nSide effects: ${sideEffects}\nInput: common flags or --file <request.json>; use --file - for stdin.${inputNote}\nOutput: human by default; --json, -json, --jsonl (lists), or --quiet.\nRelevant exits: 0 success, 2 input, 3 auth, 4 scope, 5 not found, 6 conflict, 7 validation, 8 unavailable, 9 ambiguous, 10 confirmation.\n\nExample:\n  openpmm ${command} ${positional} ${operation.path.includes('{workspace_id}') ? '--workspace ws_01JABCDEF ' : ''}${operation.body ? '--file request.json ' : ''}${confirmation ? '--yes ' : ''}--json\n`
}

function requiresConfirmation(operation) {
  return operation.confirm || operation.id === 'createPosts'
}

function operationTitle(operation) {
  const words = operation.id
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
  return words[0].toUpperCase() + words.slice(1)
}

function scopeFor(operation) {
  if (
    operation.id === 'createWorkspace' ||
    operation.id === 'cancelWorkspaceSubscription'
  )
    return 'billing:write'
  if (operation.authentication === 'none') return 'none'
  if (operation.id === 'getAccount') return 'none'
  if (operation.path.startsWith('/billing'))
    return operation.method === 'GET' ? 'billing:read' : 'billing:write'
  if (operation.id === 'submitFeedback') return 'feedback:write'
  if (
    operation.path.includes('notification') ||
    operation.path.includes('slack')
  )
    return operation.method === 'GET'
      ? 'notifications:read'
      : 'notifications:write'
  if (operation.path.startsWith('/account/'))
    return operation.method === 'GET' ? 'team:read' : 'team:write'
  if (
    operation.path === '/workspaces' ||
    /^\/workspaces\/\{workspace_id\}$/.test(operation.path)
  )
    return operation.method === 'GET' ? 'workspaces:read' : 'workspaces:write'
  if (operation.path.includes('webhook-endpoints'))
    return operation.method === 'GET' ? 'webhooks:read' : 'webhooks:write'
  if (operation.path.includes('asset'))
    return operation.id === 'validateAsset' || operation.method === 'GET'
      ? 'assets:read'
      : 'assets:write'
  if (
    operation.path.includes('destination') ||
    operation.path.includes('connection')
  )
    return operation.method === 'GET'
      ? 'destinations:read'
      : 'destinations:write'
  return operation.method === 'GET' ? 'posts:read' : 'posts:write'
}

function set(object, key, value) {
  if (value !== undefined) object[key] = value
}
function asArray(value) {
  return Array.isArray(value) ? value : [value]
}
function csv(value) {
  return value === undefined
    ? undefined
    : asArray(value)
        .flatMap((item) => String(item).split(','))
        .map((item) => item.trim())
        .filter(Boolean)
}
function nullValue(value) {
  return value === undefined
    ? undefined
    : value === 'null' || value === 'none'
      ? null
      : value
}
function booleanValue(value) {
  return value === undefined
    ? undefined
    : !['false', '0', 'no'].includes(String(value).toLowerCase())
}
function jsonValue(value) {
  if (value === undefined) return undefined
  try {
    return JSON.parse(value)
  } catch {
    throw new CliError('Expected valid JSON.', { exitCode: 2 })
  }
}
function requiredFlag(flags, name) {
  if (flags[name] === undefined)
    throw new CliError(`This command requires --${name}.`, { exitCode: 2 })
  return flags[name]
}
function positiveIntegerFlag(value, name) {
  if (value === undefined) return undefined
  const number = Number(value)
  if (!Number.isInteger(number) || number < 1)
    throw new CliError(`Flag --${name} must be a positive integer.`, {
      exitCode: 2,
    })
  return number
}
function write(stream, value) {
  stream.write(value)
  return 0
}
async function readStream(stream) {
  return (await readStreamBuffer(stream)).toString('utf8')
}
async function readStreamBuffer(stream) {
  const chunks = []
  for await (const chunk of stream) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks)
}
