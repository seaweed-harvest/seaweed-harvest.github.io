import { calculateContractWorkAmount } from "./dryer_payment_math.js?v=2";

const PAYMENT_TERMS_ID = "dryerPaymentTermsReference";
const REPORT_BUTTON_ID = "dryerPaymentReviewReport";
const ROWS_ID = "dryerActivityDayRows";
const KENYA_TIME_ZONE = "Africa/Nairobi";

function formatKes(value) {
  const amount = Number(value);
  const safe = Number.isFinite(amount) ? Math.round(amount) : 0;
  return `KES ${safe.toLocaleString("en-KE")}`;
}

function parseKesAmount(label) {
  const match = String(label || "").match(/KES\s*([\d,]+)/i);
  if (!match) return null;
  const amount = Number(match[1].replaceAll(",", ""));
  return Number.isFinite(amount) ? Math.round(amount) : null;
}

function parseActivityCounts(row) {
  if (!row) return null;
  const fromData = ["loadingCount", "reweighCount", "unloadingCount"].map(
    key => row.dataset[key] === undefined ? NaN : Number(row.dataset[key])
  );
  if (fromData.every(value => Number.isInteger(value) && value >= 0)) {
    return { loadings:fromData[0], reweighs:fromData[1], unloadings:fromData[2] };
  }
  // Support previously rendered rows, including 0L / 5RW / 10U.
  const text = row.querySelector("td:nth-child(4)")?.textContent || "";
  const count = suffix => {
    const match = text.match(new RegExp("(\\d+)\\s*" + suffix + "\\b", "i"));
    return match ? Number(match[1]) : null;
  };
  const loadings = count("L");
  const unloadings = count("U");
  const reweighs = count("(?:RW|R)");
  if (loadings === null || unloadings === null) return null;
  return {loadings, reweighs:reweighs ?? 0, unloadings};
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatReportDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) return String(value || "—");
  return new Date(`${value}T12:00:00+03:00`).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: KENYA_TIME_ZONE
  });
}

function currentKenyaTimestamp() {
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: KENYA_TIME_ZONE
  }).format(new Date());
}

function installStyles() {
  if (document.getElementById("dryerPaymentUiRefinementStyles")) return;
  const style = document.createElement("style");
  style.id = "dryerPaymentUiRefinementStyles";
  style.textContent = `
    .dryer-payment-ui-refined .dryer-payment-terms {
      margin: 8px 0 10px;
      border: 1px solid var(--border, #c9dedb);
      border-radius: 9px;
      background: var(--surface-soft, #f7fbfa);
    }

    .dryer-payment-ui-refined .dryer-payment-terms > summary {
      padding: 7px 10px;
      color: var(--text-sec, #315f59);
      cursor: pointer;
      font-size: .76rem;
      font-weight: 700;
    }

    .dryer-payment-ui-refined .dryer-payment-terms ul {
      margin: 0;
      padding: 0 14px 10px 30px;
      color: var(--text-sec, #315f59);
      font-size: .76rem;
      line-height: 1.45;
    }

    .dryer-payment-ui-refined .dryer-payment-table th,
    .dryer-payment-ui-refined .dryer-payment-table > tbody > tr:not(.dryer-payment-detail-row) > td {
      padding-top: 6px;
      padding-bottom: 6px;
      vertical-align: middle;
    }

    .dryer-payment-ui-refined .dryer-payment-table td:last-child {
      white-space: nowrap;
    }

    .dryer-payment-ui-refined .dryer-payment-table td:last-child button {
      margin-top: 0;
      margin-left: 4px;
    }

    .dryer-payment-ui-refined .dryer-payment-reference {
      display: none;
    }

    .dryer-payment-amount-shell {
      width: 132px;
      max-width: 100%;
      position: relative;
    }

    .dryer-payment-amount-shell .dryer-payment-amount-input {
      width: 100%;
      min-height: 36px;
      box-sizing: border-box;
    }

    .dryer-payment-amount-shell.is-pending .dryer-payment-amount-input {
      border-color: #e0bd75;
      background: #fff8e8;
    }

    .dryer-payment-amount-shell.is-pending:not(.is-edited) .dryer-payment-amount-input:not(:focus) {
      color: transparent;
      caret-color: transparent;
    }

    .dryer-payment-amount-overlay {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      padding: 0 10px;
      overflow: hidden;
      color: #795414;
      font-size: .74rem;
      font-weight: 650;
      pointer-events: none;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .dryer-payment-amount-shell.is-edited .dryer-payment-amount-overlay,
    .dryer-payment-amount-input:focus + .dryer-payment-amount-overlay {
      display: none;
    }

    .dryer-pay-detail {
      margin-top: 9px;
      padding-top: 8px;
      border-top: 1px solid var(--border-soft, #dcebea);
    }

    .dryer-pay-detail ul {
      margin-top: 4px !important;
      padding-left: 18px;
    }

    .dryer-pay-detail li {
      margin: 2px 0;
    }

    .dryer-payment-approval-meta {
      display: block;
      width: 100%;
      margin-top: 5px;
    }
  `;
  document.head.appendChild(style);
}

