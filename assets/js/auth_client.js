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
let aggregatorContextPromise = null;

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

export async function currentAggregatorContext(force = false) {
  if (!aggregatorContextPromise || force) {
    aggregatorContextPromise = authClient.rpc("ag_my_aggregator_context").then(({ data, error }) => {
      if (error) throw error;
      return data || { active_aggregator: null, aggregators: [] };
    });
  }
  return aggregatorContextPromise;
}

export async function setActiveAggregator(aggregatorId) {
  const { data, error } = await authClient.rpc("ag_set_active_aggregator", {
    p_aggregator_id: aggregatorId
  });
  if (error) throw error;
  aggregatorContextPromise = Promise.resolve(data);
  profilePromise = null;
  return data;
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

export async function requireCollectionAccess() {
  const session = await currentSession();
  if (!session) {
    window.location.replace("./login.html?return=collection.html");
    return null;
  }

  const { data: userData, error: userError } = await authClient.auth.getUser();
  if (userError) throw userError;
  if (userData.user?.user_metadata?.must_change_password) {
    window.location.replace("./login.html?mode=change&return=collection.html");
    return null;
  }

  const profile = await currentProfile(true);
  const allowed = profile?.account_status === "active"
    && (profile.app_role === "system_admin" || profile.can_submit_collection);

  if (!allowed) {
    window.location.replace(profile?.app_role === "farmer_viewer" ? "./farmer.html" : "./access_pending.html");
    return null;
  }

  return { session, profile };
}

export async function requireAuthenticatedAccount(returnPage = "my_details.html") {
  const session = await currentSession();
  if (!session) {
    window.location.replace(`./login.html?return=${encodeURIComponent(returnPage)}`);
    return null;
  }

  const { data: userData, error: userError } = await authClient.auth.getUser();
  if (userError) throw userError;
  if (userData.user?.user_metadata?.must_change_password) {
    window.location.replace(`./login.html?mode=change&return=${encodeURIComponent(returnPage)}`);
    return null;
  }

  const profile = await currentProfile(true);
  if (!profile) throw new Error("User profile was not found.");
  return { session, profile };
}

export function setupAccountControls(profile, options = {}) {
  const controls = options.container
    || document.querySelector(".admin-header-controls")
    || document.querySelector(".header-actions");
  if (!controls || controls.querySelector(".account-controls")) return null;

  const account = document.createElement("div");
  account.className = "account-controls";

  const menu = document.createElement("details");
  menu.className = "account-menu";
  const trigger = document.createElement("summary");
  trigger.className = "account-menu-trigger";
  trigger.setAttribute("aria-label", "Open profile menu");
  const avatar = document.createElement("span");
  avatar.className = "account-avatar";
  avatar.setAttribute("aria-hidden", "true");
  const menuLabel = document.createElement("span");
  menuLabel.className = "account-menu-label";
  const chevron = document.createElement("span");
  chevron.className = "account-menu-chevron";
  chevron.setAttribute("aria-hidden", "true");
  trigger.append(avatar, menuLabel, chevron);

  const popover = document.createElement("div");
  popover.className = "account-menu-popover";
  const identity = document.createElement("div");
  identity.className = "account-menu-identity";
  const name = document.createElement("span");
  name.className = "account-name";
  name.textContent = profile.display_name || profile.email;
  const email = document.createElement("span");
  email.className = "account-email";
  email.textContent = profile.email || "";
  identity.append(name, email);

  const detailsLink = document.createElement("a");
  detailsLink.className = "account-menu-item";
  detailsLink.href = "./my_details.html";
  const signOutButton = document.createElement("button");
  signOutButton.type = "button";
  signOutButton.className = "account-menu-item account-menu-signout";
  signOutButton.addEventListener("click", async () => {
    signOutButton.disabled = true;
    await signOut();
    window.location.replace(options.signOutReturn || "./index.html");
  });

  const applyLabels = () => {
    const labels = typeof options.labels === "function" ? options.labels() : options.labels || {};
    menuLabel.textContent = labels.me || "Me";
    detailsLink.textContent = labels.myDetails || "Profile settings";
    signOutButton.textContent = labels.signOut || "Sign out";
  };
  applyLabels();
  if (options.languageEvent) document.addEventListener(options.languageEvent, applyLabels);

  popover.append(identity);
  if (options.showMyDetails !== false) popover.append(detailsLink);
  popover.append(signOutButton);
  menu.append(trigger, popover);
  account.append(menu);
  controls.append(account);
  document.addEventListener("click", (event) => {
    if (menu.open && !menu.contains(event.target)) menu.open = false;
  });
  menu.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    menu.open = false;
    trigger.focus();
  });
  setupAggregatorControl(account, options).catch(() => {});
  return account;
}

