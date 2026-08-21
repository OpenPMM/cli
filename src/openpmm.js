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
import { homedir, hostname } from 'node:os'
import { basename, dirname, extname, join } from 'node:path'
import { stdin, stdout, stderr } from 'node:process'
import { Crc64Nvme, crc64NvmeBase64 } from './crc64.js'
import { OPERATIONS, OPERATION_BY_COMMAND } from './operations.js'
import {
  CliError,
  PublicApiTransport,
  normalizeApiBaseUrl,
} from './transport.js'

export const VERSION = '0.2.0'
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
  let flags = {}
  try {
    const parsed = parseArguments(argv)
    flags = parsed.flags
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
    if (special === 'auth login')
      return await authLogin(parsed, io, dependencies)
    if (special === 'auth logout')
      return await authLogout(parsed, io, dependencies)
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
    if (
      match?.operation.confirm &&
      match.operation.id !== 'createWorkspace' &&
      !parsed.flags.yes
    )
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
      : process.env.OPENPMM_API_KEY ??
        (await storedCredential(
          baseUrl,
          dependencies.credentialPath ?? CREDENTIAL_PATH
        ))
    const transport = new PublicApiTransport({
      apiKey,
      anonymous,
      baseUrl,
      fetchImpl: dependencies.fetchImpl,
      stderr: io.stderr,
      userAgent: `@openpmm/cli/${VERSION} (${process.platform}; ${process.arch})`,
    })
    const workspace = await resolveWorkspace(
      transport,
      parsed.flags.workspace ?? process.env.OPENPMM_WORKSPACE ?? undefined,
      {
        required:
          Boolean(assetWorkflow) ||
          Boolean(match.operation.path.includes('{workspace_id}')),
        baseUrl,
        useStoredWorkspace: !process.env.OPENPMM_API_KEY,
        credentialPath: dependencies.credentialPath ?? CREDENTIAL_PATH,
      }
    )
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

    const path = fillPath(
      match.operation.path,
      workspace,
      match.positionals,
      parsed.flags
    )
    let body = await requestBody(match.operation, parsed, io)
    let etag = parsed.flags.etag

    if (match.operation.id === 'createWorkspace') {
      const previewResult = await transport.request({
        method: 'GET',
        path: '/workspace-creation-preview',
      })
      const preview = previewResult.data
      renderWorkspaceChargePreview(preview, parsed.flags, io)
      if (!parsed.flags.yes)
        throw new CliError(
          'Review the Workspace charge, then rerun with --yes.',
          {
            code: 'confirmation_required',
            exitCode: 10,
            details: preview,
          }
        )
      if (preview.charge_required)
        body.billing_preview = {
          currency: preview.currency,
          amount_due: preview.amount_due,
          recurring_amount: preview.recurring_amount,
          interval: preview.interval,
          current_workspace_quantity: preview.current_workspace_quantity,
          new_workspace_quantity: preview.new_workspace_quantity,
        }
    }

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
    if (
      match.operation.id === 'createSignupIntent' &&
      parsed.flags['authorize-cli']
    ) {
      const authorization = result.data?.cli_authorization
      if (!authorization?.device_secret)
        throw new CliError(
          'The signup response did not include a CLI authorization.',
          { exitCode: 8 }
        )
      await beginBrowserAuthorization(
        {
          authorization,
          browserUrl: result.data.signup_url,
          baseUrl,
        },
        parsed,
        io,
        dependencies
      )
      renderSuccess(
        {
          data: {
            object: 'signup_intent',
            signup_url: result.data.signup_url,
            expires_at: result.data.expires_at,
            cli_authorization: safeAuthorizationMetadata(authorization),
          },
          meta: {
            request_id: result.requestId,
            idempotency_key: null,
            operation_id: match.operation.id,
          },
        },
        parsed.flags,
        io
      )
      return 0
    }
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
    renderError(normalized, flags, io)
    return normalized.exitCode
  }
}

// Flags that never take a value. Presence means true; `--flag=false` means false.
const BOOLEAN_FLAGS = new Set([
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
  'authorize-cli',
  'no-open',
  'no-wait',
  'resume',
])

