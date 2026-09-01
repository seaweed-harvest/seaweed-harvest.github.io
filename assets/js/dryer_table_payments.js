import { currentAccessToken, currentProfile } from "./auth_client.js?v=25";
import { DRYING_FORM_CONFIG } from "./dryer_table_config.js?v=2";
import { calculateSelectedPayment } from "./dryer_payment_math.js?v=1";

export { calculateSelectedPayment } from "./dryer_payment_math.js?v=1";

const PAYMENT_WORKSPACE_RPC = "list_authenticated_seaweed_drying_payment_workspace";
const SAVE_DECISION_RPC = "save_authenticated_seaweed_drying_activity_day_decision";
const RECORD_ADVANCE_RPC = "record_authenticated_seaweed_drying_phone_advance";
const RECORD_PAYMENT_RPC = "record_authenticated_seaweed_drying_activity_payment";
const KENYA_TIME_ZONE = "Africa/Nairobi";

let autoController = null;

document.addEventListener("DOMContentLoaded", () => {
  void bootstrapDryerPayments();
});

async function bootstrapDryerPayments() {
  const paymentsTab = document.getElementById("dryerPaymentsTab");
  const paymentsPanel = document.getElementById("dryerPaymentsPanel");
  if (!paymentsTab || !paymentsPanel || paymentsPanel.dataset.paymentsReady === "true") {
    return;
  }

  await waitForAuthenticatedShell();
  if (document.body.hasAttribute("data-auth-pending")) return;

  try {
    const profile = await currentProfile();
    if (!canUseDryerPayments(profile)) {
      paymentsTab.hidden = true;
      paymentsPanel.hidden = true;
      if (paymentsTab.getAttribute("aria-selected") === "true") {
        document.getElementById("dryerAllTab")?.click();
      }
      return;
    }

    autoController = initialiseDryerPayments({ profile });
    paymentsPanel.dataset.paymentsReady = "true";
    paymentsTab.addEventListener("click", () => {
      queueMicrotask(() => { void autoController?.activate(); });
    });
    document.getElementById("reloadDryerRecords")?.addEventListener("click", () => {
      if (paymentsTab.getAttribute("aria-selected") === "true") {
        void autoController?.reload();
      }
    });
    if (paymentsTab.getAttribute("aria-selected") === "true") {
      await autoController?.activate();
    }
  } catch (error) {
    const status = document.getElementById("dryerPaymentActivityStatus");
    setStatus(status, error?.message || String(error), "error");
  }
}

function waitForAuthenticatedShell(timeoutMs = 15000) {
  if (!document.body.hasAttribute("data-auth-pending")) return Promise.resolve();
  return new Promise((resolve) => {
    const observer = new MutationObserver(() => {
      if (!document.body.hasAttribute("data-auth-pending")) {
        observer.disconnect();
        window.clearTimeout(timeout);
        resolve();
      }
    });
    observer.observe(document.body, { attributes: true, attributeFilter: ["data-auth-pending"] });
    const timeout = window.setTimeout(() => {
      observer.disconnect();
      resolve();
    }, timeoutMs);
  });
}

export function canUseDryerPayments(profile) {
  return profile?.is_protected_owner === true && (
    profile?.app_role === "system_admin"
    || (
      profile?.can_access_admin === true
      && profile?.can_view_data === true
      && profile?.can_view_finance === true
    )
  );
}

export function initialiseDryerPayments({ profile } = {}) {
  if (!canUseDryerPayments(profile)) return null;

  const controller = new DryerPaymentsController(profile);
  controller.initialise();
  return {
    activate: () => controller.activate(),
    reload: () => controller.reload()
  };
}

class DryerPaymentsController {
  constructor(profile) {
    this.profile = profile;
    this.state = {
      activityDays: [],
      payments: [],
      assistants: [],
      activeView: "activity",
      selectedDecisionIds: new Set(),
      expandedDays: new Set(),
      expandedPayments: new Set(),
      loaded: false,
      loading: false
    };
    this.els = {};
  }

  initialise() {
    this.cacheElements();
    this.bindEvents();
    this.setPaymentView("activity");
    this.setDefaultDates();
  }

  cacheElements() {
    [
      "dryerPaymentTabs",
      "dryerPaymentActivityTab",
      "dryerPaymentLedgerTab",
      "dryerPaymentSummaryMetrics",
      "dryerPaymentActivityPanel",
      "dryerPaymentLedgerPanel",
      "dryerActivityDayRows",
      "dryerPaymentActivityStatus",
      "dryerPaymentSelectionPanel",
      "dryerPaymentSelectedCount",
      "dryerPaymentSelectedWork",
      "dryerPaymentSelectedPhone",
      "dryerPaymentSelectedCredit",
      "dryerPaymentSelectedTransfer",
      "dryerPaymentDate",
      "dryerPaymentReference",
      "dryerPaymentNote",
      "dryerRecordSelectedPayment",
      "dryerClearPaymentSelection",
      "dryerAdvanceForm",
      "dryerAdvanceAssistant",
      "dryerAdvanceDate",
      "dryerAdvanceAmount",
      "dryerAdvanceReference",
      "dryerAdvanceNote",
      "dryerAdvanceStatus",
      "dryerPaymentLedgerRows",
      "dryerPaymentLedgerStatus"
    ].forEach((id) => {
      this.els[id] = document.getElementById(id);
    });
  }

