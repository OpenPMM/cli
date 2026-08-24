const FLAG_DEFINITIONS = {
  account: ['<handle-or-did>', 'Provider account identifier.'],
  'acknowledge-duplicate-risk': [
    '',
    'Confirm a retry that can duplicate provider content.',
  ],
  after: ['<cursor>', 'Start after this cursor.'],
  'api-base-url': [
    '<url>',
    'Public /v1 API URL. Uses OPENPMM_API_BASE_URL when omitted.',
  ],
  at: ['<now|queue|timestamp>', 'Select immediate, queued, or exact timing.'],
  'authorize-cli': ['', 'Start CLI authorization during signup.'],
  body: ['<text>', 'Post body. Repeat for an ordered self-reply chain.'],
  bucket: ['<day|week>', 'Analytics time bucket.'],
  channel: ['<channel>', 'Channel key. Repeat when the command permits it.'],
  confirmation: ['<value>', 'Explicit confirmation value for the request.'],
  'content-mode': ['<metadata|full>', 'Webhook content delivery mode.'],
  'content-type': ['<type>', 'Asset MIME type when it cannot be inferred.'],
  'created-after': ['<timestamp>', 'Filter Posts created after this time.'],
  default: ['<true|false>', 'Make this the default Destination.'],
  destination: ['<id>', 'Destination ID. Repeat when the command permits it.'],
  'destination-filter': [
    '<all|selected>',
    'Webhook Destination filter mode.',
  ],
  'destination-options': [
    '<json>',
    'Destination publishing options as JSON.',
  ],
  destinations: ['<ids>', 'Comma-separated webhook Destination IDs.'],
  'device-name': ['<name>', 'Name shown for the CLI authorization.'],
  email: ['<address>', 'Email address for the request.'],
  enabled: ['<true|false>', 'Enable or disable the resource.'],
  'enabled-channels': ['<channels>', 'Comma-separated enabled channels.'],
  etag: ['<value>', 'If-Match value. The CLI reads it when omitted.'],
  events: ['<types>', 'Comma-separated webhook event types.'],
  'expected-scheduled-at': [
    '<timestamp>',
    'Current scheduled time for an atomic queue move.',
  ],
  file: ['<path|->', 'Complete JSON request body. Use - for stdin.'],
  from: ['<date>', 'Analytics start date.'],
  group: ['<value>', 'Caller-defined Post group.'],
  headline: ['<text>', 'Post headline.'],
  help: ['', 'Show help for this command.'],
  'idempotency-key': [
    '<key>',
    'Safe-retry key. The CLI creates one when omitted.',
  ],
  include: ['<value>', 'Include optional response details.'],
  'instance-origin': ['<url>', 'Mastodon instance origin.'],
  interval: ['<month|year>', 'Billing interval.'],
  json: ['', 'Write one stable JSON document to stdout.'],
  jsonl: ['', 'Write one JSON object per list item.'],
  kind: ['<card|reel|poster>', 'Asset kind.'],
  limit: ['<count>', 'Maximum list items.'],
  'local-date': ['<date>', 'Local calendar date in the Workspace time zone.'],
  media: ['<ids>', 'Comma-separated Asset IDs.'],
  'media-item': [
    '<body-index>:<asset-id>',
    'Attach an Asset to a body item. Repeat as needed.',
  ],
  message: ['<text>', 'Feedback message.'],
  name: ['<value>', 'Resource name.'],
  'no-color': ['', 'Disable color output.'],
  'no-open': ['', 'Do not open the browser automatically.'],
  'no-wait': ['', 'Return after CLI authorization starts.'],
  output: ['<path|->', 'Download destination. Use - for stdout.'],
  'page-size': ['<count>', 'Items requested from each API page.'],
  post: ['<id>', 'Post ID.'],
  'post-version': ['<number>', 'Post version that you reviewed.'],
  provider: ['<provider>', 'Provider key.'],
  'queue-policy': ['<json>', 'Destination queue policy as JSON.'],
  quiet: ['', 'Write identifiers only.'],
  resume: ['', 'Finish the pending CLI authorization.'],
  'scheduled-before': ['<timestamp>', 'Filter Posts scheduled before this time.'],
  'secret-file': ['<path>', 'Protected webhook secret file.'],
  signature: ['<header>', 'OpenPMM-Signature header value.'],
  'slack-channel': ['<id|none>', 'Slack channel ID or none.'],
  state: ['<state>', 'Filter Posts by exact state.'],
  'time-zone': ['<iana-name>', 'IANA time zone.'],
  'tolerance-seconds': ['<count>', 'Webhook timestamp tolerance. Default: 300.'],
  until: ['<date>', 'Analytics end date.'],
  url: ['<url>', 'Webhook endpoint URL.'],
  view: ['<view>', 'Named Post list view.'],
  wait: ['', 'Wait for bounded background work.'],
  'wait-timeout': ['<seconds>', 'Maximum publication wait. Default: 300.'],
  when: ['<draft|now|queue|timestamp>', 'Post creation timing.'],
  'with-token': ['', 'Import an existing API key from stdin.'],
  workspace: [
    '<id>',
    'Workspace ID. Uses the approved or only Workspace when omitted.',
  ],
  'workspace-name': ['<name>', 'Name for the first Workspace.'],
  yes: ['', 'Confirm publishing or destructive work.'],
}

