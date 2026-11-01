import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const read=path=>readFileSync(new URL(path,import.meta.url),"utf8");
const navigation=read("../assets/js/app_navigation.js");
const page=read("../assets/js/cosme_metrics_page.js");
const css=read("../assets/css/cosme_metrics.css");
const html=read("../cosme_metrics.html");
const home=read("../home.html");
const admin=read("../assets/js/admin_page.js");

test("metrics shortcut remains dependent on the server-side grant, not a profile flag",()=>{
  const section=navigation.split("// Metrics are granted independently")[1].split("function drawerGroup")[0];
  assert.ok(section);
  assert.match(section,/if \(profile\)/);
  assert.match(section,/authClient\.rpc\("cosme_metrics_my_access"\)/);
  assert.match(section,/if \(error \|\| !data\?\.can_view \|\| !group\.isConnected\) return;/);
  assert.match(section,/label: "Project Metrics", href: "\.\/cosme_metrics\.html"/);
  assert.doesNotMatch(section,/activeAggregatorCode\(profile\) === "COSME"/);
  assert.doesNotMatch(section,/can_view_data|can_manage_users|system_admin/);
});

test("server-granted metric shortcut is reachable from the mobile menu",()=>{
  assert.match(navigation,/menuButton\.addEventListener\("click", \(\) => setDrawerOpen/);
  assert.match(navigation,/group\.classList\.remove\("app-nav-desktop-only"\)/);
  assert.match(navigation,/group\.hidden = false/);
  assert.match(navigation,/if \(currentFile === "cosme_metrics\.html"\) group\.open = true/);
  assert.match(page,/app_navigation\.js\?v=17/);
  assert.match(admin,/app_navigation\.js\?v=17/);
  assert.match(home,/admin_page\.js\?v=36/);
});

test("metrics page opens directly on a phone without changing authentication rules",()=>{
  assert.match(html,/name="viewport" content="width=device-width, initial-scale=1"/);
  assert.match(page,/window\.location\.replace\("\.\/login\.html\?return=cosme_metrics\.html"\)/);
  assert.match(page,/authClient\.rpc\("cosme_metrics_my_access"\)/);
  assert.match(css,/@media \(max-width: 600px\) \{\s*\.cosme-metrics-page \.metrics-tabs \{\s*overflow-x: auto/);
  assert.match(css,/min-height: 44px/);
  assert.match(css,/bottom: env\(safe-area-inset-bottom, 0px\)/);
  assert.match(html,/id="metricsStickyScroll"/);
});