  bindEvents() {
    this.els.dryerPaymentTabs?.addEventListener("click", (event) => {
      const button = event.target.closest("[data-dryer-payment-tab]");
      if (button) this.setPaymentView(button.dataset.dryerPaymentTab);
    });
    this.els.dryerPaymentTabs?.addEventListener("keydown", (event) => {
      this.handleSubtabKeydown(event);
    });
    this.els.dryerActivityDayRows?.addEventListener("click", (event) => {
      void this.handleActivityDayClick(event);
    });
    this.els.dryerActivityDayRows?.addEventListener("change", (event) => {
      this.handleActivityDayChange(event);
    });
    this.els.dryerActivityDayRows?.addEventListener("input", (event) => {
      this.updateRowApprovedTotal(event.target.closest("[data-payment-day-row]"));
    });
    this.els.dryerRecordSelectedPayment?.addEventListener("click", () => {
      void this.recordSelectedPayment();
    });
    this.els.dryerClearPaymentSelection?.addEventListener("click", () => {
      this.state.selectedDecisionIds.clear();
      this.renderActivityDays();
    });
    this.els.dryerAdvanceForm?.addEventListener("submit", (event) => {
      event.preventDefault();
      void this.recordPhoneAdvance();
    });
    this.els.dryerPaymentLedgerRows?.addEventListener("click", (event) => {
      this.handlePaymentToggle(event);
    });
  }

  setDefaultDates() {
    const today = kenyaDateKey(new Date());
    if (this.els.dryerPaymentDate && !this.els.dryerPaymentDate.value) {
      this.els.dryerPaymentDate.value = today;
    }
    if (this.els.dryerAdvanceDate && !this.els.dryerAdvanceDate.value) {
      this.els.dryerAdvanceDate.value = today;
    }
  }

  async activate() {
    if (!this.state.loaded) await this.loadWorkspace();
  }

  async reload() {
    await this.loadWorkspace();
  }

  setPaymentView(view) {
    this.state.activeView = view === "ledger" ? "ledger" : "activity";
    const activityActive = this.state.activeView === "activity";
    this.els.dryerPaymentActivityPanel.hidden = !activityActive;
    this.els.dryerPaymentLedgerPanel.hidden = activityActive;

    [
      [this.els.dryerPaymentActivityTab, activityActive],
      [this.els.dryerPaymentLedgerTab, !activityActive]
    ].forEach(([button, active]) => {
      if (!button) return;
      button.setAttribute("aria-selected", String(active));
      button.tabIndex = active ? 0 : -1;
    });
  }

