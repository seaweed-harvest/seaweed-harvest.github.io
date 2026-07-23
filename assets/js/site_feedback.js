const FEEDBACK_API_URL = "https://wwzmajhdusfyfskppupg.supabase.co/functions/v1/site-feedback";
const FEEDBACK_API_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJ3d3ptYWpoZHVzZnlmc2twcHVwZyIsInJvbGUiOiJhbm9uIiwiaWF0IjoxNzgyNjA2OTM0LCJleHAiOjIwOTgxODI5MzR9.9W8zCF8cTjWn6ArYaJmvRNX9_wDlwsOLMDi8yh5c998";
const QUEUE_KEY = "seaweed:site-feedback:outbox:v1";
const CLIENT_KEY = "seaweed:site-feedback:client:v1";
const NAME_KEY = "seaweed:site-feedback:name:v1";
const MAX_MESSAGE_LENGTH = 2000;

const COPY = {
  en: {
    button: "Suggest an improvement",
    title: "Suggest an improvement",
    type: "Type",
    types: {
      improvement: "Improvement",
      change: "Change request",
      problem: "Problem or fix"
    },
    message: "Your suggestion",
    messagePlaceholder: "What could work better?",
    name: "Your name (optional)",
    quote: "Better ideas start with a question.",
    cancel: "Cancel",
    submit: "Send suggestion",
    sending: "Sending...",
    sent: "Thank you. Your suggestion was sent.",
    queued: "Saved on this device. It will send when online.",
    error: "The suggestion could not be sent. Please try again.",
    required: "Write a short suggestion before sending."
  },
  sw: {
    button: "Pendekeza maboresho",
    title: "Pendekeza maboresho",
    type: "Aina",
    types: {
      improvement: "Maboresho",
      change: "Ombi la mabadiliko",
      problem: "Tatizo au suluhisho"
    },
    message: "Pendekezo lako",
    messagePlaceholder: "Nini kinaweza kuboreshwa?",
    name: "Jina lako (si lazima)",
    quote: "Mawazo bora huanza na swali.",
    cancel: "Ghairi",
    submit: "Tuma pendekezo",
    sending: "Inatuma...",
    sent: "Asante. Pendekezo lako limetumwa.",
    queued: "Limehifadhiwa kwenye kifaa. Litatumwa mtandao ukirudi.",
    error: "Pendekezo halikutumwa. Tafadhali jaribu tena.",
    required: "Andika pendekezo fupi kabla ya kutuma."
  }
};

let widget = null;
let flushPromise = null;

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initialiseFeedbackWidget, { once: true });
} else {
  initialiseFeedbackWidget();
}

window.addEventListener("online", () => {
  flushFeedbackQueue();
});

