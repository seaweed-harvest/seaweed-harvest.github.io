const PDF_LIBRARY_URL = new URL("./vendor/jspdf.umd.min.js", import.meta.url).href;
let pdfLibraryPromise = null;

export function setupPdfWorksheet({
  button,
  worksheet,
  rowCount = 12,
  columnCount,
  prepare = null
}) {
  if (!button || !worksheet) return;

  const body = worksheet.querySelector("tbody[data-print-rows]");
  if (body && !body.children.length) buildBlankRows(body, rowCount, columnCount);

  button.addEventListener("click", async () => {
    const wasDisabled = button.disabled;
    button.disabled = true;
    button.setAttribute("aria-busy", "true");
    try {
      prepare?.();
      const filename = await downloadWorksheetPdf(worksheet);
      button.dispatchEvent(new CustomEvent("worksheet-pdf-saved", { detail: { filename } }));
    } catch (error) {
      console.error("Unable to create worksheet PDF", error);
      button.dispatchEvent(new CustomEvent("worksheet-pdf-error", { detail: { error } }));
      globalThis.alert?.("The PDF could not be created. Please try again.");
    } finally {
      button.disabled = wasDisabled;
      button.removeAttribute("aria-busy");
    }
  });
}

export function setPrintValue(element, value) {
  if (!element) return;
  const text = String(value || "").trim();
  element.textContent = text || "\u00a0";
  element.classList.toggle("is-empty", !text);
}

function buildBlankRows(body, rowCount, columnCount) {
  const columns = Number(columnCount) || Number(body.dataset.printColumns);
  if (!Number.isInteger(columns) || columns < 2) return;

  const fragment = document.createDocumentFragment();
  for (let rowNumber = 1; rowNumber <= rowCount; rowNumber += 1) {
    const row = document.createElement("tr");
    const number = document.createElement("th");
    number.scope = "row";
    number.textContent = String(rowNumber);
    row.append(number);
    for (let column = 1; column < columns; column += 1) row.append(document.createElement("td"));
    fragment.append(row);
  }
  body.append(fragment);
}

async function downloadWorksheetPdf(worksheet) {
  const jsPDF = await loadPdfLibrary();
  const documentPdf = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  renderWorksheet(documentPdf, worksheet);

  const filename = worksheet.dataset.pdfFilename || `${filenameBase(worksheet.dataset.printTitle)}.pdf`;
  if (typeof globalThis.SeaweedNative?.savePdf === "function") {
    const dataUri = documentPdf.output("datauristring");
    await globalThis.SeaweedNative.savePdf(filename, dataUri.slice(dataUri.indexOf(",") + 1));
  } else {
    documentPdf.save(filename);
  }
  return filename;
}

function loadPdfLibrary() {
  if (globalThis.jspdf?.jsPDF) return Promise.resolve(globalThis.jspdf.jsPDF);
  if (pdfLibraryPromise) return pdfLibraryPromise;

  pdfLibraryPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = PDF_LIBRARY_URL;
    script.async = true;
    script.addEventListener("load", () => {
      if (globalThis.jspdf?.jsPDF) resolve(globalThis.jspdf.jsPDF);
      else reject(new Error("The PDF library did not initialise."));
    }, { once: true });
    script.addEventListener("error", () => reject(new Error("The PDF library could not be loaded.")), { once: true });
    document.head.append(script);
  });
  return pdfLibraryPromise;
}