// Flags that carry a value. Keep in sync with every flag the CLI reads in
// requestBody, queryFrom, uploadAsset, authLogin, and verifyWebhookSignature.
// Adding a new flag anywhere means adding its name here, or the parser rejects
// it as unknown.
const VALUE_FLAGS = new Set([
  'account',
  'after',
  'api-base-url',
  'at',
  'body',
  'bucket',
  'channel',
  'confirmation',
  'content-mode',
  'content-type',
  'default',
  'destination',
  'destination-filter',
  'destinations',
  'device-name',
  'email',
  'enabled',
  'enabled-channels',
  'etag',
  'events',
  'expected-scheduled-at',
  'file',
  'from',
  'group',
  'headline',
  'idempotency-key',
  'include',
  'instance-origin',
  'interval',
  'kind',
  'limit',
  'local-date',
  'media',
  'media-item',
  'message',
  'name',
  'options',
  'output',
  'page-size',
  'post',
  'post-version',
  'provider',
  'queue-policy',
  'secret-file',
  'signature',
  'slack-channel',
  'time-zone',
  'tolerance-seconds',
  'until',
  'url',
  'view',
  'when',
  'workspace',
  'workspace-name',
])

const KNOWN_FLAGS = new Set([...BOOLEAN_FLAGS, ...VALUE_FLAGS])

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
    if (!KNOWN_FLAGS.has(name))
      throw new CliError(
        `Unknown flag --${name}. Run \`openpmm <command> --help\` to see accepted flags.`,
        { exitCode: 2 }
      )
    if (BOOLEAN_FLAGS.has(name)) {
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

function fillPath(template, workspace, positionals, flags = {}) {
  let position = 0
  return template.replace(/\{([^}]+)\}/g, (_match, name) => {
    const value =
      name === 'workspace_id'
        ? workspace
        : (positionals[position++] ?? flags[name])
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
      ...(flags['authorize-cli']
        ? {
            authorize_cli: true,
            device_name: flags['device-name'] ?? hostname(),
            cli_version: VERSION,
          }
        : {}),
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

async function authLogin(parsed, io, dependencies = {}) {
  const baseUrl = normalizeApiBaseUrl(
    parsed.flags['api-base-url'] ??
      process.env.OPENPMM_API_BASE_URL ??
      DEFAULT_API_BASE_URL
  )
  const credentialPath = dependencies.credentialPath ?? CREDENTIAL_PATH
  if (parsed.flags.resume && parsed.flags['no-wait'])
    throw new CliError('Use --no-wait to start or --resume to finish, not both.', {
      exitCode: 2,
    })
  if (parsed.flags['with-token']) {
    const token = (await readStream(io.stdin)).trim()
    if (!token)
      throw new CliError('stdin did not contain an API key.', { exitCode: 2 })
    const store = await readCredentialStore(credentialPath)
    store.credentials[baseUrl] = token
    delete store.pending[baseUrl]
    await writeCredentialStore(store, credentialPath)
    write(io.stdout, `Saved an API key for ${baseUrl}.\n`)
    return 0
  }
  const store = await readCredentialStore(credentialPath)
  let pending = store.pending[baseUrl]
  if (
    parsed.flags.resume &&
    (!pending || Date.parse(pending.expires_at) <= Date.now())
  )
    throw new CliError(
      'No pending CLI authorization is available. Run `openpmm auth login --no-wait` first.',
      { code: 'cli_authorization_not_found', exitCode: 5 }
    )
  let started = false
  if (!pending || Date.parse(pending.expires_at) <= Date.now()) {
    const transport = new PublicApiTransport({
      apiKey: null,
      anonymous: true,
      baseUrl,
      fetchImpl: dependencies.fetchImpl,
      stderr: io.stderr,
      userAgent: `@openpmm/cli/${VERSION} (${process.platform}; ${process.arch})`,
    })
    const created = await transport.request({
      method: 'POST',
      path: '/cli-authorizations',
      body: {
        device_name: parsed.flags['device-name'] ?? hostname(),
        cli_version: VERSION,
      },
    })
    pending = {
      ...created.data,
      browser_url: created.data.verification_uri_complete,
    }
    started = true
  }
  if (started || !parsed.flags.resume)
    await beginBrowserAuthorization(
      { authorization: pending, browserUrl: pending.browser_url, baseUrl },
      parsed,
      io,
      dependencies
    )
  if (parsed.flags['no-wait']) {
    renderSuccess(
      { data: safeAuthorizationMetadata(pending), meta: {} },
      parsed.flags,
      io
    )
    return 0
  }
  const authorized = await finishBrowserAuthorization(
    { authorization: pending, browserUrl: pending.browser_url, baseUrl },
    parsed,
    io,
    dependencies,
    { announce: false }
  )
  if (parsed.flags.json)
    write(
      io.stdout,
      `${JSON.stringify({
        data: {
          object: 'cli_login',
          authorized: true,
          workspace_id: authorized.workspace_id,
          workspace_name: authorized.workspace_name,
        },
      })}\n`
    )
  else
    write(
      io.stdout,
      `OpenPMM CLI is connected to ${authorized.workspace_name} (${authorized.workspace_id}).\n`
    )
  return 0
}

async function authLogout(parsed, io, dependencies = {}) {
  const baseUrl = normalizeApiBaseUrl(
    parsed.flags['api-base-url'] ??
      process.env.OPENPMM_API_BASE_URL ??
      DEFAULT_API_BASE_URL
  )
  const credentialPath = dependencies.credentialPath ?? CREDENTIAL_PATH
  const store = await readCredentialStore(credentialPath)
  const removed =
    Object.hasOwn(store.credentials, baseUrl) ||
    Object.hasOwn(store.workspaces, baseUrl) ||
    Object.hasOwn(store.pending, baseUrl)
  if (!removed) {
    write(io.stdout, `No saved login was found for ${baseUrl}.\n`)
    return 0
  }
  delete store.credentials[baseUrl]
  delete store.workspaces[baseUrl]
  delete store.pending[baseUrl]
  await writeCredentialStore(store, credentialPath)
  write(io.stdout, `Removed the saved login for ${baseUrl}.\n`)
  return 0
}

async function finishBrowserAuthorization(
  { authorization, browserUrl, baseUrl },
  parsed,
  io,
  dependencies,
  { announce = true } = {}
) {
  const credentialPath = dependencies.credentialPath ?? CREDENTIAL_PATH
  if (announce)
    await beginBrowserAuthorization(
      { authorization, browserUrl, baseUrl },
      parsed,
      io,
      dependencies
    )

  const transport = new PublicApiTransport({
    apiKey: null,
    anonymous: true,
    baseUrl,
    fetchImpl: dependencies.fetchImpl,
    stderr: io.stderr,
    userAgent: `@openpmm/cli/${VERSION} (${process.platform}; ${process.arch})`,
  })
  const sleep = dependencies.sleep ?? defaultSleep
  let retryAfter = Number(authorization.interval) || 5
  while (Date.now() < Date.parse(authorization.expires_at)) {
    await sleep(retryAfter * 1000)
    const exchanged = await transport.request({
      method: 'POST',
      path: '/cli-authorizations/token',
      body: { device_secret: authorization.device_secret },
    })
    if (exchanged.data?.status === 'pending') {
      retryAfter = Number(exchanged.data.retry_after) || retryAfter
      continue
    }
    if (exchanged.data?.status !== 'authorized' || !exchanged.data.api_key)
      throw new CliError('The CLI authorization response was invalid.', {
        exitCode: 8,
      })
    const latest = await readCredentialStore(credentialPath)
    latest.credentials[baseUrl] = exchanged.data.api_key
    latest.workspaces[baseUrl] = exchanged.data.workspace_id
    delete latest.pending[baseUrl]
    await writeCredentialStore(latest, credentialPath)
    return exchanged.data
  }
  throw new CliError(
    'CLI authorization expired. Run `openpmm auth login` to try again.',
    { code: 'cli_authorization_not_found', exitCode: 5 }
  )
}

async function beginBrowserAuthorization(
  { authorization, browserUrl, baseUrl },
  parsed,
  io,
  dependencies
) {
  const credentialPath = dependencies.credentialPath ?? CREDENTIAL_PATH
  const store = await readCredentialStore(credentialPath)
  store.pending[baseUrl] = {
    ...authorization,
    browser_url: browserUrl,
  }
  await writeCredentialStore(store, credentialPath)

  write(io.stderr, `Open this link to authorize OpenPMM:\n${browserUrl}\n`)
  if (!parsed.flags['no-open']) {
    try {
      await openBrowser(browserUrl, dependencies.openBrowser)
    } catch {
      write(io.stderr, 'The browser did not open automatically. Use the link above.\n')
    }
  }
}

function safeAuthorizationMetadata(authorization) {
  return {
    object: 'cli_authorization',
    status: 'pending',
    verification_uri: authorization.verification_uri,
    verification_uri_complete:
      authorization.verification_uri_complete ?? authorization.browser_url,
    expires_at: authorization.expires_at,
    interval: authorization.interval,
  }
}

async function openBrowser(url, injected) {
  if (injected) return await injected(url)
  const { spawn } = await import('node:child_process')
  const command =
    process.platform === 'darwin'
      ? ['open', [url]]
      : process.platform === 'win32'
        ? ['cmd', ['/c', 'start', '', url]]
        : ['xdg-open', [url]]
  const child = spawn(command[0], command[1], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  })
  await new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('spawn', () => {
      child.unref()
      resolve()
    })
  })
}

