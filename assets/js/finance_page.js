import { APP_CONFIG } from "./config.js";
import { authClient, requireAdminAccess } from "./auth_client.js";
import { selectRows } from "./supabase_client.js";

const els = {};
let rows = [];
let profile = null;

document.addEventListener("DOMContentLoaded", init);

async function init() {
  ["financeStartDate", "financeEndDate", "financeCommunity", "loadFinanceReview", "exportFinanceReview", "financeEstimatedKsh", "financeAcceptedKg", "financeRejectedKg", "financeCollectionCount", "financeMemberCount", "financeCommunityCount", "financeReviewRows", "financeStatus"].forEach((id) => { els[id] = document.getElementById(id); });
  const access = await requireAdminAccess("can_view_finance");
  if (!access) return;
  profile = access.profile;
  setDefaultDates();
  els.loadFinanceReview.addEventListener("click", loadReview);
  els.exportFinanceReview.addEventListener("click", exportCsv);
  els.exportFinanceReview.hidden = profile.app_role !== "system_admin" && !profile.can_export_data;
  await loadCommunities();
  await loadReview();
}

async function loadCommunities() {
  const communities = await selectRows(APP_CONFIG.tables.communities, "select=community_id,community_name&order=community_name.asc");
  els.financeCommunity.insertAdjacentHTML("beforeend", communities.map((row) => `<option value="${html(row.community_id)}">${html(row.community_id)} - ${html(row.community_name)}</option>`).join(""));
}

async function loadReview() {
  setStatus("Loading...");
  const { data, error } = await authClient.rpc("ag_sec_finance_review", buildPayload());
  if (error) { setStatus(error.message, "error"); return; }
  rows = data?.rows || [];
  renderSummary(data?.summary || {});
  renderRows();
  setStatus(`${rows.length} rows. Values are estimated, not payment confirmation.`);
}

function renderSummary(summary) {
  setText("financeEstimatedKsh", formatNumber(summary.estimated_ksh)); setText("financeAcceptedKg", formatNumber(summary.accepted_kg)); setText("financeRejectedKg", formatNumber(summary.rejected_kg)); setText("financeCollectionCount", formatNumber(summary.collection_count, 0)); setText("financeMemberCount", formatNumber(summary.member_count, 0)); setText("financeCommunityCount", formatNumber(summary.community_count, 0));
}

function renderRows() {
  els.financeReviewRows.innerHTML = rows.length ? rows.map((row) => `<tr><td>${html(row.farmer_id || "-")}</td><td>${html(row.farmer_name || "-")}</td><td>${html(row.community_id || "-")}</td><td>${html(row.community_name || "-")}</td><td>${html(formatNumber(row.collection_count, 0))}</td><td>${html(formatNumber(row.accepted_kg))}</td><td>${html(formatNumber(row.rejected_kg))}</td><td>${html(formatNumber(row.estimated_ksh))}</td><td>${html(formatDate(row.last_collection_at))}</td></tr>`).join("") : '<tr><td colspan="9">No collection values in this period.</td></tr>';
}

function exportCsv() {
  const columns = ["farmer_id", "farmer_name", "community_id", "community_name", "collection_count", "accepted_kg", "rejected_kg", "estimated_ksh", "last_collection_at"];
  const csv = [columns.join(","), ...rows.map((row) => columns.map((key) => csvCell(row[key])).join(","))].join("\r\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a"); link.href = url; link.download = `seaweed-finance-review-${els.financeStartDate.value}-${els.financeEndDate.value}.csv`; document.body.append(link); link.click(); link.remove(); URL.revokeObjectURL(url);
}

function buildPayload() { return { p_start_at: startIso(els.financeStartDate.value), p_end_at: endExclusiveIso(els.financeEndDate.value), p_community_id: els.financeCommunity.value || null }; }
function setDefaultDates() { const end = new Date(); const start = new Date(end); start.setDate(start.getDate() - 29); els.financeStartDate.value = dateInput(start); els.financeEndDate.value = dateInput(end); }
function startIso(value) { return value ? new Date(`${value}T00:00:00+03:00`).toISOString() : null; }
function endExclusiveIso(value) { if (!value) return null; const date = new Date(`${value}T00:00:00+03:00`); date.setDate(date.getDate() + 1); return date.toISOString(); }
function dateInput(date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; }
function formatNumber(value, digits = 2) { const number = Number(value); return Number.isFinite(number) ? number.toLocaleString(undefined, { maximumFractionDigits: digits }) : "-"; }
function formatDate(value) { if (!value) return "-"; const date = new Date(value); return Number.isNaN(date.getTime()) ? "-" : date.toLocaleDateString([], { dateStyle: "medium" }); }
function csvCell(value) { const text = String(value ?? ""); return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text; }
function setText(id, value) { document.getElementById(id).textContent = value; }
function setStatus(message, type = "") { els.financeStatus.textContent = message || ""; els.financeStatus.dataset.status = type; }
function html(value) { return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;"); }
