import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import test from "node:test";

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const helperSource = read("assets/js/connection_status.js");
const helper = await import(`data:text/javascript;base64,${Buffer.from(helperSource).toString("base64")}`);
const { CONNECTION_MESSAGE, connectionErrorMessage, isConnectionError, readWithDeadline } = helper;
const stripImports = (source) => source.replace(/^import[\s\S]*?;\r?\n/gm, "");

test("browser, SDK and Edge Function transport errors are explained without blaming credentials", () => {
  for (const message of ["Failed to fetch", "TypeError: Failed to fetch", "fetch failed", "NetworkError when attempting to fetch resource.", "Network request failed", "Load failed", "Connection timed out", "Failed to send a request to the Edge Function"]) {
    assert.equal(isConnectionError({ message }), true, message);
    assert.equal(connectionErrorMessage({ message }), CONNECTION_MESSAGE);
  }
});

test("server validation and access errors remain visible", () => {
  for (const message of ["Invalid login credentials", "JWT expired", "permission denied", "Too many requests", "Email not confirmed"]) {
    assert.equal(isConnectionError({ message }), false);
    assert.equal(connectionErrorMessage({ message }), message);
  }
  assert.equal(connectionErrorMessage(null, "Unavailable"), "Unavailable");
});

test("a stalled startup read is aborted once without retrying", async () => {
  let signal;
  let calls = 0;
  await assert.rejects(readWithDeadline((value) => {
    calls += 1;
    signal = value;
    return new Promise(() => {});
  }, 5), { name: "ConnectionTimeoutError" });
  assert.equal(signal.aborted, true);
  assert.equal(calls, 1);
});

test("completed reads preserve their result and do not abort later", async () => {
  let signal;
  const result = { allowed: true };
  assert.equal(await readWithDeadline((value) => { signal = value; return result; }, 5), result);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(signal.aborted, false);
});

test("read failures preserve the server error", async () => {
  const failure = new Error("permission denied");
  await assert.rejects(readWithDeadline(() => { throw failure; }), (error) => error === failure);
});

function nurseryFixture(firstResult) {
  const node = () => ({ dataset: {}, hidden: false, disabled: false, textContent: "", onclick: null });
  const nodes = Object.fromEntries(["reefSeaweedForm", "reefAccessStatus", "reefRetryConnection", "reefAccessGate", "reefSiteCaptureStatus"].map((id) => [id, node()]));
  nodes.reefAccessGate.hidden = true;
  nodes.reefRetryConnection.hidden = true;
  let result = firstResult;
  const calls = [];
  const signals = [];
  const events = [];
  const context = vm.createContext({
    ...helper,
    readWithDeadline: (fn) => readWithDeadline(fn, 15),
    crypto: { randomUUID: () => "synthetic-submission" },
    authClient: { rpc(name, args) {
      calls.push({ name, args });
      const pending = Promise.resolve().then(() => typeof result === "function" ? result() : result);
      return {
        abortSignal(signal) { signals.push(signal); return pending; },
        then(resolve, reject) { return pending.then(resolve, reject); }
      };
    } },
    document: {
      readyState: "loading", addEventListener() {}, getElementById: (id) => nodes[id] || null,
      body: { removeAttribute: (name) => events.push(name) }
    }
  });
  vm.runInContext(stripImports(read("assets/js/reef_nursery_site_capture.js")) + `
    let renders = 0;
    configureStandaloneShell = async () => {};
    renderForm = (form) => { renders += 1; form.dataset.siteCaptureProduction = "true"; };
    cacheElements = () => {};
    bindEvents = () => {};
    initializeNewCapture = (options) => { globalThis.initializationOptions = options; };
    globalThis.subject = { init, state, get renders() { return renders; } };
  `, context);
  return { h: context.subject, nodes, calls, signals, events, context, setResult(value) { result = value; } };
}

test("failed startup clears the stale loading state and can recover through the retry control", async () => {
  const f = nurseryFixture(() => { throw new TypeError("Failed to fetch"); });
  await f.h.init();
  assert.equal(f.nodes.reefAccessStatus.textContent, "Connection unavailable");
  assert.equal(f.nodes.reefSiteCaptureStatus.textContent, CONNECTION_MESSAGE);
  assert.equal(f.nodes.reefRetryConnection.hidden, false);
  assert.equal(f.nodes.reefRetryConnection.disabled, false);
  assert.equal(f.h.renders, 0);
  assert.equal(f.h.state.submissionId, "synthetic-submission");
  f.setResult({ data: { allowed: true, access_mode: "public", sites: [] }, error: null });
  await f.nodes.reefRetryConnection.onclick();
  assert.equal(f.h.renders, 1);
  assert.equal(f.nodes.reefRetryConnection.hidden, true);
  assert.equal(f.context.initializationOptions.preservePeople, true);
  assert.equal(f.context.initializationOptions.useStoredPeople, true);
  assert.equal(f.calls.length, 2);
  assert.equal(f.calls.every((call) => call.name === "ag_reef_site_capture_workspace_context"), true);
});

