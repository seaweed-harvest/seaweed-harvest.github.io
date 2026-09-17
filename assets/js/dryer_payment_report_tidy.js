const REPORT_BUTTON_ID = "dryerPaymentReviewReport";
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

function formatKes(value) {
  const amount = Number(value);
  const safe = Number.isFinite(amount) ? Math.round(amount) : 0;
  return `KES ${safe.toLocaleString("en-KE")}`;
}

function parseKes(label) {
  const match = String(label || "").match(/KES\s*([\d,]+)/i);
  if (!match) return 0;
  const amount = Number(match[1].replaceAll(",", ""));
  return Number.isFinite(amount) ? Math.round(amount) : 0;
}

function parseActivityCounts(row) {
  const text = row?.querySelector("td:nth-child(4)")?.textContent || "";
  const match = text.match(/(\d+)\s*L\s*\/\s*(\d+)\s*U/i);
  return match
    ? { loadings: Number(match[1]), unloadings: Number(match[2]) }
    : { loadings: 0, unloadings: 0 };
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
      const activityPay = Number(row.querySelector("[data-payment-work-input]")?.value || 0);
      const phoneData = Number(row.querySelector("[data-payment-phone-select]")?.value || 0);
      const approvalNote = detailRow?.querySelector("[data-payment-note-input]")?.value
        ?? detailRow?.querySelector("label p")?.textContent
        ?? "";

      return {
        dateKey: row.dataset.activityDate || "",
        date: cells[1]?.querySelector("strong")?.textContent?.trim() || "—",
        assistant: cells[2]?.textContent?.trim() || "—",
        loadings: counts.loadings,
        unloadings: counts.unloadings,
        minimum: cells[4]?.querySelector(".status-pill")?.textContent?.trim() || "—",
        activityPay: Number.isFinite(activityPay) ? Math.round(activityPay) : 0,
        phoneData: Number.isFinite(phoneData) ? Math.round(phoneData) : 0,
        note: String(approvalNote || "").trim()
      };
    })
    .filter(Boolean)
    .map((row) => ({
      ...row,
      approvedTotal: row.activityPay + row.phoneData
    }));
}

