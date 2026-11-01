// COSME Timeline: read-only view over the existing, permission-gated Metrics database.
// Does not modify published releases or operational records.
export function createMetricsTimeline(authClient, root, openMetric) {
  let milestones = [];
  let loaded = false;
  let errorMessage = "";
  let requestId = 0;
  let activity = "";
  let type = "";
  let year = "";
  let view = "timeline";
  let month = "";
  let selectedDay = "";
  let availableMetrics = new Set();

  const make = (element, className = "", text = "") => {
    const node = document.createElement(element);
    if (className) node.className = className;
    node.textContent = String(text ?? "");
    return node;
  };
  const dateAtNoon = (value) => new Date(value + "T12:00:00");
  const dateLabel = (value) => dateAtNoon(value).toLocaleDateString("en-AU", {
    day: "numeric", month: "short", year: "numeric"
  });
  const dateRange = (m) => m.end_date && m.end_date !== m.start_date
    ? dateLabel(m.start_date) + " – " + dateLabel(m.end_date) : dateLabel(m.start_date);
  const validSourceUrl = (value) => {
    try {
      const parsed = new URL(value);
      return parsed.protocol === "https:" ? parsed.href : "";
    } catch { return ""; }
  };
  const activityName = (name) => name === "Programme" ? "Programme-wide" : name;
  const filters = () => milestones.filter((m) =>
    (!activity || m.activity === activity) &&
    (!type || m.type === type) &&
    (!year || m.start_date.startsWith(year))
  );
  const activeOn = (m, day) => m.start_date <= day && (m.end_date || m.start_date) >= day;

  function select(parent, label, choices, value, onChange) {
    const control = make("label", "metrics-timeline-filter");
    control.append(make("span", "", label));
    const dropdown = make("select");
    for (const [key, caption] of choices) {
      const option = make("option", "", caption);
      option.value = key;
      dropdown.append(option);
    }
    dropdown.value = value;
    dropdown.addEventListener("change", () => onChange(dropdown.value));
    control.append(dropdown);
    parent.append(control);
  }

  function renderCard(parent, m) {
    const card = make("article", "metrics-timeline-event");
    const rail = make("div", "metrics-timeline-event-date", dateRange(m));
    const content = make("div", "metrics-timeline-event-body");
    const labels = make("div", "metrics-timeline-event-labels");
    labels.append(make("span", "metrics-timeline-activity", activityName(m.activity)));
    labels.append(make("span", "metrics-timeline-type", m.type));
    content.append(labels, make("h4", "", m.title));
    if (m.summary) content.append(make("p", "", m.summary));
    const links = make("div", "metrics-timeline-links");
    const sourceHref = validSourceUrl(m.source_url);
    if (sourceHref) {
      const link = make("a", "", "Source: " + (m.source_label || "Project record"));
      link.href = sourceHref;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      links.append(link);
    } else if (m.source_label) {
      links.append(make("span", "", "Source: " + m.source_label));
    }
    const metrics = Array.isArray(m.metrics) ? m.metrics.filter((metric) =>
      availableMetrics.has(metric.id)) : [];
    for (const metric of metrics) {
      const button = make("button", "metrics-timeline-metric-link", "Metric: " + metric.title);
      button.type = "button";
      button.title = "Open metric from the selected register release";
      button.addEventListener("click", () => openMetric(metric.id, button));
      links.append(button);
    }
    content.append(links);
    card.append(rail, content);
    parent.append(card);
  }

  function renderTimeline(parent, rows) {
    if (!rows.length) {
      parent.append(make("p", "metrics-timeline-empty", "No milestones match these filters."));
      return;
    }
    let activeYear = "";
    for (const m of rows) {
      const nextYear = m.start_date.slice(0, 4);
      if (nextYear !== activeYear) {
        activeYear = nextYear;
        parent.append(make("h3", "metrics-timeline-year", activeYear));
      }
      renderCard(parent, m);
    }
  }

  function renderCalendar(parent, rows) {
    const calendar = make("div", "metrics-timeline-calendar");
    const toolbar = make("div", "metrics-timeline-calendar-header");
    const previous = make("button", "metrics-button", "‹ Previous");
    previous.type = "button";
    const next = make("button", "metrics-button", "Next ›");
    next.type = "button";
    const [y, mo] = month.split("-").map(Number);
    const first = new Date(y, mo - 1, 1);
    const heading = make("h3", "", first.toLocaleDateString("en-AU", {month:"long",year:"numeric"}));
    previous.addEventListener("click", () => moveMonth(-1));
    next.addEventListener("click", () => moveMonth(1));
    toolbar.append(previous, heading, next);
    calendar.append(toolbar);
    const grid = make("div", "metrics-timeline-calendar-grid");
    for (const weekday of ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"]) {
      grid.append(make("span", "metrics-timeline-weekday", weekday));
    }
    const offset = (first.getDay() + 6) % 7;
    const days = new Date(y, mo, 0).getDate();
    for (let i = 0; i < offset; i++) {
      grid.append(make("span", "metrics-timeline-day blank", ""));
    }
    for (let d = 1; d <= days; d++) {
      const day = month + "-" + String(d).padStart(2, "0");
      const events = rows.filter((m) => activeOn(m, day));
      const cell = make("button", "metrics-timeline-day" + (events.length ? " has-events" : "") +
        (selectedDay === day ? " selected" : ""));
      cell.type = "button";
      cell.title = events.length ? events.length + " milestone(s) on " + dateLabel(day) : dateLabel(day);
      cell.setAttribute("aria-pressed", String(selectedDay === day));
      cell.append(make("span", "", String(d)));
      if (events.length) cell.append(make("small", "", String(events.length) + " event" +
        (events.length === 1 ? "" : "s")));
      cell.addEventListener("click", () => { selectedDay = day; render(); });
      grid.append(cell);
    }
    calendar.append(grid);
    const eventsPanel = make("div", "metrics-timeline-calendar-events");
    const visible = selectedDay ? rows.filter((m) => activeOn(m,selectedDay))
      : rows.filter((m) => m.start_date.slice(0,7) <= month &&
        (m.end_date || m.start_date).slice(0,7) >= month);
    eventsPanel.append(make("h4", "", selectedDay ? "Milestones on " + dateLabel(selectedDay)
      : "Milestones in " + heading.textContent));
    if (!visible.length) eventsPanel.append(make("p", "metrics-timeline-empty", "No milestones for this period."));
    for (const item of visible) renderCard(eventsPanel,item);
    calendar.append(eventsPanel);
    parent.append(calendar);
  }

  function moveMonth(amount) {
    const [y,m] = month.split("-").map(Number);
    const next = new Date(y,m - 1 + amount,1);
    month = String(next.getFullYear()) + "-" + String(next.getMonth()+1).padStart(2,"0");
    selectedDay = "";
    render();
  }

  function applyFilter() {
    selectedDay = "";
    // Calendar filters should show a month containing relevant milestones.
    const latest = filters().at(-1);
    if (latest) month = latest.start_date.slice(0, 7);
    render();
  }

  function render() {
    root.replaceChildren();
    if (!loaded) {
      root.append(make("p", "metrics-timeline-empty", errorMessage ||
        "Loading project milestones…"));
      return;
    }
    const header = make("div", "metrics-timeline-heading");
    header.append(make("div", "", ""));
    header.firstChild.append(make("h3", "", "Project timeline"),
      make("p", "metrics-small-note", "Verified project events, linked to the current Metrics register where relevant."));
    const counter = make("span", "metrics-count", filters().length + " of " + milestones.length + " milestones");
    header.append(counter);
    root.append(header);

    const controls = make("div", "metrics-timeline-controls");
    const activities = [...new Set(milestones.map((m) => m.activity))];
    const types = [...new Set(milestones.map((m) => m.type))].sort();
    const years = [...new Set(milestones.map((m) => m.start_date.slice(0,4)))].sort().reverse();
    select(controls, "Activity", [["","All activities"], ...activities.map((a) => [a,activityName(a)])],
      activity, (value) => { activity=value; applyFilter(); });
    select(controls, "Type", [["","All types"],...types.map((t)=>[t,t])],
      type, (value) => { type=value; applyFilter(); });
    select(controls, "Year", [["","All years"], ...years.map((y)=>[y,y])],
      year, (value) => { year=value; applyFilter(); });
    const views = make("div", "metrics-timeline-switch");
    for (const [key,label] of [["timeline","Timeline"],["calendar","Calendar"]]) {
      const button = make("button", "metrics-button" + (view===key?" selected":""),label);
      button.type="button";
      button.setAttribute("aria-pressed",String(view===key));
      button.addEventListener("click",()=>{ view=key; selectedDay=""; render(); });
      views.append(button);
    }
    controls.append(views);
    root.append(controls);

    const result = make("div", "metrics-timeline-results");
    const rows = filters();
    if (view === "calendar") renderCalendar(result,rows);
    else renderTimeline(result,rows);
    root.append(result);
  }

  return {
    setRelease(metrics) {
      availableMetrics = new Set((metrics || []).map((metric) => metric.id));
      if (loaded) render();
    },
    async load() {
      const token = ++requestId;
      try {
        const {data,error} = await authClient.rpc("cosme_metrics_timeline");
        if (token !== requestId) return;
        if (error) throw error;
        if (!data?.can_view || !Array.isArray(data.milestones)) {
          throw new Error("Project timeline access unavailable.");
        }
        milestones = data.milestones
          .filter((m) => /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(m.start_date) && m.title)
          .sort((a,b) => a.start_date.localeCompare(b.start_date) || a.title.localeCompare(b.title));
        loaded = true;
        errorMessage = "";
        if (!month) month = (milestones.at(-1)?.start_date || new Date().toISOString().slice(0,10)).slice(0,7);
        render();
      } catch (error) {
        if (token !== requestId) return;
        milestones = [];
        loaded = false;
        errorMessage = error.message || "Project timeline could not be loaded.";
        render();
      }
    },
    clear() {
      ++requestId;
      milestones = [];
      loaded = false;
      errorMessage = "";
      availableMetrics.clear();
      root.replaceChildren();
    }
  };
}
