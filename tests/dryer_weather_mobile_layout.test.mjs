import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = resolve(root, "assets/js/dryer_table_analysis.js");
const css = readFileSync(resolve(root, "assets/css/dryer_analysis_weather_parity.css"), "utf8");
const html = readFileSync(resolve(root, "dryer_table_records.html"), "utf8");
const js = readFileSync(source, "utf8");
execFileSync(process.execPath, ["--check", source]);

const from = js.indexOf("function mobileWeatherLayout(days, desktop) {");
const until = js.indexOf("\nfunction renderWeather()", from);
assert.ok(from >= 0 && until > from, "Mobile-only layout must be defined");
const context = {
  Date, state: { tideEnabled: false }, KENYA_TIME_ZONE: "Africa/Nairobi",
  weatherBounds: () => [new Date("2026-09-20T00:00:00+03:00"), new Date("2026-10-20T00:00:00+03:00")]
};
vm.createContext(context);
vm.runInContext(js.slice(from, until), context);

const desktop = {
  xaxis: { range: context.weatherBounds(), matches: "x2", domain: [.055, .875] },
  xaxis2: { range: context.weatherBounds(), domain: [.055, .875], side: "top" },
  yaxis4: { categoryarray: ["EXISTING SHED T2", "NEW T1"] },
  shapes: [
    { type: "rect", xref: "x", yref: "paper", y0: .57, y1: .96 },
    { type: "line", xref: "paper", yref: "paper", y0: .57, y1: .57 },
    { type: "line", xref: "x2", yref: "paper", y0: .07, y1: .96 }
  ],
  annotations: [{ text: "Weather" }]
};
const unchangedDesktop = JSON.stringify(desktop);
const mobile = vm.runInContext("mobileWeatherLayout(30, sample)", Object.assign(context,{sample:desktop}));
assert.equal(JSON.stringify(desktop), unchangedDesktop, "Desktop layout must not be mutated");
assert.equal(mobile.showlegend, false, "Mobile avoids a legend consuming the plot area");
assert.ok(mobile.margin.l + mobile.margin.r < 100, "Mobile axes must fit the narrow screen");
assert.equal(mobile.xaxis2.side, "bottom");
assert.ok(mobile.xaxis2.tickvals.length >= 3);
assert.equal(mobile.xaxis2.ticktext.length, mobile.xaxis2.tickvals.length);
assert.ok(mobile.yaxis.domain[0] > mobile.yaxis2.domain[1]);
assert.ok(mobile.yaxis2.domain[0] > mobile.yaxis3.domain[1]);
assert.ok(mobile.yaxis3.domain[0] > mobile.yaxis4.domain[1]);
assert.equal(mobile.yaxis2.overlaying, undefined, "No overlapping weather axes on mobile");
assert.ok(mobile.yaxis4.ticktext.includes("Shed T2"));
assert.equal(mobile.shapes.some(s => s.xref === "paper"), false, "Desktop divider removed");
assert.equal(mobile.shapes.find(s => s.type === "rect").y0, mobile.yaxis3.domain[0]);

context.state.tideEnabled = true;
const withTide = vm.runInContext("mobileWeatherLayout(7, sample)", context);
assert.ok(withTide.yaxis3.domain[0] > withTide.yaxis5.domain[1]);
assert.ok(withTide.yaxis5.domain[0] > withTide.yaxis4.domain[1]);
assert.equal(withTide.yaxis5.visible, true);
assert.equal(withTide.shapes.find(s => s.type === "rect").y0, withTide.yaxis5.domain[0]);
assert.ok(withTide.annotations.some(a => a.text.includes("Lowest low tide")));

assert.match(js, /mobile \? mobileWeatherLayout\(state\.rangeDays,desktopLayout\) : desktopLayout/,
  "Desktop must keep its existing weather layout");
assert.match(js, /new ResizeObserver/, "Rotation/resize must change layout breakpoint");
assert.match(css, /#dryerAnalysisWeatherChart\.dryer-weather-mobile\s*\{[\s\S]*height:\s*940px/);
assert.match(css, /#dryerAnalysisWeatherChart\.dryer-weather-mobile-tides\s*\{[\s\S]*height:\s*1100px/);
assert.match(html, /dryer_table_analysis\.js\?v=12/, "Fresh JS URL avoids stale cached plots");

console.log("dryer_weather_mobile_layout: ok");
