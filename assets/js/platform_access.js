import { authClient } from "./auth_client.js?v=22";

const ROLE_RANK = Object.freeze({ user: 10, operator: 20, admin: 30 });
let accessPromise = null;

export async function currentApplicationAccess(force = false) {
  if (!accessPromise || force) {
    accessPromise = authClient.rpc("platform_my_app_access").then(({ data, error }) => {
      if (error) throw error;
      return data && typeof data === "object" ? data : {};
    });
  }
  return accessPromise;
}

export async function applicationAccess(appKey, force = false) {
  const access = await currentApplicationAccess(force);
  return access?.[String(appKey || "").trim().toLowerCase()] || null;
}

export async function hasApplicationAccess(appKey, minimumRole = "user", force = false) {
  const grant = await applicationAccess(appKey, force);
  if (!grant?.role) return false;
  return roleRank(grant.role) >= roleRank(minimumRole) && roleRank(minimumRole) > 0;
}

export function clearApplicationAccessCache() {
  accessPromise = null;
}

export function roleRank(role) {
  return ROLE_RANK[String(role || "").trim().toLowerCase()] || 0;
}
