import {
  authClient,
  requireAuthenticatedAccount,
  routeForProfile,
  setupAccountControls
} from "./auth_client.js?v=23";
import { populateAppSidebar, setupAppNavigation } from "./app_navigation.js?v=8";

const OWNER_EMAIL = "bmichael@cascadiaseaweed.com";
const PHOTO_BUCKET = "site-feedback-photos";
const state = { rows: [], profile: null };
const els = {};

document.addEventListener("DOMContentLoaded", init);

async function init() {
  [
    "suggestionsSidebar", "suggestionsCount", "suggestionsSearch",
    "suggestionsStatusFilter", "loadSuggestions", "suggestionsPageStatus",
    "suggestionsList", "suggestionPhotoDialog", "suggestionPhotoImage",
    "closeSuggestionPhoto"
  ].forEach((id) => { els[id] = document.getElementById(id); });

  try {
    const access = await requireAuthenticatedAccount("admin_suggestions.html");
    if (!access) return;
    const email = String(access.profile?.email || access.session?.user?.email || "").toLowerCase();
    if (email !== OWNER_EMAIL) {
      window.location.replace("./access_pending.html");
      return;
    }
    state.profile = access.profile;
    setupAccountControls(state.profile);
    const dashboardHref = routeForProfile(state.profile);
    const sidebar = populateAppSidebar(els.suggestionsSidebar, {
      profile: state.profile,
      dashboardHref
    });
    setupAppNavigation({ profile: state.profile, sidebar, dashboardHref });
    bindEvents();
    document.body.removeAttribute("data-auth-pending");
    await loadSuggestions();
  } catch (error) {
    document.body.removeAttribute("data-auth-pending");
    setStatus(error.message || "Suggestions could not be opened.", "error");
  }
}

function bindEvents() {
  els.loadSuggestions.addEventListener("click", loadSuggestions);
  els.suggestionsSearch.addEventListener("keydown", (event) => {
    if (event.key === "Enter") loadSuggestions();
  });
  els.suggestionsList.addEventListener("click", handleSuggestionAction);
  els.closeSuggestionPhoto.addEventListener("click", closePhoto);
  els.suggestionPhotoDialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    closePhoto();
  });
}

async function loadSuggestions() {
  setStatus("Loading suggestions...");
  els.loadSuggestions.disabled = true;
  const { data, error } = await authClient.rpc("ag_owner_site_feedback", {
    p_status: els.suggestionsStatusFilter.value || null,
    p_search: els.suggestionsSearch.value.trim() || null,
    p_limit: 200
  });
  els.loadSuggestions.disabled = false;
  if (error) {
    setStatus(error.message || "Suggestions could not be loaded.", "error");
    return;
  }
  state.rows = Array.isArray(data) ? data : [];
  renderSuggestions();
  setStatus("");
}

function renderSuggestions() {
  els.suggestionsList.replaceChildren();
  els.suggestionsCount.textContent = `${state.rows.length} ${state.rows.length === 1 ? "suggestion" : "suggestions"}`;
  if (!state.rows.length) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "No suggestions match these filters.";
    els.suggestionsList.append(empty);
    return;
  }

  state.rows.forEach((row) => {
    const article = document.createElement("article");
    article.className = "suggestion-item";
    article.dataset.suggestionId = row.id;
    article.innerHTML = `
      <header class="suggestion-item-head">
        <div>
          <span class="suggestion-type suggestion-type-${escapeHtml(row.feedback_type)}">${escapeHtml(typeLabel(row.feedback_type))}</span>
          <strong>${escapeHtml(row.source_page || "Unknown page")}</strong>
        </div>
        <time datetime="${escapeHtml(row.created_at)}">${escapeHtml(formatDateTime(row.created_at))}</time>
      </header>
      <p class="suggestion-message">${escapeHtml(row.message)}</p>
      <dl class="suggestion-meta">
        <div><dt>From</dt><dd>${escapeHtml(row.submitter_name || row.submitter_email || "Anonymous")}</dd></div>
        <div><dt>Product</dt><dd>${escapeHtml(row.source_app === "tide" ? "Tide Planner" : "Seaweed Harvest")}</dd></div>
        <div><dt>Review</dt><dd>${escapeHtml(reviewLabel(row.review_decision))}</dd></div>
        <div><dt>Slack</dt><dd>${escapeHtml(row.slack_status || "-")}</dd></div>
      </dl>
      <div class="suggestion-links">
        ${row.page_url ? `<a href="${escapeAttribute(row.page_url)}" target="_blank" rel="noopener noreferrer">Open page</a>` : ""}
        ${row.photo_path ? `<button type="button" data-view-suggestion-photo="${escapeAttribute(row.photo_path)}">View screenshot</button>` : ""}
      </div>
      <div class="suggestion-workflow">
        <label>Status
          <select data-suggestion-status>
            ${statusOptions(row.status)}
          </select>
        </label>
        <label>Review
          <select data-suggestion-review>
            ${reviewOptions(row.review_decision)}
          </select>
        </label>
        <button type="button" data-save-suggestion>Save</button>
      </div>`;
    els.suggestionsList.append(article);
  });
}