function initialiseFeedbackWidget() {
  if (document.querySelector("[data-site-feedback-widget]")) return;
  injectStyles();

  const language = activeLanguage();
  const copy = COPY[language];
  const root = document.createElement("div");
  root.dataset.siteFeedbackWidget = "true";
  root.className = "site-feedback-widget";
  root.innerHTML = `
    <button class="site-feedback-launcher" type="button" aria-label="${copy.button}" title="${copy.button}">
      ${feedbackIcon()}
    </button>
    <dialog class="site-feedback-dialog" aria-labelledby="siteFeedbackTitle">
      <form class="site-feedback-form" method="dialog" novalidate>
        <header class="site-feedback-head">
          <div>
            <h2 id="siteFeedbackTitle">${copy.title}</h2>
            <p class="site-feedback-quote">
              <span>Better ideas start with a question.</span>
              <span lang="sw">Mawazo bora huanza na swali.</span>
            </p>
          </div>
          <button class="site-feedback-close" type="button" aria-label="${copy.cancel}" title="${copy.cancel}">
            ${closeIcon()}
          </button>
        </header>
        <label>
          <span>${copy.type} / ${COPY.sw.type}</span>
          <select name="feedbackType">
            <option value="improvement">${copy.types.improvement}</option>
            <option value="change">${copy.types.change}</option>
            <option value="problem">${copy.types.problem}</option>
          </select>
        </label>
        <label>
          <span>${copy.message} / ${COPY.sw.message}</span>
          <textarea name="message" rows="5" maxlength="${MAX_MESSAGE_LENGTH}" placeholder="${copy.messagePlaceholder}" required></textarea>
        </label>
        <label>
          <span>${copy.name} / ${COPY.sw.name}</span>
          <input name="submitterName" type="text" maxlength="100" autocomplete="name">
        </label>
        <label class="site-feedback-honeypot" aria-hidden="true">
          <span>Website</span>
          <input name="website" type="text" tabindex="-1" autocomplete="off">
        </label>
        <p class="site-feedback-status" role="status" aria-live="polite"></p>
        <div class="site-feedback-actions">
          <button class="site-feedback-cancel" type="button">${copy.cancel}</button>
          <button class="site-feedback-submit" type="submit">${copy.submit}</button>
        </div>
      </form>
    </dialog>`;
  document.body.append(root);

  const dialog = root.querySelector(".site-feedback-dialog");
  const form = root.querySelector(".site-feedback-form");
  const launcher = root.querySelector(".site-feedback-launcher");
  const close = root.querySelector(".site-feedback-close");
  const cancel = root.querySelector(".site-feedback-cancel");
  const name = form.elements.submitterName;
  name.value = storedValue(NAME_KEY) || signedInName() || "";

  launcher.addEventListener("click", () => openDialog(dialog));
  close.addEventListener("click", () => closeDialog(dialog));
  cancel.addEventListener("click", () => closeDialog(dialog));
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) closeDialog(dialog);
  });
  form.addEventListener("submit", submitFeedback);
  widget = { root, dialog, form, launcher, copy };
  flushFeedbackQueue();
}

async function submitFeedback(event) {
  event.preventDefault();
  if (!widget) return;

  const { form, copy } = widget;
  const message = String(form.elements.message.value || "").trim();
  const status = form.querySelector(".site-feedback-status");
  const submit = form.querySelector(".site-feedback-submit");
  if (message.length < 3) {
    setStatus(status, copy.required, "error");
    form.elements.message.focus();
    return;
  }

  const submitterName = String(form.elements.submitterName.value || "").trim();
  if (submitterName) storeValue(NAME_KEY, submitterName);
  const payload = buildPayload({
    feedbackType: form.elements.feedbackType.value,
    message,
    submitterName,
    website: form.elements.website.value
  });

  submit.disabled = true;
  submit.textContent = copy.sending;
  setStatus(status, "", "");

  try {
    const response = await sendFeedback(payload);
    if (!response.ok) throw new Error(response.error || copy.error);
    form.elements.message.value = "";
    setStatus(status, copy.sent, "success");
    window.setTimeout(() => closeDialog(widget.dialog), 1400);
  } catch (error) {
    if (!navigator.onLine || isNetworkError(error)) {
      enqueueFeedback(payload);
      form.elements.message.value = "";
      setStatus(status, copy.queued, "queued");
      window.setTimeout(() => closeDialog(widget.dialog), 1800);
    } else {
      setStatus(status, error.message || copy.error, "error");
    }
  } finally {
    submit.disabled = false;
    submit.textContent = copy.submit;
  }
}

function buildPayload({ feedbackType, message, submitterName, website }) {
  const sourceApp = detectSourceApp();
  return {
    submission_id: crypto.randomUUID(),
    source_app: sourceApp,
    source_page: pageName(),
    page_url: window.location.href.slice(0, 1000),
    feedback_type: feedbackType,
    message: message.slice(0, MAX_MESSAGE_LENGTH),
    submitter_name: submitterName || null,
    locale: activeLanguage(),
    client_token: clientToken(),
    user_agent: navigator.userAgent.slice(0, 500),
    website
  };
}