  handleSubtabKeydown(event) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const buttons = [
      this.els.dryerPaymentActivityTab,
      this.els.dryerPaymentLedgerTab
    ].filter(Boolean);
    const current = buttons.findIndex(
      (button) => button.getAttribute("aria-selected") === "true"
    );
    let next = current;
    if (event.key === "Home") next = 0;
    else if (event.key === "End") next = buttons.length - 1;
    else if (event.key === "ArrowLeft") next = Math.max(0, current - 1);
    else next = Math.min(buttons.length - 1, current + 1);
    const button = buttons[next];
    if (!button) return;
    this.setPaymentView(button.dataset.dryerPaymentTab);
    button.focus();
  }

  async loadWorkspace() {
    if (this.state.loading) return;
    this.state.loading = true;
    this.setBusy(true);
    setStatus(this.els.dryerPaymentActivityStatus, "Loading activity days...");
    setStatus(this.els.dryerPaymentLedgerStatus, "Loading payment ledger...");
    try {
      const data = await callPaymentRpc(PAYMENT_WORKSPACE_RPC, {
        p_limit: 5000
      });
      this.state.activityDays = Array.isArray(data?.activity_days)
        ? data.activity_days
        : [];
      this.state.payments = Array.isArray(data?.payments) ? data.payments : [];
      this.state.assistants = Array.isArray(data?.assistants)
        ? data.assistants
        : [];
      this.state.loaded = true;
      this.pruneSelection();
      this.populateAssistantOptions();
      this.render();
    } catch (error) {
      const message = error?.message || String(error);
      this.els.dryerActivityDayRows.innerHTML = emptyRow(
        9,
        `Unable to load activity days. ${message}`
      );
      this.els.dryerPaymentLedgerRows.innerHTML = emptyRow(
        8,
        `Unable to load the payment ledger. ${message}`
      );
      setStatus(this.els.dryerPaymentActivityStatus, message, "error");
      setStatus(this.els.dryerPaymentLedgerStatus, message, "error");
    } finally {
      this.state.loading = false;
      this.setBusy(false);
    }
  }

  setBusy(busy) {
    if (this.els.dryerRecordSelectedPayment) {
      this.els.dryerRecordSelectedPayment.disabled = busy;
    }
    if (this.els.dryerAdvanceForm) {
      [...this.els.dryerAdvanceForm.elements].forEach((element) => {
        element.disabled = busy;
      });
    }
  }

  render() {
    this.renderSummary();
    this.renderActivityDays();
    this.renderPaymentLedger();
    this.setDefaultDates();
  }

  pruneSelection() {
    const eligibleIds = new Set(
      this.state.activityDays
        .filter((day) => isSelectableDay(day))
        .map((day) => String(day.decision_id))
    );
    [...this.state.selectedDecisionIds].forEach((id) => {
      if (!eligibleIds.has(id)) this.state.selectedDecisionIds.delete(id);
    });
  }

  populateAssistantOptions() {
    const previous = this.els.dryerAdvanceAssistant?.value || "";
    const options = this.state.assistants
      .map((assistant) => (
        `<option value="${escapeAttribute(assistant.assistant_key)}">`
        + `${escapeHtml(assistant.assistant_name || assistant.assistant_key)}</option>`
      ))
      .join("");
    if (this.els.dryerAdvanceAssistant) {
      this.els.dryerAdvanceAssistant.innerHTML = options
        || '<option value="">No Research Assistant found</option>';
      if (
        previous
        && this.state.assistants.some(
          (assistant) => assistant.assistant_key === previous
        )
      ) {
        this.els.dryerAdvanceAssistant.value = previous;
      }
    }
  }

  renderSummary() {
    const needsReview = this.state.activityDays.filter(
      (day) => day.payment_status === "needs_review"
    ).length;
    const approvedDays = this.state.activityDays.filter(
      (day) => isSelectableDay(day)
    );
    const creditByAssistant = this.creditByAssistant();
    const dueByAssistant = new Map();

    approvedDays.forEach((day) => {
      if (!dueByAssistant.has(day.assistant_key)) {
        dueByAssistant.set(day.assistant_key, []);
      }
      dueByAssistant.get(day.assistant_key).push(day);
    });

    let currentDue = 0;
    dueByAssistant.forEach((days, assistantKey) => {
      currentDue += calculateSelectedPayment(
        days,
        creditByAssistant.get(assistantKey) || 0
      ).transferAmount;
    });

    const totalCredit = [...creditByAssistant.values()].reduce(
      (sum, amount) => sum + amount,
      0
    );
    const labels = [
      `Needs review: ${formatInteger(needsReview)}`,
      `Approved unpaid: ${formatInteger(approvedDays.length)}`,
      `Phone/data credit: ${formatKes(totalCredit)}`,
      `Current amount due: ${formatKes(currentDue)}`
    ];
    this.els.dryerPaymentSummaryMetrics.innerHTML = labels
      .map((label) => `<span class="status-pill">${escapeHtml(label)}</span>`)
      .join("");
  }

  renderActivityDays() {
    if (!this.state.activityDays.length) {
      this.els.dryerActivityDayRows.innerHTML = emptyRow(
        9,
        "No dryer loading or unloading activity days are available."
      );
      this.renderSelectionPanel();
      setStatus(this.els.dryerPaymentActivityStatus, "0 activity days");
      return;
    }

    const rows = [];
    this.state.activityDays.forEach((day) => {
      rows.push(this.activityDayRowMarkup(day));
      rows.push(this.activityDayDetailMarkup(day));
    });
    this.els.dryerActivityDayRows.innerHTML = rows.join("");
    this.renderSelectionPanel();
    setStatus(
      this.els.dryerPaymentActivityStatus,
      `${this.state.activityDays.length} ${
        this.state.activityDays.length === 1 ? "activity day" : "activity days"
      }`
    );
  }

  activityDayRowMarkup(day) {
    const decisionId = day.decision_id ? String(day.decision_id) : "";
    const selectable = isSelectableDay(day);
    const selected = selectable && this.state.selectedDecisionIds.has(decisionId);
    const paid = day.payment_status === "paid";
    const stale = day.source_changed_since_approval === true;
    const workValue = day.qualifies
      ? nonNegativeInteger(day.contract_amount_kes)
      : optionalInteger(day.approved_work_amount_kes);
    const phoneValue = day.decision_id
      ? String(nonNegativeInteger(day.phone_data_allowance_kes))
      : "";
    const approvedTotal = workValue === null || phoneValue === ""
      ? null
      : workValue + Number(phoneValue);
    const expanded = this.state.expandedDays.has(dayKey(day));
    const workHint = day.qualifies
      ? `Contract ${formatKes(day.contract_amount_kes)}`
      : `Reference ${formatKes(day.reference_amount_kes)}`;
    const workReadonly = day.qualifies || paid ? " readonly" : "";
    const controlsDisabled = paid ? " disabled" : "";
    const buttonLabel = day.decision_id ? "Update" : "Approve";

    return `<tr data-payment-day-row data-assistant-key="${escapeAttribute(
      day.assistant_key
    )}" data-activity-date="${escapeAttribute(day.activity_date)}" data-decision-id="${escapeAttribute(
      decisionId
    )}">
      <td class="selection-cell">${
        selectable
          ? `<input type="checkbox" data-payment-day-select value="${escapeAttribute(
              decisionId
            )}" aria-label="Select ${escapeAttribute(
              formatDateKey(day.activity_date)
            )} for payment"${selected ? " checked" : ""}>`
          : "—"
      }</td>
      <td>
        <button class="dryer-payment-disclosure" type="button" data-payment-day-toggle aria-expanded="${
          expanded ? "true" : "false"
        }" aria-label="${expanded ? "Collapse" : "Expand"} ${escapeAttribute(
          formatDateKey(day.activity_date)
        )}">${expanded ? "▾" : "▸"}</button>
        <strong>${escapeHtml(formatDateKey(day.activity_date))}</strong>
      </td>
      <td>${escapeHtml(day.assistant_name || day.assistant_key || "—")}</td>
      <td>${escapeHtml(
        `${formatInteger(day.loading_count)} L / ${formatInteger(
          day.unloading_count
        )} U`
      )}</td>
      <td>${dayQualificationPill(day)}${
        stale
          ? '<span class="status-pill status-muted">Records changed</span>'
          : ""
      }</td>
      <td>
        <span class="field-hint dryer-payment-reference">${escapeHtml(
          workHint
        )}</span>
        <input class="dryer-payment-amount-input" type="number" min="0" max="1000000" step="25" data-payment-work-input value="${
          workValue === null ? "" : escapeAttribute(workValue)
        }" aria-label="Approved work amount for ${escapeAttribute(
          formatDateKey(day.activity_date)
        )}"${workReadonly}${controlsDisabled}>
      </td>
      <td>
        <select data-payment-phone-select aria-label="Phone and data allowance for ${escapeAttribute(
          formatDateKey(day.activity_date)
        )}"${controlsDisabled}>
          <option value=""${phoneValue === "" ? " selected" : ""}>Not set</option>
          <option value="0"${phoneValue === "0" ? " selected" : ""}>No allowance</option>
          <option value="100"${phoneValue === "100" ? " selected" : ""}>KES 100</option>
        </select>
      </td>
      <td><strong data-payment-approved-total>${
        approvedTotal === null ? "—" : escapeHtml(formatKes(approvedTotal))
      }</strong></td>
      <td>${this.paymentStatusMarkup(day)}${
        paid
          ? ""
          : `<button type="button" data-save-payment-day>${escapeHtml(
              buttonLabel
            )}</button>`
      }</td>
    </tr>`;
  }

  activityDayDetailMarkup(day) {
    const expanded = this.state.expandedDays.has(dayKey(day));
    const events = Array.isArray(day.events) ? day.events : [];
    const evidence = events.length
      ? events
          .map(
            (event) => `<li><strong>${escapeHtml(
              event.table_location || event.receipt_number || "Drying event"
            )}</strong> — ${escapeHtml(
              `${formatInteger(event.loading_count)} loadings / ${formatInteger(
                event.unloading_count
              )} unloadings`
            )}</li>`
          )
          .join("")
      : "<li>No current source-event detail is available.</li>";
    const paid = day.payment_status === "paid";
    const approvalMeta = day.decision_id
      ? `<span class="field-hint">Last approved ${
          day.approved_at ? escapeHtml(formatDateTime(day.approved_at)) : "—"
        }${day.approved_by_name ? ` by ${escapeHtml(day.approved_by_name)}` : ""}.</span>`
      : '<span class="field-hint">This day has not yet been approved.</span>';
    const paidMeta = paid
      ? `<span class="field-hint">Paid ${escapeHtml(
          formatDateKey(day.payment_date)
        )}${day.payment_reference ? ` · ${escapeHtml(day.payment_reference)}` : ""}.</span>`
      : "";

    return `<tr class="dryer-payment-detail-row" data-payment-day-detail${
      expanded ? "" : " hidden"
    }>
      <td colspan="9">
        <div class="dryer-payment-detail-grid">
          <div>
            <strong>Recorded activity</strong>
            <ul>${evidence}</ul>
          </div>
          <label>
            Approval note
            ${
              paid
                ? `<p>${textOrDash(day.approval_note)}</p>`
                : `<textarea rows="2" maxlength="2000" data-payment-note-input placeholder="Optional reason or context, particularly for below-minimum days.">${escapeHtml(
                    day.approval_note || ""
                  )}</textarea>`
            }
          </label>
          <div>${approvalMeta}<br>${paidMeta}${
            day.source_changed_since_payment
              ? '<br><span class="status-pill status-muted">Source records changed after payment</span>'
              : ""
          }</div>
        </div>
      </td>
    </tr>`;
  }

  paymentStatusMarkup(day) {
    if (day.payment_status === "paid") {
      return `<span class="status-pill">Paid</span><span class="field-hint">${escapeHtml(
        formatKes(day.day_transfer_amount_kes)
      )} transferred</span>`;
    }
    if (
      day.payment_status === "approved_unpaid"
      && day.source_changed_since_approval !== true
    ) {
      return '<span class="status-pill">Approved / unpaid</span>';
    }
    return '<span class="status-pill status-muted">Needs review</span>';
  }

  handleActivityDayChange(event) {
    const checkbox = event.target.closest("[data-payment-day-select]");
    if (checkbox) {
      this.updateSelection(checkbox);
      return;
    }
    const row = event.target.closest("[data-payment-day-row]");
    if (row) this.updateRowApprovedTotal(row);
  }

  async handleActivityDayClick(event) {
    const toggle = event.target.closest("[data-payment-day-toggle]");
    if (toggle) {
      this.toggleActivityDay(toggle);
      return;
    }
    const save = event.target.closest("[data-save-payment-day]");
    if (save) await this.saveActivityDay(save);
  }

  toggleActivityDay(button) {
    const row = button.closest("[data-payment-day-row]");
    const detail = row?.nextElementSibling;
    if (!row || !detail?.hasAttribute("data-payment-day-detail")) return;
    const key = `${row.dataset.assistantKey}:${row.dataset.activityDate}`;
    const expanded = button.getAttribute("aria-expanded") !== "true";
    button.setAttribute("aria-expanded", String(expanded));
    button.textContent = expanded ? "▾" : "▸";
    button.setAttribute(
      "aria-label",
      `${expanded ? "Collapse" : "Expand"} ${formatDateKey(
        row.dataset.activityDate
      )}`
    );
    detail.hidden = !expanded;
    if (expanded) this.state.expandedDays.add(key);
    else this.state.expandedDays.delete(key);
  }

  updateSelection(checkbox) {
    const decisionId = String(checkbox.value || "");
    const day = this.dayByDecisionId(decisionId);
    if (!decisionId || !day || !isSelectableDay(day)) {
      checkbox.checked = false;
      return;
    }

    if (checkbox.checked) {
      const existing = this.selectedDays()[0];
      if (existing && existing.assistant_key !== day.assistant_key) {
        checkbox.checked = false;
        setStatus(
          this.els.dryerPaymentActivityStatus,
          "Select activity days for one Research Assistant at a time.",
          "error"
        );
        return;
      }
      this.state.selectedDecisionIds.add(decisionId);
    } else {
      this.state.selectedDecisionIds.delete(decisionId);
    }
    this.renderSelectionPanel();
  }

  updateRowApprovedTotal(row) {
    if (!row) return;
    const workInput = row.querySelector("[data-payment-work-input]");
    const phoneSelect = row.querySelector("[data-payment-phone-select]");
    const total = row.querySelector("[data-payment-approved-total]");
    if (!workInput || !phoneSelect || !total) return;
    const work = optionalInteger(workInput.value);
    const phone = phoneSelect.value === ""
      ? null
      : optionalInteger(phoneSelect.value);
    total.textContent = work === null || phone === null
      ? "—"
      : formatKes(work + phone);
  }

  async saveActivityDay(button) {
    const row = button.closest("[data-payment-day-row]");
    const detail = row?.nextElementSibling;
    if (!row) return;
    const day = this.state.activityDays.find(
      (candidate) => (
        candidate.assistant_key === row.dataset.assistantKey
        && candidate.activity_date === row.dataset.activityDate
      )
    );
    if (!day || day.payment_status === "paid") return;

    const workInput = row.querySelector("[data-payment-work-input]");
    const phoneSelect = row.querySelector("[data-payment-phone-select]");
    const noteInput = detail?.querySelector("[data-payment-note-input]");
    const workAmount = optionalInteger(workInput?.value);
    const phoneAmount = optionalInteger(phoneSelect?.value);

    if (workAmount === null || workAmount < 0) {
      setStatus(
        this.els.dryerPaymentActivityStatus,
        "Enter the approved work amount for this day.",
        "error"
      );
      workInput?.focus();
      return;
    }
    if (phoneAmount === null || ![0, 100].includes(phoneAmount)) {
      setStatus(
        this.els.dryerPaymentActivityStatus,
        "Set phone/data to No allowance or KES 100.",
        "error"
      );
      phoneSelect?.focus();
      return;
    }
    if (
      day.qualifies
      && workAmount !== nonNegativeInteger(day.contract_amount_kes)
    ) {
      setStatus(
        this.els.dryerPaymentActivityStatus,
        `This qualifying day must use ${formatKes(
          day.contract_amount_kes
        )}.`,
        "error"
      );
      return;
    }

    button.disabled = true;
    try {
      await callPaymentRpc(SAVE_DECISION_RPC, {
        p_assistant_key: day.assistant_key,
        p_activity_date: day.activity_date,
        p_approved_work_amount_kes: workAmount,
        p_phone_data_allowance_kes: phoneAmount,
        p_approval_note: String(noteInput?.value || "").trim() || null
      });
      setStatus(
        this.els.dryerPaymentActivityStatus,
        `${formatDateKey(day.activity_date)} approved.`
      );
      await this.loadWorkspace();
    } catch (error) {
      setStatus(
        this.els.dryerPaymentActivityStatus,
        error?.message || String(error),
        "error"
      );
    } finally {
      button.disabled = false;
    }
  }

  selectedDays() {
    return this.state.activityDays.filter(
      (day) => (
        day.decision_id
        && this.state.selectedDecisionIds.has(String(day.decision_id))
        && isSelectableDay(day)
      )
    );
  }

  dayByDecisionId(decisionId) {
    return this.state.activityDays.find(
      (day) => String(day.decision_id || "") === String(decisionId || "")
    );
  }

  creditByAssistant() {
    return new Map(
      this.state.assistants.map((assistant) => [
        assistant.assistant_key,
        nonNegativeInteger(assistant.phone_data_credit_balance_kes)
      ])
    );
  }

  renderSelectionPanel() {
    const days = this.selectedDays();
    this.els.dryerPaymentSelectionPanel.hidden = days.length === 0;
    if (!days.length) return;

    const assistantKey = days[0].assistant_key;
    const credit = this.creditByAssistant().get(assistantKey) || 0;
    const totals = calculateSelectedPayment(days, credit);
    this.els.dryerPaymentSelectedCount.textContent = `${
      totals.dayCount
    } ${totals.dayCount === 1 ? "day" : "days"} selected`;
    this.els.dryerPaymentSelectedWork.textContent = formatKes(
      totals.workAmount
    );
    this.els.dryerPaymentSelectedPhone.textContent = formatKes(
      totals.phoneDataAmount
    );
    this.els.dryerPaymentSelectedCredit.textContent = `− ${formatKes(
      totals.phoneDataCreditApplied
    )}`;
    this.els.dryerPaymentSelectedTransfer.textContent = formatKes(
      totals.transferAmount
    );
    this.els.dryerRecordSelectedPayment.disabled = false;
  }

  async recordSelectedPayment() {
    const days = this.selectedDays();
    if (!days.length) return;
    const paymentDate = this.els.dryerPaymentDate.value;
    if (!paymentDate) {
      setStatus(
        this.els.dryerPaymentActivityStatus,
        "Choose the payment date.",
        "error"
      );
      this.els.dryerPaymentDate.focus();
      return;
    }

    const credit = this.creditByAssistant().get(days[0].assistant_key) || 0;
    const totals = calculateSelectedPayment(days, credit);
    const confirmation = [
      `Record payment for ${days.length} activity ${
        days.length === 1 ? "day" : "days"
      }?`,
      `Work: ${formatKes(totals.workAmount)}`,
      `Phone/data: ${formatKes(totals.phoneDataAmount)}`,
      `Advance credit applied: ${formatKes(
        totals.phoneDataCreditApplied
      )}`,
      `Transfer now: ${formatKes(totals.transferAmount)}`,
      "",
      "This creates an immutable ledger entry and the selected days cannot be paid again."
    ].join("\n");
    if (!window.confirm(confirmation)) return;

    this.els.dryerRecordSelectedPayment.disabled = true;
    try {
      await callPaymentRpc(RECORD_PAYMENT_RPC, {
        p_client_request_id: randomUuid(),
        p_activity_day_decision_ids: days.map((day) => day.decision_id),
        p_payment_date: paymentDate,
        p_reference:
          String(this.els.dryerPaymentReference.value || "").trim() || null,
        p_note: String(this.els.dryerPaymentNote.value || "").trim() || null
      });
      this.state.selectedDecisionIds.clear();
      this.els.dryerPaymentReference.value = "";
      this.els.dryerPaymentNote.value = "";
      await this.loadWorkspace();
      this.setPaymentView("ledger");
      setStatus(
        this.els.dryerPaymentLedgerStatus,
        `Payment recorded: ${formatKes(totals.transferAmount)} transferred.`
      );
    } catch (error) {
      setStatus(
        this.els.dryerPaymentActivityStatus,
        error?.message || String(error),
        "error"
      );
    } finally {
      this.els.dryerRecordSelectedPayment.disabled = false;
    }
  }

  async recordPhoneAdvance() {
    const assistantKey = this.els.dryerAdvanceAssistant.value;
    const paymentDate = this.els.dryerAdvanceDate.value;
    const amount = optionalInteger(this.els.dryerAdvanceAmount.value);
    if (!assistantKey) {
      setStatus(
        this.els.dryerAdvanceStatus,
        "Choose the Research Assistant.",
        "error"
      );
      return;
    }
    if (!paymentDate) {
      setStatus(this.els.dryerAdvanceStatus, "Choose the advance date.", "error");
      return;
    }
    if (amount === null || amount <= 0) {
      setStatus(
        this.els.dryerAdvanceStatus,
        "Enter the phone/data advance amount.",
        "error"
      );
      return;
    }
    if (
      !window.confirm(
        `Record ${formatKes(
          amount
        )} as phone/data credit? This ledger entry cannot be edited or deleted.`
      )
    ) {
      return;
    }

    const submitButton = this.els.dryerAdvanceForm.querySelector(
      'button[type="submit"]'
    );
    submitButton.disabled = true;
    try {
      await callPaymentRpc(RECORD_ADVANCE_RPC, {
        p_client_request_id: randomUuid(),
        p_assistant_key: assistantKey,
        p_payment_date: paymentDate,
        p_amount_kes: amount,
        p_reference:
          String(this.els.dryerAdvanceReference.value || "").trim() || null,
        p_note: String(this.els.dryerAdvanceNote.value || "").trim() || null
      });
      this.els.dryerAdvanceAmount.value = "";
      this.els.dryerAdvanceReference.value = "";
      this.els.dryerAdvanceNote.value = "";
      await this.loadWorkspace();
      this.setPaymentView("ledger");
      setStatus(
        this.els.dryerPaymentLedgerStatus,
        `Phone/data advance recorded: ${formatKes(amount)}.`
      );
    } catch (error) {
      setStatus(
        this.els.dryerAdvanceStatus,
        error?.message || String(error),
        "error"
      );
    } finally {
      submitButton.disabled = false;
    }
  }

  renderPaymentLedger() {
    if (!this.state.payments.length) {
      this.els.dryerPaymentLedgerRows.innerHTML = emptyRow(
        8,
        "No payments or phone/data advances have been recorded."
      );
      setStatus(this.els.dryerPaymentLedgerStatus, "0 transactions");
      return;
    }

    const rows = [];
    this.state.payments.forEach((payment) => {
      rows.push(this.paymentRowMarkup(payment));
      rows.push(this.paymentDetailMarkup(payment));
    });
    this.els.dryerPaymentLedgerRows.innerHTML = rows.join("");
    setStatus(
      this.els.dryerPaymentLedgerStatus,
      `${this.state.payments.length} ${
        this.state.payments.length === 1 ? "transaction" : "transactions"
      }`
    );
  }

  paymentRowMarkup(payment) {
    const expanded = this.state.expandedPayments.has(String(payment.id));
    const isAdvance = payment.transaction_type === "phone_data_advance";
    const appliedTo = isAdvance
      ? "Phone/data credit"
      : `${formatInteger(payment.activity_day_count)} ${
          Number(payment.activity_day_count) === 1 ? "activity day" : "activity days"
        }`;
    const creditMovement = isAdvance
      ? `+ ${formatKes(payment.amount_kes)}`
      : payment.phone_data_credit_applied_kes
        ? `− ${formatKes(payment.phone_data_credit_applied_kes)}`
        : "No credit used";

    return `<tr data-payment-ledger-row data-payment-id="${escapeAttribute(
      payment.id
    )}">
      <td>
        <button class="dryer-payment-disclosure" type="button" data-payment-ledger-toggle aria-expanded="${
          expanded ? "true" : "false"
        }" aria-label="${expanded ? "Collapse" : "Expand"} payment">${expanded ? "▾" : "▸"}</button>
        <strong>${escapeHtml(formatDateKey(payment.payment_date))}</strong>
      </td>
      <td>${escapeHtml(payment.assistant_name || payment.assistant_key || "—")}</td>
      <td>${escapeHtml(
        isAdvance ? "Phone/data advance" : "Activity payment"
      )}</td>
      <td><strong>${escapeHtml(formatKes(payment.amount_kes))}</strong></td>
      <td>${escapeHtml(appliedTo)}</td>
      <td>${escapeHtml(creditMovement)}<span class="field-hint">Balance ${escapeHtml(
        formatKes(payment.phone_data_credit_balance_after_kes)
      )}</span></td>
      <td>${textOrDash(payment.reference)}</td>
      <td>${escapeHtml(payment.recorded_by_name || "—")}</td>
    </tr>`;
  }

  paymentDetailMarkup(payment) {
    const expanded = this.state.expandedPayments.has(String(payment.id));
    const days = Array.isArray(payment.activity_days)
      ? payment.activity_days
      : [];
    const dayItems = days.length
      ? `<ul>${days
          .map(
            (day) => `<li><strong>${escapeHtml(
              formatDateKey(day.activity_date)
            )}</strong> — ${escapeHtml(
              `${formatInteger(day.loading_count)} L / ${formatInteger(
                day.unloading_count
              )} U`
            )}; work ${escapeHtml(
              formatKes(day.approved_work_amount_kes)
            )}; phone/data ${escapeHtml(
              formatKes(day.phone_data_allowance_kes)
            )}; credit ${escapeHtml(
              formatKes(day.phone_data_credit_applied_kes)
            )}; transferred ${escapeHtml(formatKes(day.transfer_amount_kes))}</li>`
          )
          .join("")}</ul>`
      : "<p>No activity days linked to this advance.</p>";

    return `<tr class="dryer-payment-detail-row" data-payment-ledger-detail${
      expanded ? "" : " hidden"
    }>
      <td colspan="8">
        <div class="dryer-payment-detail-grid">
          <div><strong>Applied activity days</strong>${dayItems}</div>
          <div><strong>Breakdown</strong><p>Work ${escapeHtml(
            formatKes(payment.work_amount_kes)
          )} · Phone/data ${escapeHtml(
            formatKes(payment.phone_data_amount_kes)
          )} · Advance credit ${escapeHtml(
            formatKes(payment.phone_data_credit_applied_kes)
          )}</p></div>
          <div><strong>Note</strong><p>${textOrDash(payment.note)}</p><span class="field-hint">Recorded ${escapeHtml(
            formatDateTime(payment.recorded_at)
          )}.</span></div>
        </div>
      </td>
    </tr>`;
  }

  handlePaymentToggle(event) {
    const button = event.target.closest("[data-payment-ledger-toggle]");
    if (!button) return;
    const row = button.closest("[data-payment-ledger-row]");
    const detail = row?.nextElementSibling;
    if (!row || !detail?.hasAttribute("data-payment-ledger-detail")) return;
    const id = String(row.dataset.paymentId || "");
    const expanded = button.getAttribute("aria-expanded") !== "true";
    button.setAttribute("aria-expanded", String(expanded));
    button.textContent = expanded ? "▾" : "▸";
    detail.hidden = !expanded;
    if (expanded) this.state.expandedPayments.add(id);
    else this.state.expandedPayments.delete(id);
  }
}

function isSelectableDay(day) {
  return Boolean(
    day?.decision_id
    && day?.payment_status === "approved_unpaid"
    && day?.source_changed_since_approval !== true
  );
}

function dayKey(day) {
  return `${day?.assistant_key || ""}:${day?.activity_date || ""}`;
}

function dayQualificationPill(day) {
  return day?.qualifies
    ? '<span class="status-pill">Minimum met</span>'
    : '<span class="status-pill status-muted">Below minimum</span>';
}

async function callPaymentRpc(name, payload = {}) {
  const accountToken = await currentAccessToken();
  const response = await fetch(
    `${DRYING_FORM_CONFIG.supabaseUrl}/rest/v1/rpc/${name}`,
    {
      method: "POST",
      headers: {
        apikey: DRYING_FORM_CONFIG.supabaseAnonKey,
        Authorization: `Bearer ${DRYING_FORM_CONFIG.supabaseAnonKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        p_account_access_token: accountToken,
        ...payload
      })
    }
  );
  if (!response.ok) {
    throw new Error(
      `${response.status} ${response.statusText}${await responseDetail(response)}`
    );
  }
  return response.json();
}

