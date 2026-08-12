/**
 * Stable command-to-operation coverage. Keep operation IDs in sync with
 * `src/lib/public-api/operations.ts`; repository tests enforce both sides.
 */
export const OPERATIONS = [
  op('getAccount', 'accounts show', 'GET', '/account'),
  op('listWorkspaces', 'workspaces list', 'GET', '/workspaces', { paginated: true }),
  op('createWorkspace', 'workspaces create', 'POST', '/workspaces', { body: true, idempotent: true }),
  op('getWorkspace', 'workspaces show', 'GET', '/workspaces/{workspace_id}'),
  op('patchWorkspace', 'workspaces update', 'PATCH', '/workspaces/{workspace_id}', { body: true, ifMatch: 'workspace' }),
  op('deleteWorkspace', 'workspaces delete', 'DELETE', '/workspaces/{workspace_id}', { body: true, ifMatch: 'workspace', idempotent: true, confirm: true }),
  op('listAccountMembers', 'team members list', 'GET', '/account/members'),
  op('removeAccountMember', 'team members remove', 'DELETE', '/account/members/{user_id}', { body: true, idempotent: true, confirm: true }),
  op('listAccountInvitations', 'team invitations list', 'GET', '/account/invitations'),
  op('createAccountInvitation', 'team invitations create', 'POST', '/account/invitations', { body: true, idempotent: true }),
  op('resendAccountInvitation', 'team invitations resend', 'POST', '/account/invitations/{invitation_id}/resend', { idempotent: true }),
  op('revokeAccountInvitation', 'team invitations revoke', 'DELETE', '/account/invitations/{invitation_id}', { idempotent: true, confirm: true }),
  op('listAssets', 'assets list', 'GET', '/workspaces/{workspace_id}/assets', { paginated: true }),
  op('getAsset', 'assets show', 'GET', '/workspaces/{workspace_id}/assets/{asset_id}'),
  op('validateAsset', 'assets validate', 'POST', '/workspaces/{workspace_id}/assets/{asset_id}/validations', { body: true }),
  op('convertAsset', 'assets convert', 'POST', '/workspaces/{workspace_id}/assets/{asset_id}/conversions', { body: true, idempotent: true }),
  op('getAssetConversion', 'asset-conversions show', 'GET', '/workspaces/{workspace_id}/assets/{asset_id}/conversions/{conversion_id}'),
  op('deleteAsset', 'assets delete', 'DELETE', '/workspaces/{workspace_id}/assets/{asset_id}', { idempotent: true, confirm: true }),
  op('beginAssetUpload', 'asset-uploads create', 'POST', '/workspaces/{workspace_id}/asset-uploads', { body: true, idempotent: true }),
  op('getAssetUpload', 'asset-uploads show', 'GET', '/workspaces/{workspace_id}/asset-uploads/{upload_id}'),
  op('completeAssetUpload', 'asset-uploads complete', 'POST', '/workspaces/{workspace_id}/asset-uploads/{upload_id}/complete', { idempotent: true }),
  op('listDestinations', 'destinations list', 'GET', '/workspaces/{workspace_id}/destinations'),
  op('getDestination', 'destinations show', 'GET', '/workspaces/{workspace_id}/destinations/{destination_id}'),
  op('patchDestination', 'destinations update', 'PATCH', '/workspaces/{workspace_id}/destinations/{destination_id}', { body: true, ifMatch: 'destination' }),
  op('createDestinationConnectionSession', 'destinations connect', 'POST', '/workspaces/{workspace_id}/destination-connection-sessions', { body: true, idempotent: true }),
  op('getDestinationConnectionSession', 'destinations sessions show', 'GET', '/workspaces/{workspace_id}/destination-connection-sessions/{session_id}'),
  op('refreshDestinations', 'destinations refresh', 'POST', '/workspaces/{workspace_id}/destinations/refresh', { idempotent: true }),
  op('disconnectDestination', 'destinations disconnect', 'POST', '/workspaces/{workspace_id}/destinations/{destination_id}/disconnect', { body: true, idempotent: true, confirm: true }),
  op('getNotificationSettings', 'slack show', 'GET', '/workspaces/{workspace_id}/notification-settings'),
  op('patchNotificationSettings', 'slack update', 'PATCH', '/workspaces/{workspace_id}/notification-settings', { body: true }),
  op('createSlackConnectionSession', 'slack connect', 'POST', '/workspaces/{workspace_id}/slack-connection-sessions', { idempotent: true }),
  op('getSlackConnectionSession', 'slack sessions show', 'GET', '/workspaces/{workspace_id}/slack-connection-sessions/{session_id}'),
  op('disconnectSlackConnection', 'slack disconnect', 'DELETE', '/workspaces/{workspace_id}/slack-connection', { body: true, idempotent: true, confirm: true }),
  op('listSlackChannels', 'slack channels', 'GET', '/workspaces/{workspace_id}/slack-channels'),
  op('createSlackNotificationTest', 'slack test', 'POST', '/workspaces/{workspace_id}/slack-notification-tests', { body: true, idempotent: true, confirm: true }),
  op('listWebhookEndpoints', 'webhooks list', 'GET', '/workspaces/{workspace_id}/webhook-endpoints', { paginated: true }),
  op('createWebhookEndpoint', 'webhooks create', 'POST', '/workspaces/{workspace_id}/webhook-endpoints', { body: true, idempotent: true }),
  op('getWebhookEndpoint', 'webhooks show', 'GET', '/workspaces/{workspace_id}/webhook-endpoints/{endpoint_id}'),
  op('patchWebhookEndpoint', 'webhooks update', 'PATCH', '/workspaces/{workspace_id}/webhook-endpoints/{endpoint_id}', { body: true, ifMatch: 'webhook-endpoint' }),
  op('deleteWebhookEndpoint', 'webhooks delete', 'DELETE', '/workspaces/{workspace_id}/webhook-endpoints/{endpoint_id}', { ifMatch: 'webhook-endpoint', confirm: true }),
  op('rotateWebhookEndpointSecret', 'webhooks rotate-secret', 'POST', '/workspaces/{workspace_id}/webhook-endpoints/{endpoint_id}/rotate-secret', { idempotent: true }),
  op('testWebhookEndpoint', 'webhooks test', 'POST', '/workspaces/{workspace_id}/webhook-endpoints/{endpoint_id}/test', { idempotent: true }),
  op('createPosts', 'posts create', 'POST', '/workspaces/{workspace_id}/posts', { body: true, idempotent: true }),
  op('listPosts', 'posts list', 'GET', '/workspaces/{workspace_id}/posts', { paginated: true }),
  op('getPost', 'posts show', 'GET', '/workspaces/{workspace_id}/posts/{post}'),
  op('patchPost', 'posts update', 'PATCH', '/workspaces/{workspace_id}/posts/{post}', { body: true, ifMatch: 'post' }),
  op('deletePost', 'posts delete', 'DELETE', '/workspaces/{workspace_id}/posts/{post}', { ifMatch: 'post', idempotent: true }),
  op('publishPosts', 'posts publish', 'POST', '/workspaces/{workspace_id}/posts/publish', { body: true, idempotent: true, confirm: true }),
  op('cancelPost', 'posts cancel', 'POST', '/workspaces/{workspace_id}/posts/{post}/cancel', { body: true, ifMatch: 'post', idempotent: true, confirm: true }),
  op('reschedulePost', 'posts reschedule', 'POST', '/workspaces/{workspace_id}/posts/{post}/reschedule', { body: true, ifMatch: 'post', idempotent: true, confirm: true }),
  op('retryPost', 'posts retry', 'POST', '/workspaces/{workspace_id}/posts/{post}/retry', { body: true, ifMatch: 'post', idempotent: true, confirm: true }),
]

function op(id, command, method, path, options = {}) {
  return { id, command, method, path, ...options }
}

export const OPERATION_BY_COMMAND = new Map(
  OPERATIONS.map((operation) => [operation.command, operation])
)
