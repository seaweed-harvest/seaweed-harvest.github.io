import { authClient, requireAdminAccess } from "./auth_client.js";

const els = {};
document.addEventListener("DOMContentLoaded", init);

async function init() {
  ["receiptCount", "receiptStart", "receiptEnd", "receiptSearch", "loadReceipts", "receiptRows", "receiptStatus"].forEach((id) => { els[id] = document.getElementById(id); });
  const access = await requireAdminAccess("can_view_data"); if (!access) return;
  const end = new Date(); const start = new Date(end); start.setDate(start.getDate() - 29); els.receiptStart.value = inputDate(start); els.receiptEnd.value = inputDate(end);
  els.loadReceipts.addEventListener("click", loadReceipts); els.receiptSearch.addEventListener("keydown", (event) => { if (event.key === "Enter") loadReceipts(); }); await loadReceipts();
}

async function loadReceipts() {
  setStatus("Loading...");
  const { data, error } = await authClient.rpc("ag_admin_receipts", { p_start_at: startIso(els.receiptStart.value), p_end_at: endIso(els.receiptEnd.value), p_search: text(els.receiptSearch.value), p_limit: 500, p_offset: 0 });
  if (error) { setStatus(error.message, "error"); return; }
  const rows = data?.rows || []; els.receiptCount.textContent = `${data?.total_count || 0} receipts`;
  els.receiptRows.innerHTML = rows.map((row) => `<tr><td>${html(dateTime(row.issued_at))}</td><td><strong>${html(row.receipt_number)}</strong></td><td>${html([row.farmer_id_snapshot, row.farmer_name_snapshot].filter(Boolean).join(" - ") || "-")}</td><td>${html(row.community_name_snapshot || "-")}</td><td>${html(row.seaweed_type_snapshot)}</td><td>${html(row.grade_snapshot || "-")}</td><td>${html(title(row.product_form_snapshot))}</td><td>${number(row.weight_kg_snapshot)}</td><td>${number(row.unit_price_snapshot)}</td><td>${number(row.total)} ${html(row.currency)}</td><td>${html(title(row.status))}</td><td>${html(title(row.payment_status))}</td><td>${delivery(row)}</td><td><a class="table-action-link" href="./receipt.html?id=${encodeURIComponent(row.id)}">View</a></td></tr>`).join("") || '<tr><td colspan="14">No receipts in this period.</td></tr>';
  setStatus(`${rows.length} rows. Receipt delivery remains queued until an email or SMS provider is configured.`);
}

function delivery(row) { if (!Number(row.notification_jobs)) return "None"; if (Number(row.notifications_failed)) return `${row.notifications_failed} failed`; if (Number(row.notifications_sent) === Number(row.notification_jobs)) return "Sent"; return `${row.notification_jobs} queued`; }
function inputDate(date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; }
function startIso(value) { return value ? new Date(`${value}T00:00:00+03:00`).toISOString() : null; }
function endIso(value) { if (!value) return null; const date = new Date(`${value}T00:00:00+03:00`); date.setDate(date.getDate() + 1); return date.toISOString(); }
function text(value) { return String(value || "").trim() || null; }
function number(value) { return Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 2 }); }
function dateTime(value) { return value ? new Date(value).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }) : "-"; }
function title(value) { return String(value || "-").replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()); }
function setStatus(message, type = "") { els.receiptStatus.textContent = message || ""; els.receiptStatus.dataset.status = type; }
function html(value) { return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;"); }