function reportHtml(rows) {
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
  const creditApplied = parseKes(document.getElementById("dryerPaymentSelectedCredit")?.textContent);
  const transferText = document.getElementById("dryerPaymentSelectedTransfer")?.textContent;
  const transferNow = transferText
    ? parseKes(transferText)
    : Math.max(totals.approvedTotal - creditApplied, 0);

  const rowsMarkup = rows.map((row) => `
    <tr>
      <td>${escapeHtml(row.date)}</td>
      <td class="num">${row.loadings}</td>
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
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Payment review - ${escapeHtml(assistant)} - ${escapeHtml(range)}</title>
  <style>
    @page { size: A4 landscape; margin: 11mm; }
    * { box-sizing: border-box; }
    html, body { max-width: 100%; overflow-x: hidden; }
    body {
      margin: 0;
      padding: 12px 14px 16px;
      color: #173e39;
      background: #fff;
      font-family: Arial, Helvetica, sans-serif;
      font-size: 8.4pt;
      line-height: 1.24;
    }
    .toolbar {
      display: flex;
      gap: 8px;
      justify-content: flex-end;
      margin: 0 0 10px;
    }
    .toolbar button {
      border: 1px solid #88b9b2;
      border-radius: 6px;
      padding: 6px 10px;
      background: #fff;
      color: #0d6f66;
      font-weight: 700;
      cursor: pointer;
    }
    .sheet {
      width: 100%;
      max-width: 100%;
      margin: 0 auto;
    }
    .header {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 20px;
      align-items: start;
      padding: 0 0 7px;
      border-bottom: 2px solid #16857b;
    }
    h1 {
      margin: 0;
      color: #0d5d56;
      font-size: 17pt;
      line-height: 1.05;
    }
    .subtitle { margin-top: 3px; color: #4d746f; font-size: 8pt; }
    .meta { min-width: 190px; text-align: right; white-space: nowrap; padding-right: 1px; }
    .meta strong { display: block; font-size: 11pt; color: #163f3a; }
    table {
      width: 100%;
      max-width: 100%;
      border-collapse: collapse;
      table-layout: fixed;
      margin-top: 8px;
      font-size: 7.35pt;
    }
    th, td {
      border: 1px solid #c9dedb;
      padding: 3px 4px;
      vertical-align: top;
    }
    th {
      background: #e9f5f3;
      color: #315f59;
      text-align: left;
      font-size: 6.55pt;
      line-height: 1.1;
      text-transform: uppercase;
      letter-spacing: .015em;
    }
    td.num, td.money { text-align: right; white-space: nowrap; }
    td.strong { font-weight: 700; }
    td.note { overflow-wrap: anywhere; }
    .totals {
      margin-top: 8px;
      border: 1px solid #a9cfca;
      border-radius: 6px;
      overflow: hidden;
    }
    .totals-title { padding: 4px 6px; background: #e9f5f3; font-weight: 700; }
    .totals-grid { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); }
    .total { min-width: 0; padding: 6px; border-right: 1px solid #c9dedb; }
    .total:last-child { border-right: 0; }
    .total span { display: block; color: #5e807b; font-size: 6.6pt; line-height: 1.15; text-transform: uppercase; }
    .total strong { display: block; margin-top: 2px; color: #123f39; font-size: 10pt; white-space: nowrap; }
    .transfer strong { color: #006f63; font-size: 12pt; }
    .footer {
      display: flex;
      justify-content: flex-end;
      margin-top: 7px;
      padding-top: 5px;
      border-top: 1px solid #d7e7e4;
      color: #67817d;
      font-size: 6.8pt;
    }
    @media print {
      body { padding: 0; print-color-adjust: exact; -webkit-print-color-adjust: exact; }
      .toolbar { display: none !important; }
      .sheet { width: 100%; max-width: 100%; break-inside: avoid; }
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
      </div>
    </div>

    <table>
      <colgroup>
        <col style="width:10%"><col style="width:8%"><col style="width:8%"><col style="width:12%">
        <col style="width:11%"><col style="width:11%"><col style="width:12%"><col style="width:28%">
      </colgroup>
      <thead>
        <tr>
          <th>Date</th>
          <th>Bay loadings</th>
          <th>Bay unloadings</th>
          <th>Minimum</th>
          <th>Activity pay (KES)</th>
          <th>Phone / data (KES)</th>
          <th>Approved total (KES)</th>
          <th>Note</th>
        </tr>
      </thead>
      <tbody>${rowsMarkup}</tbody>
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

    <div class="footer"><span>Generated ${escapeHtml(currentKenyaTimestamp())} EAT</span></div>
  </main>
</body>
</html>`;
}

function openPaymentReviewReport() {
  const rows = selectedReportRows();
  if (!rows.length) {
    window.alert("Select at least one approved activity day first.");
    return;
  }

  const reportWindow = window.open("", "_blank", "width=1240,height=850");
  if (!reportWindow) {
    window.alert("The payment review report was blocked by the browser. Allow pop-ups for this site and try again.");
    return;
  }
  reportWindow.opener = null;
  reportWindow.document.open();
  reportWindow.document.write(reportHtml(rows));
  reportWindow.document.close();
  reportWindow.focus();
  window.setTimeout(() => reportWindow.print(), 250);
}

function wireButton() {
  const current = document.getElementById(REPORT_BUTTON_ID);
  if (!current || current.dataset.reportTidyBound === "true") return false;

  const button = current.cloneNode(true);
  button.dataset.reportTidyBound = "true";
  button.title = "Create a tidy one-page payment review for the selected activity days";
  current.replaceWith(button);
  button.addEventListener("click", openPaymentReviewReport);
  return true;
}

function initialise() {
  if (wireButton()) return;
  const observer = new MutationObserver(() => {
    if (wireButton()) observer.disconnect();
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initialise, { once: true });
} else {
  initialise();
}