async function sendFeedback(payload) {
  const headers = {
    apikey: FEEDBACK_API_KEY,
    "Content-Type": "application/json"
  };
  const accessToken = signedInAccessToken();
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

  let response;
  try {
    response = await fetch(FEEDBACK_API_URL, {
      method: "POST",
      headers,
      body: JSON.stringify(payload)
    });
  } catch (error) {
    const networkError = new Error("Network request failed");
    networkError.cause = error;
    networkError.isNetworkError = true;
    throw networkError;
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || `Request failed (${response.status})`);
    error.status = response.status;
    throw error;
  }
  return data;
}

async function flushFeedbackQueue() {
  if (flushPromise || !navigator.onLine) return flushPromise;
  flushPromise = (async () => {
    const queue = feedbackQueue();
    if (!queue.length) return;
    const remaining = [];
    for (const payload of queue) {
      try {
        await sendFeedback(payload);
      } catch (error) {
        remaining.push(payload);
        if (isNetworkError(error)) {
          remaining.push(...queue.slice(queue.indexOf(payload) + 1));
          break;
        }
      }
    }
    saveFeedbackQueue(remaining);
  })().finally(() => {
    flushPromise = null;
  });
  return flushPromise;
}

function enqueueFeedback(payload) {
  const queue = feedbackQueue();
  if (!queue.some((item) => item.submission_id === payload.submission_id)) queue.push(payload);
  saveFeedbackQueue(queue.slice(-20));
}

function feedbackQueue() {
  try {
    const value = JSON.parse(localStorage.getItem(QUEUE_KEY) || "[]");
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function saveFeedbackQueue(queue) {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  } catch {
    // The on-screen error remains available when storage is blocked.
  }
}

function activeLanguage() {
  const stored = storedValue("seaweed_harvest:collection_language")
    || storedValue("seaweed_tide_planner:language")
    || document.documentElement.lang
    || navigator.language;
  return String(stored).toLowerCase().startsWith("sw") ? "sw" : "en";
}

function detectSourceApp() {
  const descriptor = `${document.title} ${location.hostname}`.toLowerCase();
  return descriptor.includes("tide") ? "tide" : "aggregation";
}

function pageName() {
  const heading = document.querySelector("main h1, main h2, .page-header h1, .app-header h1");
  return String(heading?.textContent || document.title || location.pathname)
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);
}

function clientToken() {
  const existing = storedValue(CLIENT_KEY);
  if (existing) return existing;
  const token = crypto.randomUUID();
  storeValue(CLIENT_KEY, token);
  return token;
}

function signedInAccessToken() {
  return authSession()?.access_token || null;
}

function signedInName() {
  const session = authSession();
  return session?.user?.user_metadata?.display_name
    || session?.user?.user_metadata?.full_name
    || "";
}

function authSession() {
  try {
    const session = JSON.parse(localStorage.getItem("seaweed-ag-auth") || "null");
    return session && typeof session === "object" ? session : null;
  } catch {
    return null;
  }
}

function openDialog(dialog) {
  if (typeof dialog.showModal === "function") dialog.showModal();
  else dialog.setAttribute("open", "");
  dialog.querySelector("textarea")?.focus();
}

function closeDialog(dialog) {
  if (typeof dialog.close === "function") dialog.close();
  else dialog.removeAttribute("open");
  widget?.launcher.focus();
}

function setStatus(element, message, state) {
  element.textContent = message;
  element.dataset.state = state;
}

function storedValue(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function storeValue(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Optional convenience only.
  }
}

function isNetworkError(error) {
  return Boolean(error?.isNetworkError || error instanceof TypeError);
}

function feedbackIcon() {
  return `<svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h6"></path>
    <path d="M18 2v6M15 5h6"></path>
  </svg>`;
}

function closeIcon() {
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"></path></svg>`;
}

