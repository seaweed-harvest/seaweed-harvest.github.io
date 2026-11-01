import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const read = path => readFileSync(new URL(path, import.meta.url), "utf8");
const html = read("../cosme_metrics.html");
const page = read("../assets/js/cosme_metrics_page.js");
const view = read("../assets/js/cosme_metrics_timeline.mjs");
const css = read("../assets/css/cosme_metrics_timeline.css");
const sql = read("../supabase/migrations/20261101073000_cosme_metrics_timeline_readonly.sql");

test("Timeline is part of the existing, access-gated Metrics page", () => {
  assert.match(html, /data-tab="timeline"[^>]*>Timeline<\/button>/);
  assert.match(html, /<section id="timeline" hidden>/);
  assert.match(html, /id="metricsTimeline"/);
  assert.match(page, /cosme_metrics_my_access/);
  assert.match(page, /createMetricsTimeline\(authClient/);
  assert.match(page, /timelinePanel\.setRelease\(all\)/);
  assert.match(page, /timelinePanel\.load\(\)/);
  assert.match(page, /timelinePanel\.clear\(\)/);
  assert.match(page, /"current", "timeline", "history"/);
  assert.match(html, /cosme_metrics_page\.js\?v=18/);
  assert.match(page, /app_navigation\.js\?v=17/);
  assert.match(page, /cosme_metrics_live_values\.mjs/);
});
test("Timeline source and metric links are safe and restrict to available release items", () => {
  assert.match(view, /authClient\.rpc\("cosme_metrics_timeline"\)/);
  assert.match(view, /availableMetrics\.has\(metric\.id\)/);
  assert.match(view, /openMetric\(metric\.id, button\)/);
  assert.match(view, /parsed\.protocol === "https:"/);
  assert.match(view, /textContent = String\(text \?\? ""\)/);
  assert.match(view, /view === "calendar"/);
  assert.match(view, /"All activities"/);
  assert.match(view, /"All years"/);
  assert.match(css, /@media\(max-width:620px\)/);
  assert.match(css, /grid-template-columns:repeat\(7,minmax\(0,1fr\)\)/);
});
test("read-only SQL checks grant before reading private COSME metrics", () => {
  assert.match(sql, /create or replace function public\.cosme_metrics_timeline\(\)/i);
  assert.match(sql, /language plpgsql stable security definer/i);
  assert.match(sql, /set search_path = ''/);
  const check = sql.indexOf("if (select auth.uid()) is null or v_role is null");
  const query = sql.indexOf("with curated(");
  assert.ok(check >= 0 && check < query);
  assert.match(sql, /cosme_metrics\.caller_role\(\)/);
  assert.match(sql, /raise exception 'Metrics access denied' using errcode = '42501'/);
  assert.match(sql, /revoke all on function public\.cosme_metrics_timeline\(\)\s+from public, anon, authenticated;/i);
  assert.match(sql, /grant execute on function public\.cosme_metrics_timeline\(\)\s+to authenticated;/i);
  assert.doesNotMatch(sql, /\b(?:create|alter|drop)\s+(?:table|policy)\b/i);
  assert.doesNotMatch(sql, /\b(?:insert into|delete from|update cosme_metrics\.)\b/i);
  assert.match(sql, /project\.current_release_id/);
  assert.match(sql, /ri\.frozen_payload/);
});
test("curated source-anchored milestones have precise, non-invented dates", () => {
  const entries = [...sql.matchAll(/\('([0-9]{4}-[0-9]{2}-[0-9]{2})'::date,(?:'([0-9]{4}-[0-9]{2}-[0-9]{2})'::date|null::date),\s*'([^']+)',ARRAY\[([^\]]+)\]::text\[\]/g)];
  assert.equal(entries.length,22);
  assert.ok(entries.every(([,start,end,,ids]) => {
    const s = new Date(start + "T12:00:00Z");
    return !isNaN(s) && s.toISOString().slice(0,10) === start &&
      (!end || (end >= start && !isNaN(new Date(end + "T12:00:00Z")))) &&
      ids.split(",").every(id => /^'(?:[A-Z]{2,3}|SDT-R)-[0-9]{4,5}'$/.test(id));
  }));
  assert.equal(entries.filter((x) => x[1]==="2025-10-14").length,1);
  assert.equal(entries.filter((x) => x[1]==="2025-10-15").length,1);
  assert.match(sql, /'2026-08-25'::date/);
  assert.doesNotMatch(sql, /'2026-08-24'::date/);
  assert.match(sql, /Dated practical sessions do not establish permanent commissioning/);
  assert.match(sql, /recorded 2 October; another worksheet has an inconsistent 2 September/);
});
