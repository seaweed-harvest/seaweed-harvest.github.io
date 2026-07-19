import { authClient, requireAuthenticatedAccount, routeForProfile, setupAccountControls } from "./auth_client.js?v=18";

document.addEventListener("DOMContentLoaded", init);

async function init() {
  const status = document.getElementById("receiptLoadStatus");
  try {
    const access = await requireAuthenticatedAccount(`receipt.html${window.location.search}`); if (!access) return;
    document.body.removeAttribute("data-auth-pending"); setupAccountControls(access.profile, { container: document.querySelector(".receipt-header-controls"), returnPage: `receipt.html${window.location.search}` });
    document.getElementById("receiptHome").href = routeForProfile(access.profile);
    const receiptId = new URLSearchParams(window.location.search).get("id"); if (!receiptId) throw new Error("Receipt ID is missing.");
    const { data, error } = await authClient.rpc("ag_my_receipt", { p_receipt_id: receiptId }); if (error) throw error;
    render(data); status.hidden = true; document.getElementById("receiptDocument").hidden = false;
    document.getElementById("printReceipt").addEventListener("click", () => window.print());
  } catch (error) { status.textContent = error.message; status.dataset.status = "error"; }
}

function render(row) {
  set("receiptAggregator", row.aggregator_name_snapshot); optional("receiptAggregatorContact", row.aggregator_contact_snapshot); set("receiptNumber", row.receipt_number); set("receiptIssuedAt", dateTime(row.issued_at)); set("receiptFarmer", [row.farmer_id_snapshot, row.farmer_name_snapshot].filter(Boolean).join(" - ") || "-"); set("receiptCommunity", [row.community_id_snapshot, row.community_name_snapshot].filter(Boolean).join(" - ") || "-"); set("receiptCollector", row.collector_name_snapshot || "-"); set("receiptType", title(row.seaweed_type_snapshot)); set("receiptGrade", row.grade_snapshot || "-"); set("receiptForm", title(row.product_form_snapshot)); set("receiptWeight", `${number(row.weight_kg_snapshot)} kg`); set("receiptUnitPrice", `${number(row.unit_price_snapshot)} ${row.currency}`); set("receiptTotal", `${number(row.total)} ${row.currency}`); set("receiptCollectedAt", dateTime(row.collected_at)); set("receiptTransaction", row.transaction_id || "-"); set("receiptSack", row.sack_id || "-"); set("receiptPayment", title(row.payment_status));
  const notes = document.getElementById("receiptNotes"); notes.textContent = row.notes || ""; notes.hidden = !row.notes;
}
function set(id, value) { document.getElementById(id).textContent = value || "-"; }
function optional(id, value) { const element = document.getElementById(id); element.textContent = value || ""; element.hidden = !value; }
function number(value) { return Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function dateTime(value) { return value ? new Date(value).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }) : "-"; }
function title(value) { return String(value || "-").replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()); }