function renderWorksheet(pdf, worksheet) {
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const margin = 7;
  const usableWidth = pageWidth - (margin * 2);
  const header = worksheet.querySelector(".ag-print-header");
  const title = cleanText(header?.querySelector("h1")) || worksheet.dataset.printTitle || "Seaweed Harvest Worksheet";
  const eyebrow = cleanText(header?.querySelector("p"));
  const hint = cleanText(header?.querySelector("span"));

  pdf.setProperties({ title, subject: "Seaweed Harvest field worksheet", creator: "Seaweed Harvest" });
  pdf.setTextColor(0, 0, 0);
  pdf.setDrawColor(30, 30, 30);
  pdf.setLineWidth(0.25);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(6.5);
  pdf.text(eyebrow.toUpperCase(), margin, 9);
  pdf.setFontSize(14);
  pdf.text(title, margin, 16);
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(7);
  pdf.text(hint, pageWidth - margin, 16, { align: "right", maxWidth: usableWidth * 0.45 });
  pdf.line(margin, 19, pageWidth - margin, 19);

  renderMeta(pdf, worksheet.querySelector(".ag-print-meta"), margin, 22, usableWidth);

  const table = worksheet.querySelector(".ag-print-table");
  const headers = [...table.querySelectorAll("thead th")].map(cleanText);
  const bodyRows = [...table.querySelectorAll("tbody tr")];
  const widths = normalisedWidths(table.dataset.pdfWidths, headers.length, usableWidth);
  const tableTop = 33;
  const tableBottom = pageHeight - 21;
  const headerHeight = 12;
  const rowHeight = (tableBottom - tableTop - headerHeight) / Math.max(bodyRows.length, 1);
  renderTable(pdf, headers, bodyRows, widths, margin, tableTop, headerHeight, rowHeight);

  renderFooter(pdf, worksheet.querySelector(".ag-print-footer"), margin, pageHeight - 14, usableWidth);
}

function renderMeta(pdf, container, x, y, width) {
  const entries = [...(container?.children || [])];
  if (!entries.length) return;
  const cellWidth = width / entries.length;
  entries.forEach((entry, index) => {
    const cellX = x + (index * cellWidth);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(6.2);
    pdf.text(cleanText(entry.querySelector("span")).toUpperCase(), cellX, y);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(8);
    pdf.text(cleanText(entry.querySelector("strong")), cellX, y + 5, { maxWidth: cellWidth - 3 });
    pdf.line(cellX, y + 6, cellX + cellWidth - 3, y + 6);
  });
}

function renderTable(pdf, headers, bodyRows, widths, x, y, headerHeight, rowHeight) {
  let cellX = x;
  headers.forEach((header, index) => {
    const width = widths[index];
    pdf.rect(cellX, y, width, headerHeight);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(5.5);
    const lines = pdf.splitTextToSize(header.toUpperCase(), Math.max(width - 2, 2)).slice(0, 3);
    pdf.text(lines, cellX + 1, y + 3.5);
    cellX += width;
  });

  bodyRows.forEach((row, rowIndex) => {
    cellX = x;
    const cells = [...row.children];
    widths.forEach((width, columnIndex) => {
      const cellY = y + headerHeight + (rowIndex * rowHeight);
      pdf.rect(cellX, cellY, width, rowHeight);
      const value = cleanText(cells[columnIndex]);
      if (value) {
        pdf.setFont("helvetica", columnIndex === 0 ? "bold" : "normal");
        pdf.setFontSize(6.5);
        pdf.text(value, cellX + (columnIndex === 0 ? width / 2 : 1), cellY + 4, {
          align: columnIndex === 0 ? "center" : "left",
          maxWidth: Math.max(width - 2, 2)
        });
      }
      cellX += width;
    });
  });
}

function renderFooter(pdf, container, x, y, width) {
  const entries = [...(container?.children || [])];
  if (!entries.length) return;
  const ratios = entries.length === 3 ? [2, 1, 2] : entries.map(() => 1);
  const ratioTotal = ratios.reduce((sum, value) => sum + value, 0);
  let cellX = x;
  entries.forEach((entry, index) => {
    const cellWidth = width * (ratios[index] / ratioTotal);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(6.2);
    pdf.text(cleanText(entry.querySelector("span")).toUpperCase(), cellX, y);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(8);
    pdf.text(cleanText(entry.querySelector("strong")), cellX, y + 5, { maxWidth: cellWidth - 4 });
    pdf.line(cellX, y + 6, cellX + cellWidth - 4, y + 6);
    cellX += cellWidth;
  });
}

function normalisedWidths(value, count, totalWidth) {
  const requested = String(value || "").split(",").map(Number).filter((item) => Number.isFinite(item) && item > 0);
  const weights = requested.length === count ? requested : Array.from({ length: count }, () => 1);
  const total = weights.reduce((sum, item) => sum + item, 0);
  return weights.map((item) => totalWidth * (item / total));
}

function cleanText(element) {
  return String(element?.textContent || "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function filenameBase(value) {
  return String(value || "seaweed-harvest-worksheet")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "seaweed-harvest-worksheet";
}