async function setupAggregatorControl(account, options) {
  if (options.showAggregator === false || account.querySelector(".aggregator-context-control")) return;
  const context = await currentAggregatorContext();
  const rows = context?.aggregators || [];
  if (!rows.length) return;

  const wrapper = document.createElement("label");
  wrapper.className = "aggregator-context-control";
  wrapper.title = "Active aggregator";
  const active = context.active_aggregator;

  if (rows.length === 1) {
    const badge = document.createElement("span");
    badge.className = "aggregator-context-badge";
    badge.textContent = active?.short_name || active?.organisation_name || rows[0].short_name || rows[0].organisation_name;
    wrapper.append(badge);
  } else {
    const select = document.createElement("select");
    select.setAttribute("aria-label", "Active aggregator");
    rows.forEach((row) => {
      const option = document.createElement("option");
      option.value = row.id;
      option.textContent = row.short_name || row.organisation_name;
      option.selected = row.id === context.active_aggregator_id;
      select.append(option);
    });
    select.addEventListener("change", async () => {
      select.disabled = true;
      try {
        await setActiveAggregator(select.value);
        window.location.reload();
      } catch (error) {
        select.disabled = false;
        window.alert(error.message);
      }
    });
    wrapper.append(select);
  }

  account.insertBefore(wrapper, account.firstChild);
  document.dispatchEvent(new CustomEvent("seaweed-aggregator-context-ready", { detail: context }));
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

export async function signUpAccount(email, password, details) {
  const { data, error } = await authClient.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: `${siteBaseUrl()}/register.html?confirmed=1`,
      data: {
        registration_type: "account_self",
        full_name: details.full_name,
        phone: details.phone || null,
        requested_role: details.requested_role || "farmer_viewer",
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

export async function signUpFarmer(email, password, details) {
  return signUpAccount(email, password, { ...details, requested_role: "farmer_viewer" });
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

export async function updateMyDetails(details) {
  const { data, error } = await authClient.rpc("ag_update_my_details", {
    p_display_name: details.display_name,
    p_phone: details.phone || null,
    p_address: details.address || null,
    p_date_of_birth: details.date_of_birth || null
  });
  if (error) throw error;
  profilePromise = Promise.resolve(data);
  return data;
}

export async function signOut() {
  const { error } = await authClient.auth.signOut();
  if (error) throw error;
  profilePromise = null;
  aggregatorContextPromise = null;
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
  if (profile?.app_role === "field_collector") return "./collector_dashboard.html";
  if (profile?.app_role === "community_viewer") return "./my_details.html";
  if (profile?.app_role === "system_admin" || profile?.can_view_dashboard) return "./admin.html";
  if (profile?.can_view_registry) return "./admin_member_registry.html";
  if (profile?.can_view_map) return "./admin_map.html";
  if (profile?.can_view_data) return "./admin_today.html";
  if (profile?.can_view_finance) return "./admin_finance.html";
  if (profile?.can_manage_users) return "./admin_users.html";
  if (profile?.can_manage_settings) return "./admin_builder.html";
  if (profile?.can_view_notifications) return "./admin_notifications.html";
  if (profile?.can_manage_sms_settings) return "./admin_seaweedke.html";
  if (profile?.can_submit_collection) return "./collector_dashboard.html";
  return "./access_pending.html";
}

function currentPage() {
  const file = window.location.pathname.split("/").pop() || "index.html";
  return `${file}${window.location.search}`;
}