function installTermsReference() {
  const panel = document.getElementById("dryerPaymentsPanel");
  const summary = document.getElementById("dryerPaymentSummaryMetrics");
  if (!panel || !summary || document.getElementById(PAYMENT_TERMS_ID)) return;

  const details = document.createElement("details");
  details.id = PAYMENT_TERMS_ID;
  details.className = "dryer-payment-terms";
  details.innerHTML = `
    <summary>Payment terms reference</summary>
    <ul>
      <li><strong>KES 500</strong> per qualifying activity day once either 8 bay loadings or 8 bay unloadings is reached.</li>
      <li><strong>KES 25</strong> for each additional loading or unloading activity above the initial 8.</li>
      <li><strong>KES 100</strong> phone/data allowance per activity day when the Research Assistant uses their own phone and mobile data.</li>
    </ul>
  `;
  summary.insertAdjacentElement("afterend", details);
}

function selectedReportRows() {
  return [...document.querySelectorAll(`#${ROWS_ID} [data-payment-day-select]:checked`)]
    .map((checkbox) => {
      const row = checkbox.closest("[data-payment-day-row]");
      if (!row) return null;
      const detailRow = row.nextElementSibling?.hasAttribute("data-payment-day-detail")
        ? row.nextElementSibling
        : null;
      const cells = row.querySelectorAll("td");
      const counts = parseActivityCounts(row);
      if (!counts) {
        throw new Error("Could not read the loading, reweigh and unloading counts for " + (row.dataset.activityDate || "an activity day") + ". Refresh the page before generating the review.");
      }
      const activityPay = Number(row.querySelector("[data-payment-work-input]")?.value || 0);
      const phoneSelect = row.querySelector("[data-payment-phone-select]");
      const phoneData = Number(phoneSelect?.value || 0);
      const approvalNote = detailRow?.querySelector("[data-payment-note-input]")?.value
        ?? detailRow?.querySelector("label p")?.textContent
        ?? "";

      return {
        dateKey: row.dataset.activityDate || "",
        date: cells[1]?.querySelector("strong")?.textContent?.trim() || "—",
        assistant: cells[2]?.textContent?.trim() || "—",
        loadings: counts.loadings,
        unloadings: counts.unloadings,
        reweighs: counts.reweighs,
        minimum: cells[4]?.querySelector(".status-pill")?.textContent?.trim() || "—",
        activityPay: Number.isFinite(activityPay) ? Math.round(activityPay) : 0,
        phoneData: Number.isFinite(phoneData) ? Math.round(phoneData) : 0,
        approvedTotal: (Number.isFinite(activityPay) ? Math.round(activityPay) : 0)
          + (Number.isFinite(phoneData) ? Math.round(phoneData) : 0),
        note: String(approvalNote || "").trim()
      };
    })
    .filter(Boolean);
}

