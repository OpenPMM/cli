/**
 * Stable command-to-operation coverage. Keep operation IDs in sync with
 * `src/lib/public-api/operations.ts`; repository tests enforce both sides.
 */
export const OPERATIONS = [
  op('getMe', 'auth status', 'GET', '/me'),
  op('getAccount', 'accounts show', 'GET', '/account'),
  op('listWorkspaces', 'workspaces list', 'GET', '/workspaces', {
    paginated: true,
  }),
  op('createWorkspace', 'workspaces create', 'POST', '/workspaces', {
    body: true,
    idempotent: true,
  }),
  op('getWorkspace', 'workspaces show', 'GET', '/workspaces/{workspace_id}'),
  op(
    'patchWorkspace',
    'workspaces update',
    'PATCH',
    '/workspaces/{workspace_id}',
    { body: true, ifMatch: 'workspace' }
  ),
  op(
    'deleteWorkspace',
    'workspaces delete',
    'DELETE',
    '/workspaces/{workspace_id}',
    { body: true, ifMatch: 'workspace', idempotent: true, confirm: true }
  ),
  op('listAccountMembers', 'team members list', 'GET', '/account/members'),
  op(
    'removeAccountMember',
    'team members remove',
    'DELETE',
    '/account/members/{user_id}',
    { body: true, idempotent: true, confirm: true }
  ),
  op(
    'listAccountInvitations',
    'team invitations list',
    'GET',
    '/account/invitations'
  ),
  op(
    'createAccountInvitation',
    'team invitations create',
    'POST',
    '/account/invitations',
    { body: true, idempotent: true }
  ),
  op(
    'resendAccountInvitation',
    'team invitations resend',
    'POST',
    '/account/invitations/{invitation_id}/resend',
    { idempotent: true }
  ),
  op(
    'revokeAccountInvitation',
    'team invitations revoke',
    'DELETE',
    '/account/invitations/{invitation_id}',
    { idempotent: true, confirm: true }
  ),
  op('listAssets', 'assets list', 'GET', '/workspaces/{workspace_id}/assets', {
    paginated: true,
  }),
  op(
    'getAsset',
    'assets show',
    'GET',
    '/workspaces/{workspace_id}/assets/{asset_id}'
  ),
  op(
    'deleteAsset',
    'assets delete',
    'DELETE',
    '/workspaces/{workspace_id}/assets/{asset_id}',
    { idempotent: true, confirm: true }
  ),
  op(
    'beginAssetUpload',
    'asset-uploads create',
    'POST',
    '/workspaces/{workspace_id}/asset-uploads',
    { body: true, idempotent: true }
  ),
  op(
    'getAssetUpload',
    'asset-uploads show',
    'GET',
    '/workspaces/{workspace_id}/asset-uploads/{upload_id}'
  ),
  op(
    'completeAssetUpload',
    'asset-uploads complete',
    'POST',
    '/workspaces/{workspace_id}/asset-uploads/{upload_id}/complete',
    { idempotent: true }
  ),
  op(
    'listPostGroups',
    'post-groups list',
    'GET',
    '/workspaces/{workspace_id}/post-groups',
    { paginated: true }
  ),
  op(
    'getPostGroup',
    'post-groups show',
    'GET',
    '/workspaces/{workspace_id}/post-groups/{group}'
  ),
  op(
    'patchPostGroup',
    'post-groups update',
    'PATCH',
    '/workspaces/{workspace_id}/post-groups/{group}',
    { body: true, ifMatch: 'post-group' }
  ),
  op(
    'deletePostGroup',
    'post-groups delete',
    'DELETE',
    '/workspaces/{workspace_id}/post-groups/{group}',
    { ifMatch: 'post-group', idempotent: true, confirm: true }
  ),
  op(
    'listPostGroupDrafts',
    'post-groups drafts list',
    'GET',
    '/workspaces/{workspace_id}/post-groups/{group}/drafts'
  ),
  op(
    'getPostGroupDraft',
    'post-groups drafts show',
    'GET',
    '/workspaces/{workspace_id}/post-groups/{group}/drafts/{channel}'
  ),
  op(
    'putPostGroupDraft',
    'post-groups drafts set',
    'PUT',
    '/workspaces/{workspace_id}/post-groups/{group}/drafts/{channel}',
    { body: true, ifMatch: 'post-group' }
  ),
  op(
    'patchPostGroupDraft',
    'post-groups drafts update',
    'PATCH',
    '/workspaces/{workspace_id}/post-groups/{group}/drafts/{channel}',
    { body: true, ifMatch: 'post-group-draft' }
  ),
  op(
    'deletePostGroupDraft',
    'post-groups drafts delete',
    'DELETE',
    '/workspaces/{workspace_id}/post-groups/{group}/drafts/{channel}',
    { ifMatch: 'post-group', idempotent: true, confirm: true }
  ),
  op(
    'attachPostGroupDraftAsset',
    'post-groups drafts assets attach',
    'PUT',
    '/workspaces/{workspace_id}/post-groups/{group}/drafts/{channel}/assets/{asset_id}',
    { ifMatch: 'post-group-draft' }
  ),
  op(
    'detachPostGroupDraftAsset',
    'post-groups drafts assets detach',
    'DELETE',
    '/workspaces/{workspace_id}/post-groups/{group}/drafts/{channel}/assets/{asset_id}',
    { ifMatch: 'post-group-draft', idempotent: true, confirm: true }
  ),
  op(
    'detachPostGroupAsset',
    'post-groups assets detach',
    'DELETE',
    '/workspaces/{workspace_id}/post-groups/{group}/assets/{asset_id}',
    { idempotent: true, confirm: true }
  ),
  op(
    'listDestinations',
    'destinations list',
    'GET',
    '/workspaces/{workspace_id}/destinations'
  ),
  op(
    'getDestination',
    'destinations show',
    'GET',
    '/workspaces/{workspace_id}/destinations/{destination_id}'
  ),
  op(
    'patchDestination',
    'destinations update',
    'PATCH',
    '/workspaces/{workspace_id}/destinations/{destination_id}',
    { body: true, ifMatch: 'destination' }
  ),
  op(
    'selectFacebookPage',
    'destinations facebook-page select',
    'PUT',
    '/workspaces/{workspace_id}/facebook-page',
    { body: true }
  ),
  op(
    'createDestinationConnectionSession',
    'connections connect',
    'POST',
    '/workspaces/{workspace_id}/destination-connection-sessions',
    { body: true, idempotent: true }
  ),
  op(
    'getDestinationConnectionSession',
    'connections sessions show',
    'GET',
    '/workspaces/{workspace_id}/destination-connection-sessions/{session_id}'
  ),
  op(
    'listProviderConnections',
    'connections list',
    'GET',
    '/workspaces/{workspace_id}/provider-connections'
  ),
  op(
    'getProviderConnection',
    'connections show',
    'GET',
    '/workspaces/{workspace_id}/provider-connections/{connection_id}'
  ),
  op(
    'refreshProviderConnections',
    'connections refresh',
    'POST',
    '/workspaces/{workspace_id}/provider-connections/refresh',
    { idempotent: true }
  ),
  op(
    'disconnectProviderConnection',
    'connections disconnect',
    'POST',
    '/workspaces/{workspace_id}/provider-connections/{connection_id}/disconnect',
    { body: true, idempotent: true, confirm: true }
  ),
  op(
    'getNotificationSettings',
    'notifications show',
    'GET',
    '/workspaces/{workspace_id}/notification-settings'
  ),
  op(
    'patchNotificationSettings',
    'notifications update',
    'PATCH',
    '/workspaces/{workspace_id}/notification-settings',
    { body: true }
  ),
  op(
    'createSlackConnectionSession',
    'notifications slack connect',
    'POST',
    '/workspaces/{workspace_id}/slack-connection-sessions',
    { idempotent: true }
  ),
  op(
    'getSlackConnectionSession',
    'notifications slack sessions show',
    'GET',
    '/workspaces/{workspace_id}/slack-connection-sessions/{session_id}'
  ),
  op(
    'disconnectSlackConnection',
    'notifications slack disconnect',
    'DELETE',
    '/workspaces/{workspace_id}/slack-connection',
    { body: true, idempotent: true, confirm: true }
  ),
  op(
    'listSlackChannels',
    'notifications slack channels',
    'GET',
    '/workspaces/{workspace_id}/slack-channels'
  ),
  op(
    'createSlackNotificationTest',
    'notifications slack test',
    'POST',
    '/workspaces/{workspace_id}/slack-notification-tests',
    { body: true, idempotent: true, confirm: true }
  ),
  op(
    'listPostGroupNotifications',
    'notifications list',
    'GET',
    '/workspaces/{workspace_id}/post-groups/{group}/notifications'
  ),
  op(
    'validatePostGroup',
    'post-groups validate',
    'POST',
    '/workspaces/{workspace_id}/post-groups/{group}/post-validations',
    { body: true }
  ),
  op(
    'publishPostGroup',
    'post-groups publish',
    'POST',
    '/workspaces/{workspace_id}/post-groups/{group}/posts',
    { body: true, idempotent: true, confirm: true }
  ),
  op(
    'listPostFeed',
    'posts feed',
    'GET',
    '/workspaces/{workspace_id}/post-feed',
    { paginated: true }
  ),
  op(
    'createPosts',
    'posts create',
    'POST',
    '/workspaces/{workspace_id}/posts',
    { body: true, idempotent: true }
  ),
  op(
    'validatePosts',
    'posts validate',
    'POST',
    '/workspaces/{workspace_id}/post-validations',
    { body: true }
  ),
  op(
    'getSendGroup',
    'posts submissions show',
    'GET',
    '/workspaces/{workspace_id}/send-groups/{send_group_id}'
  ),
  op('listPosts', 'posts list', 'GET', '/workspaces/{workspace_id}/posts', {
    paginated: true,
  }),
  op('getPost', 'posts show', 'GET', '/workspaces/{workspace_id}/posts/{post}'),
  op(
    'listPostAttempts',
    'posts attempts list',
    'GET',
    '/workspaces/{workspace_id}/posts/{post}/attempts',
    { paginated: true }
  ),
  op(
    'listPostReceipts',
    'posts receipts list',
    'GET',
    '/workspaces/{workspace_id}/posts/{post}/receipts',
    { paginated: true }
  ),
  op(
    'cancelPost',
    'posts cancel',
    'POST',
    '/workspaces/{workspace_id}/posts/{post}/cancel',
    { body: true, ifMatch: 'post', idempotent: true, confirm: true }
  ),
  op(
    'reschedulePost',
    'posts reschedule',
    'POST',
    '/workspaces/{workspace_id}/posts/{post}/reschedule',
    { body: true, ifMatch: 'post', idempotent: true, confirm: true }
  ),
  op(
    'retryPost',
    'posts retry',
    'POST',
    '/workspaces/{workspace_id}/posts/{post}/retry',
    { body: true, ifMatch: 'post', idempotent: true, confirm: true }
  ),
]

function op(id, command, method, path, options = {}) {
  return { id, command, method, path, ...options }
}

export const OPERATION_BY_COMMAND = new Map(
  OPERATIONS.map((operation) => [operation.command, operation])
)
