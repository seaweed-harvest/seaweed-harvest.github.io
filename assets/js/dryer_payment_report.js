const REPORT_BUTTON_ID = "dryerCreatePaymentReviewReport";
const ROWS_ID = "dryerActivityDayRows";
const KENYA_TIME_ZONE = "Africa/Nairobi";

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function optionalInteger(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number) : null;
}

function formatInteger(value) {
  const number = Number(value);
  return Number.isFinite(number)
    ? Math.round(number).toLocaleString("en-GB")
    : "0";
}

function formatKes(value) {
  return `KES ${formatInteger(value)}`;
}

function parseKes(value) {
  const text = String(value || "").replaceAll(",", "");
  const match = text.match(/KES\s*(-?\s*\d+)/i);
  if (!match) return 0;
  return Math.abs(Number(match[1].replace(/\s/g, ""))) || 0;
}

function formatDateKey(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) return "-";
  return new Date(`${value}T12:00:00+03:00`).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: KENYA_TIME_ZONE
  });
}

function formatDateTime(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: KENYA_TIME_ZONE
  });
}

function parseActivityCounts(row) {
  const text = row?.querySelector("td:nth-child(4)")?.textContent || "";
  const match = text.match(/(\d+)\s*L\s*\/\s*(\d+)\s*U/i);
  return match
    ? { loadings: Number(match[1]), unloadings: Number(match[2]) }
    : { loadings: 0, unloadings: 0 };
}

function recordedEvents(detailRow) {
  const activityBlock = detailRow?.querySelector(
    ".dryer-payment-detail-grid > div:first-child"
  );
  const list = activityBlock?.querySelector("ul");
  return list
    ? [...list.querySelectorAll("li")]
        .map((item) => item.textContent.trim())
        .filter(Boolean)
    : [];
}

function approvalNote(detailRow) {
  const input = detailRow?.querySelector("[data-payment-note-input]");
  if (input) return String(input.value || "").trim();

  const label = detailRow?.querySelector(".dryer-payment-detail-grid label");
  const paragraph = label?.querySelector("p");
  return String(paragraph?.textContent || "").trim();
}

function qualificationText(row) {
  const text = row?.querySelector("td:nth-child(5)")?.textContent || "";
  return /Minimum met/i.test(text) ? "Minimum met" : "Below minimum";
}

function collectSelectedDays() {
  const rowsHost = document.getElementById(ROWS_ID);
  if (!rowsHost) return [];

  return [...rowsHost.querySelectorAll("[data-payment-day-select]:checked")]
    .map((checkbox) => checkbox.closest("[data-payment-day-row]"))
    .filter(Boolean)
    .map((row) => {
      const detailRow = row.nextElementSibling?.hasAttribute("data-payment-day-detail")
        ? row.nextElementSibling
        : null;
      const counts = parseActivityCounts(row);
      const activityPay = optionalInteger(
        row.querySelector("[data-payment-work-input]")?.value
      ) || 0;
      const phoneData = optionalInteger(
        row.querySelector("[data-payment-phone-select]")?.value
      ) || 0;
      const approvedTotal = activityPay + phoneData;

      return {
        activityDate: String(row.dataset.activityDate || ""),
        assistantName: String(
          row.querySelector("td:nth-child(3)")?.textContent || ""
        ).trim(),
        loadings: counts.loadings,
        unloadings: counts.unloadings,
        qualification: qualificationText(row),
        activityPay,
        phoneData,
        approvedTotal,
        events: recordedEvents(detailRow),
        note: approvalNote(detailRow)
      };
    })
    .sort((left, right) => left.activityDate.localeCompare(right.activityDate));
}