async function responseDetail(response) {
  try {
    const payload = await response.json();
    const detail =
      payload?.message
      || payload?.details
      || payload?.hint
      || payload?.error
      || "";
    return detail ? ` - ${detail}` : "";
  } catch {
    const detail = await response.text();
    return detail ? ` - ${detail}` : "";
  }
}

function kenyaDateKey(value) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: KENYA_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const values = Object.fromEntries(
    parts.map((part) => [part.type, part.value])
  );
  return `${values.year}-${values.month}-${values.day}`;
}

function formatDateKey(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) return "—";
  return new Date(`${value}T12:00:00+03:00`).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: KENYA_TIME_ZONE
  });
}

function formatDateTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: KENYA_TIME_ZONE
  });
}

function formatKes(value) {
  return `KES ${formatInteger(value)}`;
}

function formatInteger(value) {
  const number = Number(value);
  return Number.isFinite(number)
    ? Math.round(number).toLocaleString("en-GB")
    : "0";
}

function nonNegativeInteger(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.round(number) : 0;
}

function optionalInteger(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isInteger(number) ? number : null;
}

function randomUuid() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (character) => {
    const random = Math.floor(Math.random() * 16);
    const value = character === "x" ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

function setStatus(element, message, type = "") {
  if (!element) return;
  element.textContent = message || "";
  if (type) element.dataset.status = type;
  else delete element.dataset.status;
}

function textOrDash(value) {
  const text = String(value || "").trim();
  return text ? escapeHtml(text) : '<span class="muted-cell">—</span>';
}

function emptyRow(colspan, message) {
  return `<tr><td colspan="${colspan}" class="empty-state">${escapeHtml(
    message
  )}</td></tr>`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replace(/`/g, "&#096;");
}
