import { mkwiroRaftDisplayLabel } from "./reef_mkwiro_raft_labels.js?v=3";

// Read-only aggregation of the currently saved Sample Rope Register cycles.
// Site discovery comes from the existing scoped context RPC, not a hardcoded list.
export const ROPE_DATA_COLUMNS = Object.freeze([
  { key: "site", label: "Site", type: "text", default: true },
  { key: "rope_number", label: "Rope #", type: "number", default: true },
  { key: "species", label: "Species", type: "text", default: true },
  { key: "rope_weight_kg", label: "Rope Weight (kg)", type: "number", default: true },
  { key: "initial_weight_kg", label: "Initial Weight (kg)", type: "number", default: true },
  { key: "initial_date", label: "Initial Weight Date", type: "date", default: true },
  { key: "week_2_kg", label: "Wk 2 Weight (kg)", type: "number", default: true },
  { key: "week_2_date", label: "Wk 2 Date", type: "date", default: true },
  { key: "week_4_kg", label: "Wk 4 Weight (kg)", type: "number", default: true },
  { key: "week_4_date", label: "Wk 4 Date", type: "date", default: true },
  { key: "week_6_kg", label: "Wk 6 Weight (kg)", type: "number", default: true },
  { key: "week_6_date", label: "Wk 6 Date", type: "date", default: true },
  { key: "location", label: "Location", type: "text", default: false },
  { key: "structure", label: "Structure", type: "text", default: false },
  { key: "cycle_number", label: "Cycle", type: "number", default: false },
  { key: "history_count", label: "Previous Cycles", type: "number", default: false },
  { key: "initial_recorder", label: "Initial Recorder", type: "text", default: false },
  { key: "week_2_recorder", label: "Wk 2 Recorder", type: "text", default: false },
  { key: "week_4_recorder", label: "Wk 4 Recorder", type: "text", default: false },
  { key: "week_6_recorder", label: "Wk 6 Recorder", type: "text", default: false }
]);

export const DEFAULT_ROPE_COLUMNS = Object.freeze(
  ROPE_DATA_COLUMNS.filter(column => column.default).map(column => column.key)
);

export function flattenActiveRopeRegisters(registers) {
  return registers.flatMap(({ site, register }) =>
    (Array.isArray(register?.rows) ? register.rows : [])
      .filter(row => [
        row.species, row.rope_weight_kg, row.initial_weight_kg,
        row.week_2_kg, row.week_4_kg, row.week_6_kg
      ].some(value => value !== null && value !== undefined && value !== ""))
      .map(row => ({
        site: mkwiroRaftDisplayLabel(site.site_code, site.site_name)
          || [site.site_code, site.site_name ? `(${site.site_name})` : ""].filter(Boolean).join(" "),
        site_code: site.site_code,
        location: site.location || "",
        structure: site.structure_type || "",
        rope_number: row.rope_number,
        species: row.species || "",
        rope_weight_kg: row.rope_weight_kg,
        initial_weight_kg: row.initial_weight_kg,
        initial_date: row.date_seeded || row.measurement_provenance?.initial?.date || "",
        week_2_kg: row.week_2_kg,
        week_2_date: row.week_2_date || row.measurement_provenance?.week_2?.date || "",
        week_4_kg: row.week_4_kg,
        week_4_date: row.week_4_date || row.measurement_provenance?.week_4?.date || "",
        week_6_kg: row.week_6_kg,
        week_6_date: row.week_6_date || row.measurement_provenance?.week_6?.date || "",
        cycle_number: row.cycle_number,
        history_count: row.history_count ?? 0,
        initial_recorder: row.measurement_provenance?.initial?.recorder || "",
        week_2_recorder: row.measurement_provenance?.week_2?.recorder || "",
        week_4_recorder: row.measurement_provenance?.week_4?.recorder || "",
        week_6_recorder: row.measurement_provenance?.week_6?.recorder || ""
      }))
  );
}

export function sortRopeData(rows, key, direction = "asc") {
  const column = ROPE_DATA_COLUMNS.find(col => col.key === key);
  if (!column) return [...rows];
  const sign = direction === "desc" ? -1 : 1;
  return [...rows].sort((a, b) => {
    const av = a[key], bv = b[key];
    const aEmpty = av === null || av === undefined || av === "";
    const bEmpty = bv === null || bv === undefined || bv === "";
    if (aEmpty || bEmpty) return aEmpty === bEmpty ? 0 : aEmpty ? 1 : -1;
    const diff = column.type === "number"
      ? Number(av) - Number(bv)
      : String(av).localeCompare(String(bv), undefined, {numeric: true, sensitivity: "base"});
    return diff * sign;
  });
}