function reportTotals(days) {
  const activityPay = days.reduce((sum, day) => sum + day.activityPay, 0);
  const phoneData = days.reduce((sum, day) => sum + day.phoneData, 0);
  const approvedTotal = days.reduce((sum, day) => sum + day.approvedTotal, 0);
  const credit = parseKes(
    document.getElementById("dryerPaymentSelectedCredit")?.textContent
  );
  const transferText = document.getElementById(
    "dryerPaymentSelectedTransfer"
  )?.textContent;
  const transfer = transferText
    ? parseKes(transferText)
    : Math.max(0, approvedTotal - credit);

  return {
    activityPay,
    phoneData,
    approvedTotal,
    credit,
    transfer
  };
}

function reportPeriod(days) {
  if (!days.length) return "-";
  const first = formatDateKey(days[0].activityDate);
  const last = formatDateKey(days[days.length - 1].activityDate);
  return first === last ? first : `${first} to ${last}`;
}

function eventMarkup(day) {
  if (!day.events.length) return '<span class="event-muted">No event detail</span>';
  return day.events
    .map((event) => `<div class="event-line">${escapeHtml(event)}</div>`)
    .join("");
}

function buildPaymentReportHtml(days) {
  const totals = reportTotals(days);
  const assistantName = days[0]?.assistantName || "Research Assistant";
  const period = reportPeriod(days);
  const paymentDate = document.getElementById("dryerPaymentDate")?.value || "";
  const paymentDateLabel = paymentDate ? formatDateKey(paymentDate) : "Not set";
  const compactClass = days.length >= 10 ? " compact" : "";
  const title = `Payment review - ${assistantName} - ${period}`;

  const dayRows = days.map((day) => `
    <tr>
      <td class="date-cell"><strong>${escapeHtml(formatDateKey(day.activityDate))}</strong></td>
      <td class="activity-cell">
        <div class="activity-total"><strong>${formatInteger(day.loadings)} L / ${formatInteger(day.unloadings)} U</strong></div>
        ${eventMarkup(day)}
      </td>
      <td>${escapeHtml(day.qualification)}</td>
      <td class="money">${escapeHtml(formatKes(day.activityPay))}</td>
      <td class="money">${escapeHtml(formatKes(day.phoneData))}</td>
      <td class="money"><strong>${escapeHtml(formatKes(day.approvedTotal))}</strong></td>
      <td>${day.note ? escapeHtml(day.note) : '<span class="event-muted">-</span>'}</td>
    </tr>
  `).join("");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    @page { size: A4 landscape; margin: 8mm; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      color: #173f3a;
      background: #ffffff;
      font-family: Arial, Helvetica, sans-serif;
      font-size: 9px;
      line-height: 1.25;
    }
    .toolbar {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
      padding: 10px 0;
    }
    .toolbar button {
      border: 1px solid #8fb9b3;
      border-radius: 7px;
      background: #eef8f6;
      color: #0f6259;
      padding: 7px 12px;
      font-weight: 700;
      cursor: pointer;
    }
    .report { width: 100%; }
    .report-head {
      display: flex;
      justify-content: space-between;
      gap: 18px;
      align-items: flex-start;
      padding-bottom: 7px;
      border-bottom: 2px solid #1d7b70;
    }
    h1 { margin: 0 0 2px; font-size: 19px; line-height: 1.05; }
    .subtitle { color: #5c7d78; font-size: 9px; }
    .assistant-box {
      min-width: 235px;
      border: 1px solid #bdd8d4;
      border-radius: 7px;
      padding: 6px 8px;
      background: #f6fbfa;
    }
    .assistant-box strong { font-size: 11px; }
    .meta {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 6px;
      margin: 7px 0;
    }
    .meta-item {
      border: 1px solid #d5e7e4;
      border-radius: 6px;
      padding: 5px 7px;
    }
    .meta-label { display: block; color: #64847f; font-size: 7.5px; text-transform: uppercase; letter-spacing: .04em; }
    .meta-value { display: block; margin-top: 1px; font-weight: 700; }
    table { width: 100%; border-collapse: collapse; table-layout: fixed; }
    th, td {
      border: 1px solid #cbdedb;
      padding: 4px 5px;
      vertical-align: top;
      overflow-wrap: anywhere;
    }
    th {
      background: #eaf5f3;
      color: #315f59;
      font-size: 7.5px;
      text-align: left;
      text-transform: uppercase;
      letter-spacing: .03em;
    }
    th:nth-child(1) { width: 8%; }
    th:nth-child(2) { width: 31%; }
    th:nth-child(3) { width: 10%; }
    th:nth-child(4) { width: 11%; }
    th:nth-child(5) { width: 10%; }
    th:nth-child(6) { width: 11%; }
    th:nth-child(7) { width: 19%; }
    .money { white-space: nowrap; }
    .activity-total { margin-bottom: 2px; }
    .event-line { color: #4f716c; font-size: 7.7px; line-height: 1.2; }
    .event-muted { color: #7d9692; }
    .totals {
      display: grid;
      grid-template-columns: repeat(5, minmax(0, 1fr));
      gap: 6px;
      margin-top: 7px;
    }
    .total-box {
      border: 1px solid #bdd8d4;
      border-radius: 6px;
      padding: 5px 7px;
      background: #f6fbfa;
    }
    .total-box.primary {
      border-color: #1d7b70;
      background: #e8f5f2;
    }
    .total-label { display: block; color: #64847f; font-size: 7.5px; }
    .total-value { display: block; margin-top: 1px; font-size: 11px; font-weight: 800; }
    .explain {
      margin: 5px 0 0;
      color: #5e7c78;
      font-size: 7.5px;
    }
    .footer-grid {
      display: grid;
      grid-template-columns: 1.3fr 1fr;
      gap: 10px;
      margin-top: 7px;
    }
    .terms, .review {
      border-top: 1px solid #cbdedb;
      padding-top: 5px;
      color: #55746f;
      font-size: 7.5px;
    }
    .review-line {
      display: grid;
      grid-template-columns: 1.4fr 1fr;
      gap: 16px;
      margin-top: 12px;
    }
    .line { border-bottom: 1px solid #55746f; height: 12px; }
    .line-label { margin-top: 2px; color: #728c88; font-size: 7px; }
    body.compact { font-size: 8px; }
    body.compact th, body.compact td { padding: 2.5px 4px; }
    body.compact .event-line { font-size: 6.9px; line-height: 1.12; }
    body.compact .meta { margin: 5px 0; }
    body.compact .totals, body.compact .footer-grid { margin-top: 5px; }
    @media print {
      .toolbar { display: none !important; }
      body { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
    }
  </style>
</head>
<body class="${compactClass.trim()}">
  <div class="toolbar"><button type="button" onclick="window.print()">Print / Save PDF</button></div>
  <main class="report">
    <header class="report-head">
      <div>
        <h1>Research Assistant Payment Review</h1>
        <div class="subtitle">Seaweed Harvest - Dryer Table Records</div>
      </div>
      <div class="assistant-box">
        <span class="meta-label">For review by</span>
        <strong>${escapeHtml(assistantName)}</strong>
      </div>
    </header>

    <section class="meta">
      <div class="meta-item"><span class="meta-label">Period</span><span class="meta-value">${escapeHtml(period)}</span></div>
      <div class="meta-item"><span class="meta-label">Activity days</span><span class="meta-value">${formatInteger(days.length)}</span></div>
      <div class="meta-item"><span class="meta-label">Planned payment date</span><span class="meta-value">${escapeHtml(paymentDateLabel)}</span></div>
      <div class="meta-item"><span class="meta-label">Prepared</span><span class="meta-value">${escapeHtml(formatDateTime())}</span></div>
    </section>

    <table aria-label="Selected Research Assistant payment activity days">
      <thead>
        <tr>
          <th>Date</th>
          <th>Loading / unloading activity</th>
          <th>Minimum</th>
          <th>Activity pay</th>
          <th>Phone / data</th>
          <th>Approved total</th>
          <th>Optional note</th>
        </tr>
      </thead>
      <tbody>${dayRows}</tbody>
    </table>

    <section class="totals" aria-label="Payment totals">
      <div class="total-box"><span class="total-label">Activity pay</span><span class="total-value">${escapeHtml(formatKes(totals.activityPay))}</span></div>
      <div class="total-box"><span class="total-label">Phone / data</span><span class="total-value">${escapeHtml(formatKes(totals.phoneData))}</span></div>
      <div class="total-box"><span class="total-label">Approved total</span><span class="total-value">${escapeHtml(formatKes(totals.approvedTotal))}</span></div>
      <div class="total-box"><span class="total-label">Less phone/data advance credit</span><span class="total-value">${escapeHtml(formatKes(totals.credit))}</span></div>
      <div class="total-box primary"><span class="total-label">Net transfer</span><span class="total-value">${escapeHtml(formatKes(totals.transfer))}</span></div>
    </section>
    <p class="explain">Approved total is the selected activity pay plus phone/data allowances. Net transfer deducts any phone/data advance credit already provided.</p>

    <section class="footer-grid">
      <div class="terms"><strong>Payment terms reference:</strong> KES 500 per qualifying activity day (minimum 8 bay loadings or 8 bay unloadings), plus KES 25 for each additional bay activity above the initial 8. KES 100 phone/data allowance applies when a personal phone and mobile data are used.</div>
      <div class="review">
        <strong>Research Assistant review</strong> - I have reviewed the activity and payment amounts above.
        <div class="review-line">
          <div><div class="line"></div><div class="line-label">Signature / name</div></div>
          <div><div class="line"></div><div class="line-label">Date</div></div>
        </div>
      </div>
    </section>
  </main>
</body>
</html>`;
}

function setActivityStatus(message, type = "") {
  const status = document.getElementById("dryerPaymentActivityStatus");
  if (!status) return;
  status.textContent = message;
  if (type) status.dataset.status = type;
  else delete status.dataset.status;
}

function openSelectedPaymentReport() {
  const days = collectSelectedDays();
  if (!days.length) {
    setActivityStatus("Select one or more approved activity days to create a payment report.", "error");
    return;
  }

  const reportWindow = window.open("", "_blank", "width=1400,height=900");
  if (!reportWindow) {
    setActivityStatus("The payment report was blocked by the browser. Allow pop-ups and try again.", "error");
    return;
  }

  reportWindow.document.open();
  reportWindow.document.write(buildPaymentReportHtml(days));
  reportWindow.document.close();
  reportWindow.focus();
  window.setTimeout(() => {
    try {
      reportWindow.print();
    } catch {
      // The report remains open with its Print / Save PDF button.
    }
  }, 180);
}

function renameActivityPayLabels() {
  const header = document.querySelector(".dryer-payment-table thead th:nth-child(6)");
  if (header) header.textContent = "Activity pay";

  const selectedValue = document.getElementById("dryerPaymentSelectedWork");
  const selectedLabel = selectedValue?.previousElementSibling;
  if (selectedLabel) selectedLabel.textContent = "Activity pay";
}

function installReportButton() {
  if (document.getElementById(REPORT_BUTTON_ID)) return;
  const recordButton = document.getElementById("dryerRecordSelectedPayment");
  if (!recordButton?.parentElement) return;

  const button = document.createElement("button");
  button.id = REPORT_BUTTON_ID;
  button.type = "button";
  button.textContent = "Payment report / PDF";
  button.title = "Create a one-page payment review for the selected activity days";
  button.addEventListener("click", openSelectedPaymentReport);
  recordButton.parentElement.insertBefore(button, recordButton);
}

function initialisePaymentReport() {
  if (!document.getElementById("dryerPaymentsPanel")) return;
  renameActivityPayLabels();
  installReportButton();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initialisePaymentReport, { once: true });
} else {
  initialisePaymentReport();
}

export {
  buildPaymentReportHtml,
  collectSelectedDays,
  openSelectedPaymentReport,
  reportTotals
};