async function resolveWorkspace(
  transport,
  explicitWorkspace,
  { required, baseUrl, useStoredWorkspace, credentialPath }
) {
  if (!required || explicitWorkspace) return explicitWorkspace
  if (useStoredWorkspace) {
    const stored = (await readCredentialStore(credentialPath)).workspaces[baseUrl]
    if (stored) return stored
  }
  const result = await transport.request({
    method: 'GET',
    path: '/workspaces',
    query: { limit: 2 },
  })
  const workspaces = Array.isArray(result.data?.data) ? result.data.data : []
  if (workspaces.length === 1) {
    const workspaceId = workspaces[0]?.id
    if (!workspaceId)
      throw new CliError('The Workspace response did not include an ID.', {
        exitCode: 8,
      })
    if (useStoredWorkspace) {
      const store = await readCredentialStore(credentialPath)
      store.workspaces[baseUrl] = workspaceId
      await writeCredentialStore(store, credentialPath)
    }
    return workspaceId
  }
  if (workspaces.length === 0)
    throw new CliError('No Workspace is available for this API key.', {
      exitCode: 5,
    })
  throw new CliError(
    'More than one Workspace is available. Pass --workspace <id> or set OPENPMM_WORKSPACE.',
    { exitCode: 2 }
  )
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

async function storedCredential(baseUrl, credentialPath = CREDENTIAL_PATH) {
  return (await readCredentialStore(credentialPath)).credentials[baseUrl] ?? null
}

async function readCredentialStore(credentialPath = CREDENTIAL_PATH) {
  try {
    const metadata = await stat(credentialPath)
    if (process.platform !== 'win32' && (metadata.mode & 0o077) !== 0)
      throw new CliError(
        `Refusing to read ${credentialPath} because it is accessible by other users. Run \`chmod 600 ${credentialPath}\` or use OPENPMM_API_KEY.`,
        { exitCode: 3 }
      )
    const parsed = JSON.parse(await readFile(credentialPath, 'utf8'))
    return [1, 2].includes(parsed?.version) && parsed.credentials
      ? {
          version: 2,
          credentials: parsed.credentials,
          workspaces: parsed.workspaces ?? {},
          pending: parsed.pending ?? {},
        }
      : emptyCredentialStore()
  } catch (error) {
    if (error instanceof CliError) throw error
    return emptyCredentialStore()
  }
}

function emptyCredentialStore() {
  return { version: 2, credentials: {}, workspaces: {}, pending: {} }
}

async function writeCredentialStore(store, credentialPath = CREDENTIAL_PATH) {
  await mkdir(dirname(credentialPath), { recursive: true, mode: 0o700 })
  if (process.platform !== 'win32') await chmod(dirname(credentialPath), 0o700)
  const temporary = `${credentialPath}.${process.pid}.tmp`
  await writeFile(temporary, `${JSON.stringify(store)}\n`, { mode: 0o600 })
  await chmod(temporary, 0o600)
  await rename(temporary, credentialPath)
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
  if (flags.json)
    return write(io.stdout, `${JSON.stringify(jsonSuccessOutput(output))}\n`)
  if (Array.isArray(output.data?.data)) {
    if (output.data.data.length === 0) return write(io.stdout, 'No results.\n')
    if (output.meta?.operation_id === 'listDestinations')
      return renderDestinationList(output.data.data, io.stdout)
    if (output.meta?.operation_id === 'listPosts')
      return renderPostList(output.data.data, io.stdout)
    for (const value of output.data.data)
      write(
        io.stdout,
        `${value.id ?? value.name ?? value.object ?? 'result'}${value.name ? `\t${value.name}` : ''}\n`
      )
    return
  }
  write(io.stdout, `${JSON.stringify(output.data, null, 2)}\n`)
}

function jsonSuccessOutput(output) {
  if (!Array.isArray(output.data?.data)) return output
  return { ...output.data, meta: output.meta }
}

function renderDestinationList(values, stream) {
  write(stream, 'ID\tCHANNEL\tSTATUS\tDEFAULT\tNAME\n')
  for (const value of values) {
    write(
      stream,
      `${value.id}\t${value.channel ?? 'unknown'}\t${value.status ?? 'unknown'}\t${value.is_default ? 'yes' : 'no'}\t${value.display_name ?? ''}\n`
    )
  }
}

function renderPostList(values, stream) {
  write(stream, 'ID\tCHANNEL\tSTATE\tBODY\n')
  for (const value of values) {
    const body = asArray(value.body ?? value.payload?.body ?? '')
      .filter(Boolean)
      .join(' / ')
      .replace(/\s+/g, ' ')
    const preview = body.length > 80 ? `${body.slice(0, 77)}...` : body
    write(
      stream,
      `${value.id ?? 'unknown'}\t${value.channel ?? value.payload?.channel ?? 'unknown'}\t${value.state ?? 'unknown'}\t${preview}\n`
    )
  }
}

function renderWorkspaceChargePreview(preview, flags, io) {
  if (flags.quiet || flags.json || flags.jsonl) return
  if (!preview.charge_required) {
    write(io.stdout, 'No subscription charge is required for this Account.\n')
    return
  }
  const due = formatCurrencyAmount(preview.amount_due, preview.currency)
  const recurring = formatCurrencyAmount(
    preview.recurring_amount,
    preview.currency
  )
  const period = preview.interval === 'year' ? 'year' : 'month'
  write(
    io.stdout,
    `Workspace charge preview:\n  Due now: ${due}\n  New ${period === 'year' ? 'annual' : 'monthly'} total: ${recurring}/${period}\n  Workspace quantity: ${preview.current_workspace_quantity} → ${preview.new_workspace_quantity}\n`
  )
}

function formatCurrencyAmount(amount, currency) {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: String(currency).toUpperCase(),
  }).format(Number(amount) / 100)
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
    return `OpenPMM CLI ${VERSION}\n\nUse every OpenPMM customer workflow through the public /v1 API.\n\nCommon path:\n  openpmm signup create --email you@example.com --workspace-name "Product Marketing" --authorize-cli\n  openpmm posts create --when draft --channel x --body "Draft copy"\n  openpmm posts list --view drafts --json\n  openpmm posts publish --post send_... --post-version 1 --destination dst_... --yes\n\nCommands:\n${[
      ...new Set(OPERATIONS.map((operation) => operation.command)),
      'auth logout',
      'assets download',
      'assets upload',
      'webhooks verify',
    ]
      .sort()
      .map((value) => `  ${value}`)
      .join(
        '\n'
      )}\n\nGlobal flags:\n  --workspace <id>       Workspace ID. Omit when the key has one Workspace.\n  --api-base-url <url>   Public API origin (or OPENPMM_API_BASE_URL)\n  --file <path|->        Complete JSON request body\n  --json, -json          Stable JSON output\n  --jsonl                One list item per line\n  --limit <count>        Bound total list items\n  --page-size <count>    Control the public API page size\n  --etag <value>         If-Match value for an update; read automatically when omitted\n  --quiet                IDs only\n  --yes                  Confirm publishing or destructive work\n  --help                  Show help\n  --version               Show version\n\nRun openpmm <command> --help for command details.\n`
  const convenienceHelp = {
    'auth login':
      'openpmm auth login [--no-open] [--no-wait | --resume]\n\nOpen a browser to sign in and authorize the CLI. Use --no-wait for safe agent-readable metadata, then --resume after browser approval. OpenPMM stores the resulting API key and selected Workspace in ~/.config/openpmm/credentials.json with user-only permissions. Use --with-token only to import an existing API key from stdin.\n',
    'auth logout':
      'openpmm auth logout [--api-base-url <url>]\n\nRemove the saved login for the selected API base URL. The command reports when no saved login exists.\n',
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
        ? ' Use --email and --workspace-name. Add --authorize-cli for one browser signup and CLI authorization flow. This command does not require an API key. Finish with Google or an email address and password.'
      : operation.id === 'createDestinationConnectionSession'
        ? ' Use --provider bluesky|x|youtube|facebook|instagram|threads|mastodon|linkedin|tiktok. Bluesky requires --account <handle-or-did>. Mastodon requires --instance-origin <url>.'
      : operation.id === 'createBillingCheckoutSession'
        ? ' Use --interval month or --interval year. Signup starts the 14-day trial automatically. Open the returned URL to start paid service immediately and unlock X.'
      : operation.id === 'convertBillingTrial'
        ? ' This command is only for legacy Stripe-hosted trials. New trials use billing subscribe.'
      : operation.id === 'previewWorkspaceCreation'
        ? ' Use this before workspaces create to inspect the exact prorated charge and new recurring total.'
      : operation.id === 'getAnalyticsReport'
        ? ' Use --from <date>, --until <date>, and --bucket day|week. Use --channel to filter the report.'
      : ['getPostAnalytics', 'refreshPostAnalytics'].includes(operation.id)
        ? ' Use --post <id>. Refresh returns after OpenPMM accepts or coalesces the request. Add --wait to poll for a bounded time.'
      : ['getPostGroupAnalytics', 'refreshPostGroupAnalytics'].includes(operation.id)
        ? ' Use --group <group>. Refresh returns per-Post outcomes. Add --wait to poll for a bounded time.'
      : ''
  return `${command}\n\nUsage:\n  openpmm ${command}${positional ? ` ${positional}` : ''} [flags]\n\n${operationTitle(operation)} through the public API.\nCalls ${operation.method} ${operation.path}.\nRequired scope: ${scopeFor(operation)}\nWorkspace: ${operation.path.includes('{workspace_id}') ? 'required' : 'not required'}\nSide effects: ${sideEffects}\nInput: common flags or --file <request.json>; use --file - for stdin.${inputNote}\nOutput: human by default; --json, -json, --jsonl (lists), or --quiet.\nRelevant exits: 0 success, 2 input, 3 auth, 4 scope, 5 not found, 6 conflict, 7 validation, 8 unavailable, 9 ambiguous, 10 confirmation.\n\nExample:\n  openpmm ${command} ${positional} ${operation.path.includes('{workspace_id}') ? '--workspace ws_01JABCDEF ' : ''}${operation.body ? '--file request.json ' : ''}${confirmation ? '--yes ' : ''}--json\n`
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
    operation.id === 'previewWorkspaceCreation' ||
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