test("permission denial never renders the form or exposes a connection retry", async () => {
  const f = nurseryFixture({ data: { allowed: false, reason: "Organisation access denied" }, error: null });
  await f.h.init();
  assert.equal(f.nodes.reefAccessStatus.textContent, "Access unavailable");
  assert.equal(f.nodes.reefAccessGate.hidden, false);
  assert.equal(f.nodes.reefAccessGate.textContent, "Organisation access denied");
  assert.equal(f.nodes.reefSeaweedForm.hidden, true);
  assert.equal(f.nodes.reefRetryConnection.hidden, true);
  assert.equal(f.h.renders, 0);
});

test("concurrent startup attempts share the active read", async () => {
  let resolve;
  const pending = new Promise((done) => { resolve = done; });
  const f = nurseryFixture(() => pending);
  const initial = f.h.init();
  await f.h.init();
  resolve({ data: { allowed: true, sites: [] }, error: null });
  await initial;
  assert.equal(f.calls.length, 1);
  assert.equal(f.h.renders, 1);
});

test("a stalled workspace read reveals retry and never renders late data", async () => {
  let resolve;
  const f = nurseryFixture(() => new Promise((done) => { resolve = done; }));
  await f.h.init();
  assert.equal(f.signals[0].aborted, true);
  assert.equal(f.nodes.reefAccessStatus.textContent, "Connection unavailable");
  assert.equal(f.nodes.reefRetryConnection.hidden, false);
  resolve({ data: { allowed: true }, error: null });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(f.h.renders, 0);
});

test("an initialized form cannot be reinitialized and erase entered values", async () => {
  const f = nurseryFixture({ data: { allowed: true, sites: [] }, error: null });
  await f.h.init();
  f.nodes.reefSeaweedForm.syntheticUnsavedValue = "keep this";
  await f.h.init();
  assert.equal(f.calls.length, 1);
  assert.equal(f.h.renders, 1);
  assert.equal(f.nodes.reefSeaweedForm.syntheticUnsavedValue, "keep this");
});

function loginFixture() {
  const context = vm.createContext({
    ...helper, navigator: { onLine: true },
    document: { addEventListener() {} },
    sendPasswordReset: async () => { throw new TypeError("Failed to fetch"); }
  });
  vm.runInContext(stripImports(read("assets/js/login_page.js")) + `
    els.authStatus = { textContent: "", dataset: {} };
    els.resetEmail = { value: "synthetic@example.invalid" };
    globalThis.subject = { signInErrorMessage, handleReset, els };
  `, context);
  return context.subject;
}

test("sign-in distinguishes network failures from invalid credentials", () => {
  const h = loginFixture();
  assert.equal(h.signInErrorMessage(new TypeError("Failed to fetch")), CONNECTION_MESSAGE);
  assert.match(h.signInErrorMessage(new Error("Invalid login credentials")), /password is incorrect/);
  assert.match(h.signInErrorMessage(new Error("Email not confirmed")), /Confirm your email/);
  assert.match(h.signInErrorMessage(new Error("Too many requests")), /Too many sign-in attempts/);
});

test("a mocked reset transport failure never claims an email was sent", async () => {
  const h = loginFixture();
  await h.handleReset({ preventDefault() {} });
  assert.equal(h.els.authStatus.textContent, CONNECTION_MESSAGE);
  assert.equal(h.els.authStatus.dataset.status, "error");
});

test("the helper is precached without changing the cache namespace or cleanup behavior", () => {
  assert.match(read("service-worker.js"), /"\.\/assets\/js\/connection_status\.js"/);
  assert.match(read("service-worker.js"), /CACHE_VERSION = "seaweed-harvest-collection-v182-permissions-tide"/);
  for (const forbidden of ["localStorage", "indexedDB", "caches.", "signOut", "resetPassword"]) {
    assert.equal(helperSource.includes(forbidden), false, forbidden);
  }
  assert.match(read("reef_nursery_seaweed_data.html"), /id="reefRetryConnection"[^>]*type="button"[^>]*hidden/);
});
