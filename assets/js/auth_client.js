import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.110.2/+esm";
import { APP_CONFIG } from "./config.js";

export const authClient = createClient(APP_CONFIG.supabase.url, APP_CONFIG.supabase.anonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storageKey: "seaweed-ag-auth"
  }
});

let profilePromise = null;

export async function currentSession() {
  const { data, error } = await authClient.auth.getSession();
  if (error) throw error;
  return data.session;
}

export async function currentAccessToken() {
  const session = await currentSession();
  return session?.access_token || APP_CONFIG.supabase.anonKey;
}

export async function currentProfile(force = false) {
  if (!profilePromise || force) {
    profilePromise = authClient.rpc("ag_my_profile").then(({ data, error }) => {
      if (error) throw error;
      return data && Object.keys(data).length ? data : null;
    });
  }
  return profilePromise;
}

export async function requireAdminAccess(permission = "can_access_admin") {
  const session = await currentSession();
  if (!session) {
    window.location.replace(`./login.html?return=${encodeURIComponent(currentPage())}`);
    return null;
  }

  const { data: userData, error: userError } = await authClient.auth.getUser();
  if (userError) throw userError;
  if (userData.user?.user_metadata?.must_change_password) {
    window.location.replace(`./login.html?mode=change&return=${encodeURIComponent(currentPage())}`);
    return null;
  }

  const profile = await currentProfile(true);
  const isSystemAdmin = profile?.app_role === "system_admin";
  const allowed = profile?.account_status === "active"
    && (isSystemAdmin || (profile.can_access_admin && profile[permission]));

  if (!allowed) {
    window.location.replace(profile?.app_role === "farmer_viewer" ? "./farmer.html" : "./access_pending.html");
    return null;
  }

  return { session, profile };
}

export async function signInWithPassword(email, password) {
  const { data, error } = await authClient.auth.signInWithPassword({ email, password });
  if (error) throw error;
  profilePromise = null;
  return data;
}

export async function recordLogin(loginMethod = "session") {
  const { data, error } = await authClient.rpc("ag_record_login", {
    p_login_method: loginMethod,
    p_user_agent: navigator.userAgent
  });
  if (error) throw error;
  return data;
}

export async function signUpFarmer(email, password, details) {
  const { data, error } = await authClient.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: `${siteBaseUrl()}/register.html?confirmed=1`,
      data: {
        registration_type: "farmer_self",
        full_name: details.full_name,
        phone: details.phone || null,
        requested_farmer_id: details.requested_farmer_id || null,
        requested_community_id: details.requested_community_id || null,
        farm_size_value: details.farm_size_value ?? null,
        farm_size_unit: details.farm_size_unit || "lines"
      }
    }
  });
  if (error) throw error;
  profilePromise = null;
  return data;
}

export async function signInWithProvider(provider, returnPage = "login.html") {
  const { data, error } = await authClient.auth.signInWithOAuth({
    provider,
    options: { redirectTo: `${siteBaseUrl()}/${returnPage}` }
  });
  if (error) throw error;
  return data;
}

export async function sendPasswordReset(email) {
  const { data, error } = await authClient.auth.resetPasswordForEmail(email, {
    redirectTo: `${siteBaseUrl()}/login.html?mode=recovery`
  });
  if (error) throw error;
  return data;
}

export async function updatePassword(password, displayName) {
  const { data, error } = await authClient.auth.updateUser({
    password,
    data: {
      full_name: displayName,
      must_change_password: false
    }
  });
  if (error) throw error;
  return data;
}

export async function updateMyDisplayName(displayName) {
  const { data, error } = await authClient.rpc("ag_update_my_display_name", {
    p_display_name: displayName
  });
  if (error) throw error;
  profilePromise = null;
  return data;
}

export async function signOut() {
  const { error } = await authClient.auth.signOut();
  if (error) throw error;
  profilePromise = null;
}

export async function invokeAdminUsers(payload) {
  const { data, error } = await authClient.functions.invoke("admin-users", { body: payload });
  if (error) {
    let message = error.message;
    try {
      const body = await error.context?.json();
      message = body?.error || message;
    } catch {
      // Keep the client error when no JSON response is available.
    }
    throw new Error(message);
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

export async function enabledSocialProviders() {
  try {
    const response = await fetch(`${APP_CONFIG.supabase.url}/auth/v1/settings`, {
      headers: { apikey: APP_CONFIG.supabase.anonKey }
    });
    if (!response.ok) throw new Error("Auth settings unavailable");
    const settings = await response.json();
    return {
      google: Boolean(settings.external?.google),
      facebook: Boolean(settings.external?.facebook)
    };
  } catch {
    return {
      google: Boolean(APP_CONFIG.auth?.providers?.google),
      facebook: Boolean(APP_CONFIG.auth?.providers?.facebook)
    };
  }
}

export function siteBaseUrl() {
  const url = new URL(".", window.location.href);
  return url.href.replace(/\/$/, "");
}

export function routeForProfile(profile) {
  if (profile?.account_status !== "active") return "./access_pending.html";
  if (profile?.app_role === "farmer_viewer") return "./farmer.html";
  if (profile?.app_role === "system_admin" || profile?.can_view_dashboard) return "./admin.html";
  if (profile?.can_view_registry) return "./admin_member_registry.html";
  if (profile?.can_view_map) return "./admin_map.html";
  if (profile?.can_view_data) return "./admin_today.html";
  if (profile?.can_view_finance) return "./admin_finance.html";
  if (profile?.can_manage_users) return "./admin_users.html";
  if (profile?.can_manage_settings) return "./admin_builder.html";
  return "./index.html";
}

function currentPage() {
  const file = window.location.pathname.split("/").pop() || "admin.html";
  return `${file}${window.location.search}`;
}