function reportHtml(rows, review = null) {
  const assistant = rows[0]?.assistant || "Research Assistant";
  const dates = rows.map((row) => row.dateKey).filter(Boolean).sort();
  const range = dates.length
    ? `${formatReportDate(dates[0])}${dates.length > 1 ? ` – ${formatReportDate(dates[dates.length - 1])}` : ""}`
    : "—";
  const totals = rows.reduce((sum, row) => ({
    activityPay: sum.activityPay + row.activityPay,
    phoneData: sum.phoneData + row.phoneData,
    approvedTotal: sum.approvedTotal + row.approvedTotal
  }), { activityPay: 0, phoneData: 0, approvedTotal: 0 });
  const creditApplied = review ? Number(review.phone_data_credit_applied_kes || 0) : (parseKesAmount(document.getElementById("dryerPaymentSelectedCredit")?.textContent) || 0);
  const transferNow = review ? Number(review.transfer_amount_kes) : (parseKesAmount(document.getElementById("dryerPaymentSelectedTransfer")?.textContent) ?? Math.max(totals.approvedTotal - creditApplied, 0));

  const rowMarkup = rows.map((row) => `
    <tr>
      <td>${escapeHtml(row.date)}</td>
      <td class="num">${row.loadings}</td>
      <td class="num">${row.reweighs || 0}</td>
      <td class="num">${row.unloadings}</td>
      <td>${escapeHtml(row.minimum)}</td>
      <td class="money">${escapeHtml(row.activityPay.toLocaleString("en-KE"))}</td>
      <td class="money">${escapeHtml(row.phoneData.toLocaleString("en-KE"))}</td>
      <td class="money strong">${escapeHtml(row.approvedTotal.toLocaleString("en-KE"))}</td>
      <td class="note">${escapeHtml(row.note || "—")}</td>
    </tr>`).join("");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Payment review - ${escapeHtml(assistant)} - ${escapeHtml(range)}</title>
  <style>
    @page { size: A4 landscape; margin: 6mm; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      color: #173e39;
      background: #fff;
      font-family: Arial, Helvetica, sans-serif;
      font-size: 8.5pt;
      line-height: 1.25;
    }
    .toolbar { display: flex; gap: 8px; justify-content: flex-end; margin: 0 0 8px; }
    .toolbar button { border: 1px solid #88b9b2; border-radius: 6px; padding: 6px 10px; background: #fff; color: #0d6f66; font-weight: 700; }
    .sheet { width: 100%; }
    .header { display: flex; justify-content: space-between; align-items: flex-start; gap: 20px; padding-bottom: 6px; border-bottom: 2px solid #16857b; }
    h1 { margin: 0; color: #0d5d56; font-size: 17pt; line-height: 1.05; }
    .subtitle { margin-top: 3px; color: #4d746f; font-size: 8pt; }
    .meta { text-align: right; white-space: nowrap; }
    .meta strong { display: block; font-size: 11pt; color: #163f3a; }
    table { width: 100%; border-collapse: collapse; table-layout: fixed; margin-top: 6px; font-size: 7pt; }
    th, td { border: 1px solid #c9dedb; padding: 2px 3px; vertical-align: top; }
    th { background: #e9f5f3; color: #315f59; text-align: left; font-size: 7pt; text-transform: uppercase; letter-spacing: .02em; }
    td.num, td.money { text-align: right; white-space: nowrap; }
    td.strong { font-weight: 700; }
    td.note { overflow-wrap: anywhere; }
    .totals { margin-top: 8px; border: 1px solid #a9cfca; border-radius: 6px; overflow: hidden; }
    .totals-title { padding: 4px 6px; background: #e9f5f3; font-weight: 700; }
    .totals-grid { display: grid; grid-template-columns: repeat(5, 1fr); }
    .total { padding: 6px; border-right: 1px solid #c9dedb; }
    .total:last-child { border-right: 0; }
    .total span { display: block; color: #5e807b; font-size: 6.8pt; text-transform: uppercase; }
    .total strong { display: block; margin-top: 2px; color: #123f39; font-size: 10pt; }
    .transfer strong { color: #006f63; font-size: 12pt; }
    .footer { display: flex; justify-content: space-between; gap: 20px; margin-top: 7px; padding-top: 5px; border-top: 1px solid #d7e7e4; color: #67817d; font-size: 6.8pt; }
    @media print {
      .toolbar { display: none; }
      body {
        print-color-adjust: exact;
        -webkit-print-color-adjust: exact;
        font-size: 8pt;
        line-height: 1.1;
      }
      .sheet { break-inside: auto; }
      .header { padding-bottom: 3px; gap: 12px; }
      h1 { font-size: 15pt; line-height: 1; }
      .subtitle { margin-top: 2px; font-size: 7.5pt; }
      .meta strong { font-size: 10pt; }
      table { margin-top: 4px; font-size: 7pt; }
      th, td { padding: 1px 3px; line-height: 1.08; }
      th { font-size: 6.6pt; line-height: 1.08; }
      .totals {
        margin-top: 4px;
        break-inside: avoid;
        page-break-inside: avoid;
      }
      .totals-title { padding: 3px 5px; }
      .total { padding: 3px 5px; }
      .total strong { margin-top: 1px; font-size: 9pt; }
      .transfer strong { font-size: 11pt; }
      .footer { margin-top: 3px; padding-top: 2px; font-size: 6.3pt; }
    }
  </style>
</head>
<body>
  <div class="toolbar">
    <button type="button" onclick="window.print()">Print / Save PDF</button>
    <button type="button" onclick="window.close()">Close</button>
  </div>
  <main class="sheet">
    <div class="header">
      <div>
        <h1>Research Assistant Payment Review</h1>
        <div class="subtitle">Seaweed Harvest · Dryer Table activities · Selected approved days</div>
      </div>
      <div class="meta">
        <strong>${escapeHtml(assistant)}</strong>
        <div>${escapeHtml(range)}</div>
        <div>${rows.length} ${rows.length === 1 ? "activity day" : "activity days"}</div>
         ${review ? `<div>Batch ${escapeHtml(String(review.id).slice(0,8).toUpperCase())} · ${escapeHtml(review.status === "paid" ? "Paid" : "Review generated")}</div>` : ""}
      </div>
    </div>

    <table>
      <colgroup>
        <col style="width:9%"><col style="width:5%"><col style="width:5%"><col style="width:5%"><col style="width:11%">
        <col style="width:11%"><col style="width:11%"><col style="width:12%"><col style="width:31%">
      </colgroup>
      <thead>
        <tr>
          <th>Date</th>
          <th>Load</th>
          <th>Reweigh</th>
          <th>Unload</th>
          <th>Minimum</th>
          <th>Activity pay (KES)</th>
          <th>Phone / data (KES)</th>
          <th>Approved total (KES)</th>
          <th>Optional note</th>
        </tr>
      </thead>
      <tbody>${rowMarkup}</tbody>
    </table>

    <section class="totals">
      <div class="totals-title">Selected payment totals</div>
      <div class="totals-grid">
        <div class="total"><span>Activity pay</span><strong>${escapeHtml(formatKes(totals.activityPay))}</strong></div>
        <div class="total"><span>Phone / data</span><strong>${escapeHtml(formatKes(totals.phoneData))}</strong></div>
        <div class="total"><span>Approved total</span><strong>${escapeHtml(formatKes(totals.approvedTotal))}</strong></div>
        <div class="total"><span>Advance credit applied</span><strong>− ${escapeHtml(formatKes(creditApplied))}</strong></div>
        <div class="total transfer"><span>Amount due / transfer</span><strong>${escapeHtml(formatKes(transferNow))}</strong></div>
      </div>
    </section>

    <div class="footer">
      <span>${review ? "Saved review; transfer is recorded only when marked paid in ledger." : "Research Assistant payment review."}</span>
      <span>${review ? "Review generated " + escapeHtml(new Date(review.reviewed_at).toLocaleString("en-GB",{timeZone:KENYA_TIME_ZONE})) : "Generated " + escapeHtml(currentKenyaTimestamp()) + " EAT"}</span>
    </div>
  </main>
</body>
</html>`;
}

function printSavedReview(review, existingWindow = null) {
  const rows = (review.activity_days || []).map(row => ({...row, date:formatReportDate(row.dateKey)}));
  const popup = existingWindow || window.open("", "_blank", "width=1200,height=850");
  if (!popup) { window.alert("Allow pop-ups to open the review PDF."); return; }
  popup.opener = null;
  popup.document.open();
  popup.document.write(reportHtml(rows,review));
  popup.document.close();
  popup.focus();
  window.setTimeout(() => popup.print(),300);
}
async function openPaymentReviewReport() {
  let rows;
  try { rows = selectedReportRows(); }
  catch(error) { window.alert(error?.message || String(error)); return; }
  if (!rows.length) { window.alert("Select approved and unpaid days first."); return; }
  const button = document.getElementById(REPORT_BUTTON_ID);
  if (button?.disabled) return;
  const popup = window.open("", "_blank", "width=1200,height=850");
  if (!popup) { window.alert("Allow pop-ups to save and print the review."); return; }
  if (button) button.disabled = true;
  popup.document.write("<title>Saving review</title><p>Saving payment review in ledger…</p>");
  try {
    const review = await new Promise((resolve,reject) => {
      document.dispatchEvent(new CustomEvent("dryer-payment-review-request",{detail:{resolve,reject}}));
    });
    printSavedReview(review,popup);
  } catch(error) { popup.close(); window.alert(error?.message || String(error)); }
  finally { if (button) button.disabled = false; }
}
document.addEventListener("dryer-payment-review-open",event => printSavedReview(event.detail));
function installReportButton() {
  const panel = document.getElementById("dryerPaymentSelectionPanel");
  const actionRow = panel?.querySelector(".section-head .button-row.compact-actions");
  if (!panel || !actionRow || document.getElementById(REPORT_BUTTON_ID)) return;

  const button = document.createElement("button");
  button.id = REPORT_BUTTON_ID;
  button.type = "button";
  button.textContent = "Payment review PDF";
  button.title = "Save this payment review in the ledger and open a printable PDF";
  button.addEventListener("click", openPaymentReviewReport);
  actionRow.insertBefore(button, actionRow.firstChild);

  const tableHeader = document.querySelector(".dryer-payment-table thead th:nth-child(6)");
  if (tableHeader) tableHeader.textContent = "Activity pay";
  const selectedWorkLabel = document.getElementById("dryerPaymentSelectedWork")?.previousElementSibling;
  if (selectedWorkLabel) selectedWorkLabel.textContent = "Activity pay";
}

function enhanceWorkAmount(row) {
  const input = row.querySelector("[data-payment-work-input]");
  const hint = row.querySelector(".dryer-payment-reference");
  if (!input || !hint) return;

  const hintText = hint.textContent.trim();
  const suggestedAmount = parseKesAmount(hintText);
  const pending = !String(row.dataset.decisionId || "").trim();
  let shell = input.closest(".dryer-payment-amount-shell");

  if (!shell) {
    shell = document.createElement("div");
    shell.className = "dryer-payment-amount-shell";
    input.parentNode.insertBefore(shell, input);
    shell.appendChild(input);
  }

  shell.classList.toggle("is-pending", pending);
  if (!pending) {
    shell.classList.remove("is-edited");
    shell.querySelector(".dryer-payment-amount-overlay")?.remove();
    return;
  }

  if (suggestedAmount !== null && input.value === "") {
    input.value = String(suggestedAmount);
  }
  input.dataset.suggestedAmount = suggestedAmount === null ? "" : String(suggestedAmount);

  let overlay = shell.querySelector(".dryer-payment-amount-overlay");
  if (!overlay) {
    overlay = document.createElement("span");
    overlay.className = "dryer-payment-amount-overlay";
    overlay.setAttribute("aria-hidden", "true");
    shell.appendChild(overlay);
  }
  overlay.textContent = hintText;

  if (input.dataset.paymentUiBound !== "true") {
    input.dataset.paymentUiBound = "true";
    input.addEventListener("input", () => {
      const unchanged = input.value === input.dataset.suggestedAmount;
      shell.classList.toggle("is-edited", !unchanged);
    });
  }
}

function enhanceApprovalNote(row) {
  const detailRow = row.nextElementSibling;
  if (!detailRow?.hasAttribute("data-payment-day-detail")) return;

  const grid = detailRow.querySelector(".dryer-payment-detail-grid");
  const noteLabel = grid?.querySelector("label");
  if (!grid || !noteLabel) return;

  const approvalMeta = [...detailRow.querySelectorAll(".field-hint")].find((node) => {
    const text = node.textContent.trim();
    return text.startsWith("Last approved ")
      || text === "This day has not yet been approved.";
  });
  if (!approvalMeta || approvalMeta.parentElement === noteLabel) return;

  const metaHost = approvalMeta.parentElement;
  approvalMeta.classList.add("dryer-payment-approval-meta");
  noteLabel.appendChild(approvalMeta);

  while (
    metaHost?.firstChild?.nodeType === Node.TEXT_NODE
    && !metaHost.firstChild.textContent.trim()
  ) {
    metaHost.firstChild.remove();
  }
  if (metaHost?.firstElementChild?.tagName === "BR") {
    metaHost.firstElementChild.remove();
  }
  if (metaHost && !metaHost.textContent.trim() && !metaHost.querySelector(".status-pill")) {
    metaHost.hidden = true;
  }
}

function buildPayDetail(row) {
  const detailRow = row.nextElementSibling;
  if (!detailRow?.hasAttribute("data-payment-day-detail")) return;
  const activityBlock = detailRow.querySelector(".dryer-payment-detail-grid > div:first-child");
  if (!activityBlock || activityBlock.querySelector(".dryer-pay-detail")) return;

  const counts = parseActivityCounts(row);
  if (!counts) return;
  const calculation = calculateContractWorkAmount(counts.loadings, counts.unloadings, counts.reweighs);

  const detail = document.createElement("div");
  detail.className = "dryer-pay-detail";
  if (calculation.qualifies) {
    const additionalBays = Math.max(calculation.totalActivityCount - 8, 0);
    const bonus = additionalBays * 25;
    detail.innerHTML = `
      <strong>Pay detail</strong>
      <ul>
        <li>Base amount (day rate): <strong>${formatKes(500)}</strong></li>
        <li>Bay activities: ${calculation.loadingCount}L / ${calculation.reweighCount}RW / ${calculation.unloadingCount}U</li>
        <li>Bay bonus: ${additionalBays} × KES 25 = <strong>${formatKes(bonus)}</strong></li>
        <li>Contract total: <strong>${formatKes(calculation.contractAmountKes)}</strong></li>
      </ul>
    `;
  } else {
    detail.innerHTML = `
      <strong>Pay detail</strong>
      <ul>
        <li>Base amount (day rate): <strong>KES 0</strong> — minimum not met</li>
        <li>Bay activities: ${calculation.loadingCount} load / ${calculation.unloadingCount} unload / ${calculation.reweighCount} reweigh</li>
        <li>Bay reference: ${calculation.totalActivityCount} × KES 25 = <strong>${formatKes(calculation.referenceAmountKes)}</strong></li>
        <li>Reference total: <strong>${formatKes(calculation.referenceAmountKes)}</strong></li>
      </ul>
    `;
  }
  activityBlock.appendChild(detail);
}

function enhanceRows() {
  const rows = document.querySelectorAll(`#${ROWS_ID} [data-payment-day-row]`);
  rows.forEach((row) => {
    enhanceWorkAmount(row);
    enhanceApprovalNote(row);
    buildPayDetail(row);
  });
}

function initialisePaymentUiRefinement() {
  const paymentsPanel = document.getElementById("dryerPaymentsPanel");
  const rows = document.getElementById(ROWS_ID);
  if (!paymentsPanel || !rows) return;

  installStyles();
  document.body.classList.add("dryer-payment-ui-refined");
  installTermsReference();
  installReportButton();
  enhanceRows();

  const observer = new MutationObserver(() => enhanceRows());
  observer.observe(rows, { childList: true });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initialisePaymentUiRefinement, { once: true });
} else {
  initialisePaymentUiRefinement();
}

export {
  buildPayDetail,
  enhanceApprovalNote,
  enhanceWorkAmount,
  openPaymentReviewReport,
  parseActivityCounts,
  parseKesAmount,
  selectedReportRows
};