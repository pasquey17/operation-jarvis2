/**
 * User scoping for Supabase queries — auth_user_id (UUID) is canonical.
 * Legacy `user_id` (email) columns remain in the DB for rollback only.
 */

export const USER_SCOPE_COLUMN = "auth_user_id";

/** PostgREST filter: auth_user_id=eq.{uuid} */
export function userScopeEq(authUserId) {
  return `${USER_SCOPE_COLUMN}=eq.${encodeURIComponent(authUserId)}`;
}

/** Append &auth_user_id=eq.{uuid} to an endpoint that already has ?params */
export function withUserScopeQuery(baseEndpoint, authUserId) {
  const sep = baseEndpoint.includes("?") ? "&" : "?";
  return `${baseEndpoint}${sep}${userScopeEq(authUserId)}`;
}
