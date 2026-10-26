import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(resolve(root, path), "utf8");
const styles = read("assets/css/ag.css");
const sw = read("service-worker.js");

test("Records pages use the shared date row inside card layout", () => {
  for (const path of ["records.html", "today.html", "admin_today.html"]) {
    const html = read(path);
    assert.match(html, /class="today-shared-date"/);
    assert.match(html, /id="todayIntakeDate" type="date"/);
  }
});

test("Narrow viewport constrains date row using a shrinkable grid column", () => {
  const mobile = styles.slice(styles.lastIndexOf("@media (max-width: 980px)"));
  assert.match(mobile, /#recordTodayWorkspace\s*\{[^}]*max-width:\s*100%/);
  assert.match(mobile, /\.today-shared-date\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/);
  assert.match(mobile, /\.today-shared-date input\[type="date"\]\s*\{[^}]*width:\s*100%/);
  assert.match(mobile, /\.today-shared-date input\[type="date"\]\s*\{[^}]*min-width:\s*0/);
  assert.match(mobile, /\.today-shared-date input\[type="date"\]\s*\{[^}]*max-width:\s*100%/);
});

test("Other native date/time/month inputs can shrink in mobile form cards", () => {
  const mobile = styles.slice(styles.lastIndexOf("@media (max-width: 980px)"));
  assert.match(mobile, /\.admin-content :where\([\s\S]*input\[type="date"\]/);
  assert.match(mobile, /\.admin-content :where\([\s\S]*input\[type="month"\]/);
  assert.match(mobile, /min-inline-size:\s*0/);
  assert.match(mobile, /max-inline-size:\s*100%/);
});

test("Mobile web app cache version changes with the shared CSS", () => {
  assert.match(sw, /seaweed-harvest-collection-v178-mobile-date-fit/);
  assert.match(sw, /"\.\/assets\/css\/ag\.css"/);
});