const safe = value => String(value ?? "").replace(/[&<>"']/g, chr =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[chr]);

const readableDate = date => {
  if (!date) return "—";
  const parsed = new Date(`${String(date).slice(0,10)}T12:00:00`);
  return Number.isNaN(parsed.getTime()) ? String(date) :
    new Intl.DateTimeFormat("en-GB", {day: "2-digit", month: "short", year: "numeric"}).format(parsed);
};

export function initializeSampleRopeDataTable({ authClient, root }) {
  if (!root) throw new Error("Sample Rope Data tab is unavailable.");
  const get = id => root.querySelector(`#${id}`);
  const els = {
    reload: get("reloadReefSampleRopeData"),
    search: get("reefSampleRopeDataSearch"),
    columns: get("reefSampleRopeDataColumns"),
    reset: get("resetReefSampleRopeDataColumns"),
    head: get("reefSampleRopeDataHead"),
    body: get("reefSampleRopeDataBody"),
    status: get("reefSampleRopeDataStatus")
  };
  const state = {
    rows: [], loaded: false, busy: false, visible: new Set(DEFAULT_ROPE_COLUMNS),
    sortKey: "site", direction: "asc"
  };

  try {
    const saved = JSON.parse(window.localStorage?.getItem("reefSampleRopeVisibleColumnsV1") || "null");
    if (Array.isArray(saved) && saved.length && saved.every(key => ROPE_DATA_COLUMNS.some(col => col.key === key))) {
      state.visible = new Set(saved);
    }
  } catch { /* Storage disabled in some private/public browsers. */ }

  const setStatus = (message, error = false) => {
    els.status.textContent = message;
    els.status.dataset.status = error ? "error" : "";
  };
  const display = (row, column) => {
    const value = row[column.key];
    return column.type === "date" ? readableDate(value) : value == null || value === "" ? "—" : String(value);
  };
  const render = () => {
    const columns = ROPE_DATA_COLUMNS.filter(col => state.visible.has(col.key));
    const search = els.search.value.trim().toLowerCase();
    const data = sortRopeData(state.rows.filter(row =>
      !search || [row.site, row.site_code, row.species, row.location, row.structure, row.rope_number]
        .some(value => String(value || "").toLowerCase().includes(search))
    ), state.sortKey, state.direction);
    els.head.innerHTML = columns.map(col => {
      const selected = state.sortKey === col.key;
      return `<th scope="col" aria-sort="${selected ? (state.direction === "asc" ? "ascending" : "descending") : "none"}">
        <button type="button" data-sort-rope="${safe(col.key)}">${safe(col.label)}${selected ? (state.direction === "asc" ? " ↑" : " ↓") : ""}</button>
      </th>`;
    }).join("");
    els.body.innerHTML = data.length ? data.map(row => `<tr>${columns.map(col =>
      `<td data-label="${safe(col.label)}">${safe(display(row, col))}</td>`
    ).join("")}</tr>`).join("") :
      `<tr><td class="empty-state" colspan="${columns.length}">${state.busy ? "Loading rope data…" : "No matching rope measurements."}</td></tr>`;
    if (!state.busy && state.loaded) {
      setStatus(`${data.length} of ${state.rows.length} saved rope records displayed · ${new Set(state.rows.map(row => row.site_code)).size} sites with measurements`);
    }
  };
  const renderChoices = () => {
    els.columns.innerHTML = ROPE_DATA_COLUMNS.map(col =>
      `<label><input type="checkbox" data-rope-column="${safe(col.key)}" ${state.visible.has(col.key) ? "checked" : ""}> ${safe(col.label)}</label>`
    ).join("");
  };
  const selectColumn = (key, enabled) => {
    if (!ROPE_DATA_COLUMNS.some(col => col.key === key)) return;
    if (enabled) state.visible.add(key);
    else if (state.visible.size > 1) state.visible.delete(key);
    renderChoices(); render();
    try { window.localStorage?.setItem("reefSampleRopeVisibleColumnsV1", JSON.stringify([...state.visible])); } catch { /* no storage */ }
  };
  const refresh = async () => {
    if (state.busy) return;
    state.busy = true;
    els.reload.disabled = true;
    setStatus("Loading current rope measurements from all nursery sites…");
    render();
    try {
      const {data: context, error: contextError} = await authClient.rpc("ag_reef_site_capture_workspace_context");
      if (contextError) throw contextError;
      if (!context?.allowed) throw new Error(context?.reason || "Nursery records are unavailable.");
      const sites = Array.isArray(context.sites) ? context.sites : [];
      const registers = [];
      const failed = [];
      for (let i = 0; i < sites.length; i += 4) {
        const batch = sites.slice(i, i+4);
        const results = await Promise.allSettled(batch.map(async site => {
          const {data, error} = await authClient.rpc("ag_reef_sample_rope_register", {p_site_code: site.site_code});
          if (error) throw error;
          return {site, register: data};
        }));
        results.forEach((result, index) => {
          if (result.status === "fulfilled") registers.push(result.value);
          else failed.push(batch[index].site_code);
        });
      }
      state.rows = flattenActiveRopeRegisters(registers);
      state.loaded = true;
      render();
      if (failed.length) setStatus(`${state.rows.length} saved rope records loaded; ${failed.length} site(s) couldn't load: ${failed.join(", ")}. Refresh to retry.`, true);
    } catch (error) {
      state.loaded = false;
      setStatus(error?.message || "Could not load Sample Rope Data.", true);
    } finally {
      state.busy = false;
      els.reload.disabled = false;
      if (!state.loaded) render();
    }
  };

  els.reload.addEventListener("click", refresh);
  els.search.addEventListener("input", render);
  els.columns.addEventListener("change", event => {
    const field = event.target.closest("[data-rope-column]");
    if (field) selectColumn(field.dataset.ropeColumn, field.checked);
  });
  els.reset.addEventListener("click", () => {
    state.visible = new Set(DEFAULT_ROPE_COLUMNS); renderChoices(); render();
    try { window.localStorage?.removeItem("reefSampleRopeVisibleColumnsV1"); } catch { /* no storage */ }
  });
  els.head.addEventListener("click", event => {
    const button = event.target.closest("[data-sort-rope]");
    if (!button) return;
    const key = button.dataset.sortRope;
    state.direction = state.sortKey === key && state.direction === "asc" ? "desc" : "asc";
    state.sortKey = key;
    render();
  });

  renderChoices(); render();
  return { refresh, state, selectColumn };
}