async function handleSuggestionAction(event) {
  const photoButton = event.target.closest("[data-view-suggestion-photo]");
  if (photoButton) {
    await showPhoto(photoButton.dataset.viewSuggestionPhoto);
    return;
  }
  const saveButton = event.target.closest("[data-save-suggestion]");
  if (!saveButton) return;
  const item = saveButton.closest("[data-suggestion-id]");
  saveButton.disabled = true;
  setStatus("Saving suggestion...");
  const { error } = await authClient.rpc("ag_owner_update_site_feedback", {
    p_feedback_id: item.dataset.suggestionId,
    p_status: item.querySelector("[data-suggestion-status]").value,
    p_review_decision: item.querySelector("[data-suggestion-review]").value
  });
  saveButton.disabled = false;
  if (error) {
    setStatus(error.message || "Suggestion could not be updated.", "error");
    return;
  }
  await loadSuggestions();
  setStatus("Suggestion updated.", "success");
}

async function showPhoto(path) {
  setStatus("Opening screenshot...");
  const { data, error } = await authClient.storage.from(PHOTO_BUCKET).createSignedUrl(path, 300);
  if (error || !data?.signedUrl) {
    setStatus(error?.message || "Screenshot could not be opened.", "error");
    return;
  }
  els.suggestionPhotoImage.src = data.signedUrl;
  if (typeof els.suggestionPhotoDialog.showModal === "function") els.suggestionPhotoDialog.showModal();
  else els.suggestionPhotoDialog.setAttribute("open", "");
  setStatus("");
}

function closePhoto() {
  if (typeof els.suggestionPhotoDialog.close === "function") els.suggestionPhotoDialog.close();
  else els.suggestionPhotoDialog.removeAttribute("open");
  els.suggestionPhotoImage.removeAttribute("src");
}

function statusOptions(selected) {
  return [
    ["new", "New"],
    ["reviewing", "Reviewing"],
    ["planned", "Planned"],
    ["closed", "Closed"]
  ].map(([value, label]) => `<option value="${value}"${value === selected ? " selected" : ""}>${label}</option>`).join("");
}

function reviewOptions(selected) {
  return [
    ["approved", "Approved"],
    ["review_required", "Review required"],
    ["flagged", "Flagged"]
  ].map(([value, label]) => `<option value="${value}"${value === selected ? " selected" : ""}>${label}</option>`).join("");
}

function typeLabel(value) {
  return { improvement: "Improvement", change: "Change", problem: "Problem" }[value] || value || "Suggestion";
}

function reviewLabel(value) {
  return { approved: "Approved", review_required: "Review required", flagged: "Flagged" }[value] || value || "-";
}

function formatDateTime(value) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Africa/Nairobi"
  }).format(new Date(value));
}

function setStatus(message, kind = "") {
  els.suggestionsPageStatus.textContent = message;
  if (kind) els.suggestionsPageStatus.dataset.status = kind;
  else delete els.suggestionsPageStatus.dataset.status;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
  })[character]);
}

function escapeAttribute(value) {
  return escapeHtml(value);
}