const OPERATION_FLAGS = {
  createSignupIntent: ['email', 'workspace-name', 'authorize-cli', 'device-name'],
  createBillingCheckoutSession: ['interval'],
  convertBillingTrial: ['confirmation'],
  patchWorkspace: ['name', 'time-zone'],
  cancelWorkspaceSubscription: ['confirmation'],
  submitFeedback: ['message'],
  removeAccountMember: ['confirmation'],
  createAccountInvitation: ['email'],
  validateAsset: ['channel', 'destination'],
  patchDestination: ['enabled', 'default', 'queue-policy'],
  createDestinationConnectionSession: [
    'provider',
    'account',
    'instance-origin',
  ],
  disconnectDestination: ['confirmation'],
  patchNotificationSettings: ['slack-channel'],
  disconnectSlackConnection: ['confirmation'],
  createWebhookEndpoint: [
    'name',
    'url',
    'events',
    'destination-filter',
    'destinations',
    'content-mode',
  ],
  patchWebhookEndpoint: [
    'name',
    'url',
    'events',
    'destination-filter',
    'destinations',
    'content-mode',
  ],
  getAnalyticsReport: ['from', 'until', 'bucket', 'channel', 'after', 'limit'],
  getPostAnalytics: ['post'],
  refreshPostAnalytics: ['post', 'wait'],
  getPostGroupAnalytics: ['group'],
  refreshPostGroupAnalytics: ['group', 'wait'],
  createPosts: [
    'when',
    'group',
    'channel',
    'destination',
    'headline',
    'body',
    'media',
    'media-item',
    'destination-options',
    'time-zone',
    'wait',
    'wait-timeout',
  ],
  listPosts: [
    'view',
    'state',
    'channel',
    'group',
    'destination',
    'created-after',
    'scheduled-before',
    'include',
  ],
  movePostsInQueue: ['post', 'expected-scheduled-at', 'local-date'],
  getPost: ['post', 'include'],
  patchPost: [
    'post',
    'headline',
    'body',
    'media',
    'media-item',
    'destination-options',
  ],
  deletePost: ['post'],
  publishPosts: [
    'post',
    'post-version',
    'destination',
    'at',
    'time-zone',
    'wait',
    'wait-timeout',
  ],
  cancelPost: ['post', 'confirmation'],
  reschedulePost: ['post', 'at', 'time-zone', 'confirmation'],
  retryPost: ['post', 'confirmation', 'acknowledge-duplicate-risk'],
  getAsset: ['include'],
}

const CONVENIENCE_FLAGS = {
  'auth login': [
    'api-base-url',
    'device-name',
    'no-open',
    'no-wait',
    'resume',
    'with-token',
    'json',
  ],
  'auth logout': ['api-base-url'],
  doctor: ['api-base-url', 'workspace', 'json', 'quiet'],
  'assets upload': [
    'workspace',
    'api-base-url',
    'kind',
    'content-type',
    'idempotency-key',
    'json',
    'quiet',
  ],
  'assets download': ['workspace', 'api-base-url', 'output', 'quiet'],
  'posts wait': [
    'workspace',
    'api-base-url',
    'wait-timeout',
    'json',
    'quiet',
  ],
  'webhooks verify': [
    'file',
    'signature',
    'secret-file',
    'tolerance-seconds',
    'json',
    'quiet',
  ],
}

export function flagsForOperation(operation) {
  const names = []
  if (operation.path.includes('{workspace_id}')) names.push('workspace')
  names.push('api-base-url')
  if (operation.body) names.push('file')
  names.push(...(OPERATION_FLAGS[operation.id] ?? []))
  if (operation.ifMatch) names.push('etag')
  if (operation.idempotent) names.push('idempotency-key')
  if (operation.confirm || operation.id === 'createPosts') names.push('yes')
  if (operation.paginated) names.push('after', 'limit', 'page-size')
  names.push('json')
  if (operation.id.startsWith('list')) names.push('jsonl')
  names.push('quiet', 'no-color', 'help')
  return unique(names)
}

export function flagsForConvenienceCommand(command) {
  return unique([...(CONVENIENCE_FLAGS[command] ?? []), 'help'])
}

export function unsupportedFlags(flags, allowedNames) {
  const allowed = new Set([...allowedNames, 'version'])
  return Object.keys(flags).filter((name) => !allowed.has(name))
}

export function formatFlagHelp(names) {
  const rows = unique(names).map((name) => {
    const [value, description] = FLAG_DEFINITIONS[name]
    return [`--${name}${value ? ` ${value}` : ''}`, description]
  })
  const width = Math.max(...rows.map(([usage]) => usage.length))
  return rows
    .map(([usage, description]) => `  ${usage.padEnd(width)}  ${description}`)
    .join('\n')
}

function unique(values) {
  return [...new Set(values)]
}
