import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const htmlPath = resolve(root, "dryer_table_records.html");
const jsPath = resolve(root, "assets/js/dryer_table_analysis.js");
const cssPath = resolve(root, "assets/css/dryer_analysis_live.css");

const html = readFileSync(htmlPath, "utf8");
const js = readFileSync(jsPath, "utf8");
const css = readFileSync(cssPath, "utf8");

execFileSync(process.execPath, ["--check", jsPath], { stdio: "pipe" });

assert.match(html, /dryer_table_analysis\.js\?v=1/, "Records page must load the live analysis module");
assert.match(js, /list_authenticated_seaweed_drying_ledger/, "Analysis must use the authenticated Dryer Table ledger RPC");
assert.match(js, /p_account_access_token:\s*token/, "Analysis must pass the current account token to the live ledger RPC");
assert.doesNotMatch(js, /DRYER_RUNS/, "Production analysis must not use the old static dryer-run snapshot");
assert.match(js, /button\.textContent = "Analysis"/, "Analysis tab must be installed in the existing Records tab strip");
assert.match(js, /e === "2026-09-04"/, "Historical 4 September timing-confidence rule must be retained");
assert.match(js, /\["NEW T1","NEW T2","NEW T3"\].*s === "2026-08-31"/, "31 Aug NEW T1-T3 runs must remain caution timing evidence");
assert.match(js, /humidity:\[\[232,247,236\],\[224,240,242\],\[210,230,255\]\]/, "Humidity heatmap must run light green to blue");
assert.match(js, /rain:\[\[255,255,255\],\[234,243,252\],\[210,230,255\]\]/, "Rainfall heatmap must run white to blue");
assert.match(css, /\.dryer-analysis-panel/, "Analysis-specific Records styling must be present");

console.log("dryer_analysis_live_contract: ok");
