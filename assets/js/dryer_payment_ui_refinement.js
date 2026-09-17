import { calculateContractWorkAmount } from "./dryer_payment_math.js?v=1";

const PAYMENT_TERMS_ID = "dryerPaymentTermsReference";
const ROWS_ID = "dryerActivityDayRows";

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
  const text = row?.querySelector("td:nth-child(4)")?.textContent || "";
  const match = text.match(/(\d+)\s*L\s*\/\s*(\d+)\s*U/i);
  if (!match) return null;
  return {
    loadings: Number(match[1]),
    unloadings: Number(match[2])
  };
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
  const calculation = calculateContractWorkAmount(counts.loadings, counts.unloadings);

  const detail = document.createElement("div");
  detail.className = "dryer-pay-detail";
  if (calculation.qualifies) {
    const additionalBays = Math.max(calculation.totalActivityCount - 8, 0);
    const bonus = additionalBays * 25;
    detail.innerHTML = `
      <strong>Pay detail</strong>
      <ul>
        <li>Base amount (day rate): <strong>${formatKes(500)}</strong></li>
        <li>Bay bonus: ${additionalBays} × KES 25 = <strong>${formatKes(bonus)}</strong></li>
        <li>Contract total: <strong>${formatKes(calculation.contractAmountKes)}</strong></li>
      </ul>
    `;
  } else {
    detail.innerHTML = `
      <strong>Pay detail</strong>
      <ul>
        <li>Base amount (day rate): <strong>KES 0</strong> — minimum not met</li>
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
  parseActivityCounts,
  parseKesAmount
};