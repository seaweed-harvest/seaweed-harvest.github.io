const PRINT_STYLE_ID = "ag-worksheet-page-style";

export function setupPrintWorksheet({
  button,
  worksheet,
  rowCount = 12,
  columnCount,
  prepare = null
}) {
  if (!button || !worksheet) return;

  const body = worksheet.querySelector("tbody[data-print-rows]");
  if (body && !body.children.length) {
    buildBlankRows(body, rowCount, columnCount);
  }

  button.addEventListener("click", () => {
    prepare?.();
    printWorksheet(worksheet);
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
    for (let column = 1; column < columns; column += 1) {
      row.append(document.createElement("td"));
    }
    fragment.append(row);
  }
  body.append(fragment);
}

function printWorksheet(worksheet) {
  const previousTitle = document.title;
  const pageStyle = document.createElement("style");
  pageStyle.id = PRINT_STYLE_ID;
  pageStyle.textContent = "@page { size: A4 landscape; margin: 7mm; }";
  document.getElementById(PRINT_STYLE_ID)?.remove();
  document.head.append(pageStyle);

  document.title = worksheet.dataset.printTitle || previousTitle;
  document.body.classList.add("ag-printing");

  let fallbackCleanup;
  const cleanup = () => {
    clearTimeout(fallbackCleanup);
    document.body.classList.remove("ag-printing");
    document.getElementById(PRINT_STYLE_ID)?.remove();
    document.title = previousTitle;
  };

  globalThis.addEventListener("afterprint", cleanup, { once: true });
  fallbackCleanup = setTimeout(cleanup, 60_000);
  requestAnimationFrame(() => {
    globalThis.print();
  });
}