function injectStyles() {
  if (document.getElementById("siteFeedbackStyles")) return;
  const styles = document.createElement("style");
  styles.id = "siteFeedbackStyles";
  styles.textContent = `
    .site-feedback-widget{--sf-teal:#087f78;--sf-ink:#123c38;--sf-line:#b9d9d5;--sf-soft:#f4fbfa;position:relative;z-index:1600}
    .site-feedback-launcher{position:fixed;right:18px;bottom:calc(18px + env(safe-area-inset-bottom,0px));width:48px;height:48px;padding:0;border:1px solid #fff;border-radius:50%;display:grid;place-items:center;background:var(--sf-teal);color:#fff;box-shadow:0 5px 18px rgba(19,75,70,.24);cursor:pointer;z-index:1601}
    .site-feedback-launcher:hover,.site-feedback-launcher:focus-visible{background:#056c66;transform:translateY(-1px)}
    .site-feedback-launcher svg{width:23px;height:23px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
    .site-feedback-dialog{width:min(430px,calc(100vw - 28px));max-height:min(680px,calc(100vh - 28px));padding:0;border:1px solid var(--sf-line);border-radius:8px;background:#fff;color:var(--sf-ink);box-shadow:0 18px 55px rgba(10,54,50,.24)}
    .site-feedback-dialog::backdrop{background:rgba(10,41,38,.38)}
    .site-feedback-form{display:grid;gap:14px;padding:20px}
    .site-feedback-head{display:flex;align-items:flex-start;justify-content:space-between;gap:14px}
    .site-feedback-head h2{margin:0;font-size:1.15rem;line-height:1.3;letter-spacing:0}
    .site-feedback-quote{display:grid;gap:2px;margin:5px 0 0;color:#718784;font-size:.84rem;line-height:1.35}
    .site-feedback-close{flex:0 0 34px;width:34px;height:34px;padding:0;border:1px solid var(--sf-line);border-radius:50%;display:grid;place-items:center;background:#fff;color:var(--sf-ink);cursor:pointer}
    .site-feedback-close svg{width:17px;height:17px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round}
    .site-feedback-form label{display:grid;gap:6px;color:#315e59;font-size:.82rem;font-weight:700;text-transform:uppercase}
    .site-feedback-form select,.site-feedback-form textarea,.site-feedback-form input{box-sizing:border-box;width:100%;min-height:42px;padding:10px 12px;border:1px solid var(--sf-line);border-radius:6px;background:#fff;color:#102f2c;font:inherit;font-size:.95rem;font-weight:400;text-transform:none;letter-spacing:0}
    .site-feedback-form textarea{min-height:112px;resize:vertical}
    .site-feedback-form select:focus,.site-feedback-form textarea:focus,.site-feedback-form input:focus{outline:2px solid rgba(8,127,120,.22);border-color:var(--sf-teal)}
    .site-feedback-honeypot{position:absolute!important;left:-9999px!important;width:1px!important;height:1px!important;overflow:hidden!important}
    .site-feedback-status{min-height:1.3em;margin:0;font-size:.88rem;color:#476b67}
    .site-feedback-status[data-state=success]{color:#08724e}
    .site-feedback-status[data-state=queued]{color:#8a5a00}
    .site-feedback-status[data-state=error]{color:#b42318}
    .site-feedback-actions{display:flex;justify-content:flex-end;gap:9px}
    .site-feedback-actions button{min-height:40px;padding:8px 14px;border:1px solid var(--sf-line);border-radius:6px;background:#fff;color:var(--sf-ink);font:inherit;font-weight:700;cursor:pointer}
    .site-feedback-actions .site-feedback-submit{border-color:var(--sf-teal);background:var(--sf-teal);color:#fff}
    .site-feedback-actions button:disabled{cursor:wait;opacity:.58}
    @media(max-width:600px){.site-feedback-launcher{right:12px;bottom:calc(12px + env(safe-area-inset-bottom,0px));width:46px;height:46px}.site-feedback-form{padding:17px}.site-feedback-dialog{max-height:calc(100dvh - 20px)}}
    @media(prefers-reduced-motion:no-preference){.site-feedback-launcher{transition:transform .16s ease,background-color .16s ease}}
    @media print{.site-feedback-widget{display:none!important}}
  `;
  document.head.append(styles);
}

