export const FAVORITE_FORMS = [
  {
    key: "collection",
    label: "Collection",
    description: "Record harvested seaweed",
    href: "./collection.html",
    permission: "can_submit_collection"
  },
  {
    key: "process_record",
    label: "Process Record",
    description: "Record processing weights, output, and production checks",
    href: "./process_record.html",
    permission: "can_submit_collection"
  },
  {
    key: "stabilization_packing",
    label: "BioStim Stock Record",
    description: "Record stabilisation, stock weight, and QC measurements",
    href: "./stabilization_packing.html",
    permission: "can_submit_collection"
  },
  {
    key: "site_water_sample",
    label: "Site Water Sample",
    description: "Record spring tide water measurements",
    href: "./site_water_sample.html",
    permission: "can_submit_collection"
  },
  {
    key: "reef_nursery",
    label: "Reef Nursery",
    description: "Record nursery training sessions and participants",
    href: "./reef_nursery.html",
    permission: "can_access_reef_nursery"
  }
];

const FAVORITE_KEYS = new Set(FAVORITE_FORMS.map((form) => form.key));

export function favoriteFormKeys(profile) {
  const stored = profile?.dashboard_preferences?.favorite_forms;
  if (!Array.isArray(stored)) return [];
  return [...new Set(stored.map(String).filter((key) => FAVORITE_KEYS.has(key)))];
}

export function availableFavoriteForms(profile) {
  return FAVORITE_FORMS.filter((form) => hasPermission(profile, form.permission));
}

export async function saveFavoriteForms(client, keys) {
  const cleanKeys = [...new Set(keys.map(String).filter((key) => FAVORITE_KEYS.has(key)))];
  const { data, error } = await client.rpc("ag_update_my_favorite_forms", {
    p_form_keys: cleanKeys
  });
  if (error) throw error;
  return data;
}

export function setupFavoriteFormButton({ button, formKey, profile, client, returnPage }) {
  if (!button || !FAVORITE_KEYS.has(formKey)) return null;

  let activeProfile = profile || null;
  let savedKeys = new Set(favoriteFormKeys(activeProfile));
  const form = FAVORITE_FORMS.find((item) => item.key === formKey);

  const render = () => {
    const saved = savedKeys.has(formKey);
    const signedIn = Boolean(activeProfile);
    button.classList.toggle("is-favorite", saved);
    button.setAttribute("aria-pressed", String(saved));
    button.dataset.favoriteState = saved ? "saved" : "available";
    const action = saved ? "Remove" : "Add";
    const label = signedIn
      ? `${action} ${form.label} ${saved ? "from" : "to"} dashboard`
      : `Sign in to add ${form.label} to dashboard`;
    button.setAttribute("aria-label", label);
    button.title = label;
  };

  button.addEventListener("click", async () => {
    if (!activeProfile || !client) {
      const destination = returnPage || window.location.pathname.split("/").pop() || form.href.slice(2);
      window.location.assign(`./login.html?return=${encodeURIComponent(destination)}`);
      return;
    }

    const wasSaved = savedKeys.has(formKey);
    if (wasSaved) savedKeys.delete(formKey);
    else savedKeys.add(formKey);
    button.disabled = true;
    render();

    try {
      const updatedProfile = await saveFavoriteForms(client, [...savedKeys]);
      if (updatedProfile) activeProfile = updatedProfile;
      savedKeys = new Set(favoriteFormKeys(activeProfile));
      document.dispatchEvent(new CustomEvent("seaweed-favorite-forms-changed", {
        detail: { keys: [...savedKeys], profile: activeProfile }
      }));
    } catch (error) {
      if (wasSaved) savedKeys.add(formKey);
      else savedKeys.delete(formKey);
      window.alert(error.message || "The dashboard shortcut could not be saved.");
    } finally {
      button.disabled = false;
      render();
    }
  });

  render();
  return { get keys() { return [...savedKeys]; } };
}

export function renderFavoriteForms(container, profile) {
  if (!container) return [];
  const saved = new Set(favoriteFormKeys(profile));
  const forms = availableFavoriteForms(profile).filter((form) => saved.has(form.key));
  container.hidden = forms.length === 0;

  const links = container.querySelector("[data-favorite-form-links]");
  if (links) {
    links.innerHTML = forms.map((form) => `
      <a class="dashboard-form-shortcut" href="${form.href}">
        <span class="dashboard-form-shortcut-icon" aria-hidden="true">${starSvg()}</span>
        <span><strong>${escapeHtml(form.label)}</strong><small>${escapeHtml(form.description)}</small></span>
        <span class="dashboard-form-shortcut-arrow" aria-hidden="true">&rsaquo;</span>
      </a>
    `).join("");
  }
  return forms;
}

function hasPermission(profile, permission) {
  if (permission === "can_access_reef_nursery") return Boolean(profile?.can_access_reef_nursery);
  return profile?.app_role === "system_admin" || Boolean(profile?.[permission]);
}

function starSvg() {
  return '<svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m12 2.8 2.8 5.7 6.3.9-4.6 4.4 1.1 6.3-5.6-3-5.6 3 1.1-6.3-4.6-4.4 6.3-.9L12 2.8Z"></path></svg>';
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
