import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";

const navigationSource = readFileSync(new URL("../assets/js/app_navigation.js", import.meta.url), "utf8")
  .replace(/^import .*?;\n/m, "")
  .replace(/export function/g, "function")
  .replace('void import("./platform_access.js?v=1")',
    'void Promise.resolve({ hasApplicationAccess: async () => false })')
  .replace('void import("./auth_client.js?v=25")',
    'void Promise.resolve({ authClient: { rpc: async () => ({ data: { can_view: true }, error: null }) } })')
  + "\nthis.navigationProbe = { populateAppSidebar, setupAppNavigation };";

class Element {
  constructor(tag, root = false) {
    this.tag = tag;
    this.root = root;
    this.children = [];
    this.parentNode = null;
    this.events = new Map();
    this.attrs = {};
    this.dataset = {};
    this.hidden = false;
    this.open = false;
    this._classes = new Set();
    this.classList = {
      add: (...values) => values.forEach((value) => this._classes.add(value)),
      remove: (...values) => values.forEach((value) => this._classes.delete(value)),
      toggle: (value, force) => {
        if (force ?? !this._classes.has(value)) this._classes.add(value);
        else this._classes.delete(value);
      },
      contains: (value) => this._classes.has(value)
    };
  }
  set className(value) { this._classes = new Set(String(value).split(/\s+/).filter(Boolean)); }
  get className() { return [...this._classes].join(" "); }
  get isConnected() { return this.root || Boolean(this.parentNode?.isConnected); }
  setAttribute(key, value) { this.attrs[key] = String(value); }
  getAttribute(key) { return this.attrs[key] ?? null; }
  removeAttribute(key) { delete this.attrs[key]; }
  addEventListener(key, callback) { this.events.set(key, callback); }
  fire(key) { this.events.get(key)?.({ target: this, key }); }
  append(...nodes) {
    nodes.forEach((node) => { node.parentNode = this; this.children.push(node); });
  }
  prepend(...nodes) {
    nodes.forEach((node) => { node.parentNode = this; });
    this.children.unshift(...nodes);
  }
  replaceChildren(...nodes) {
    this.children.forEach((node) => { node.parentNode = null; });
    this.children = [];
    this.append(...nodes);
  }
  remove() {
    if (this.parentNode) this.parentNode.children = this.parentNode.children.filter((child) => child !== this);
    this.parentNode = null;
  }
  replaceWith(replacement) {
    if (!this.parentNode) return;
    const index = this.parentNode.children.indexOf(this);
    this.parentNode.children.splice(index, 1, replacement);
    replacement.parentNode = this.parentNode;
    this.parentNode = null;
  }
  closest(selector) {
    if (selector === ".admin-layout" && this._classes.has("admin-layout")) return this;
    return this.parentNode?.closest(selector) ?? null;
  }
  matches(selector) {
    if (selector.startsWith(".")) return this.classList.contains(selector.slice(1));
    if (selector === "details[open]") return this.tag === "details" && this.open;
    if (selector === "a") return this.tag === "a";
    if (selector === "details.admin-menu-group") return this.tag === "details" && this.classList.contains("admin-menu-group");
    return this.tag === selector;
  }
  querySelectorAll(selector) {
    return this.children.flatMap((child) => [
      ...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)
    ]);
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
  getBoundingClientRect() { return { height: 68 }; }
  focus() {}
}

function createHarness(width, code) {
  const body = new Element("body", true);
  const header = new Element("header", true);
  header.classList.add("app-header");
  const actions = new Element("div");
  actions.classList.add("header-actions");
  header.append(actions);
  body.append(header);
  const sidebar = new Element("aside", true);
  body.append(sidebar);
  const document = {
    body,
    documentElement: { style: { setProperty() {} } },
    createElement: (tag) => new Element(tag),
    createElementNS: (_namespace, tag) => new Element(tag),
    createComment: () => new Element("comment"),
    querySelector: (selector) => body.querySelector(selector),
    addEventListener() {}
  };
  const window = {
    location: { pathname: "/home.html", search: "" },
    matchMedia: () => ({ matches: width <= 980, addEventListener() {} }),
    addEventListener() {}
  };
  const context = { document, window, localStorage: { getItem: () => null, setItem() {} },
    requestAnimationFrame: (callback) => callback(), startOfflineCollectionAutoSync() {} };
  runInNewContext(navigationSource, context);
  const profile = {
    id: "synthetic-user", app_role: "system_admin", active_aggregator_code: code,
    is_protected_owner: true, can_view_data: true, can_view_finance: true,
    can_access_reef_nursery: code === "COSME", can_export_backups: true,
    organisation_capabilities: {
      form_intake_collection: code === "MAWIMBI",
      form_stock_record: code === "MAWIMBI",
      form_process_record: code === "MAWIMBI",
      form_site_water_samples: code === "MAWIMBI",
      form_reef_nursery: code === "COSME",
      form_dryer_table: code === "COSME",
      form_green_space: code === "SANDBOX",
      tool_pricing: true, tool_sms: true, tool_notifications: true, tool_form_builder: true,
      tool_qr_tags: true
    }
  };
  const nav = context.navigationProbe;
  nav.populateAppSidebar(sidebar, { profile, currentFile: "home.html" });
  const result = nav.setupAppNavigation({ profile, sidebar, header });
  return { body, sidebar, result, profile };
}

function groupLabels(sidebar, heading) {
  const group = sidebar.querySelectorAll("details.admin-menu-group")
    .find((entry) => entry.querySelector("summary")?.textContent === heading);
  assert.ok(group, `${heading} group exists`);
  return group.querySelectorAll("a").map((link) => link.textContent);
}

test("desktop and phone menus preserve operational links and bench experiments", async () => {
  for (const width of [1440, 390]) {
    for (const org of ["COSME", "MAWIMBI", "SANDBOX"]) {
      const { sidebar, result } = createHarness(width, org);
      await new Promise((resolve) => setImmediate(resolve));
      const forms = groupLabels(sidebar, "Forms");
      const records = groupLabels(sidebar, "Records");
      const tools = groupLabels(sidebar, "Tools");
      const allLabels = [...forms, ...records, ...tools];
      for (const label of ["Green Space Log", "Notifications", "SMS Settings", "Tags",
        "Finance Review", "Form Manager", "Form Builder", "Project Journal"]) {
        assert.ok(!allLabels.includes(label), `${org} at ${width}px hides ${label}`);
      }
      assert.equal(tools.filter((name) => name === "Project Summary").length, 1);
      assert.ok(tools.includes("Pricing Matrix"));
      if (org === "SANDBOX") {
        assert.deepEqual(forms, []);
        assert.ok(records.includes("Ledger Transcriptions"));
      }
      if (org === "MAWIMBI") {
        for (const label of ["Dataset Dashboard", "Backups", "Mawimbi Process Flow", "Receipts"]) {
          assert.ok(tools.includes(label), `${label} stays for Mawimbi`);
        }
      }
      if (org === "COSME") assert.ok(forms.includes("Nursery - Seaweed Data"));
      if (width === 390) {
        result.menuButton.fire("click");
        assert.equal(result.drawer.classList.contains("is-open"), true);
        result.setDrawerOpen(false);
        assert.equal(result.drawer.classList.contains("is-open"), false);
      }
    }
  }
});
