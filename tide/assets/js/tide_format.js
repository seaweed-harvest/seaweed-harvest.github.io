const formatterCache = new Map();

function getFormatter(locale, timeZone, options) {
  const key = JSON.stringify([locale, timeZone, options]);
  if (!formatterCache.has(key)) {
    formatterCache.set(key, new Intl.DateTimeFormat(locale, { timeZone, ...options }));
  }
  return formatterCache.get(key);
}

export function formatTime(date, timeZone, locale = "en-GB") {
  return getFormatter(locale, timeZone, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(date);
}

export function formatDate(date, timeZone, locale = "en-GB") {
  return getFormatter(locale, timeZone, {
    weekday: "short",
    day: "numeric",
    month: "short"
  }).format(date);
}

export function formatDateTime(date, timeZone, locale = "en-GB") {
  return `${formatDate(date, timeZone, locale)} ${formatTime(date, timeZone, locale)}`;
}

export function formatMonth(date, timeZone, locale = "en-GB") {
  return getFormatter(locale, timeZone, {
    month: "long",
    year: "numeric"
  }).format(date);
}

export function formatMetres(value) {
  if (!Number.isFinite(value)) return "--";
  return `${value.toFixed(2)} m`;
}

export function formatPercent(value) {
  if (!Number.isFinite(value)) return "--";
  return `${Math.round(value)}%`;
}

export function localDateKey(date, timeZone) {
  const parts = getFormatter("en-CA", timeZone, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const values = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function dateKeyToUtcDate(dateKey) {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
}

export function addDaysToDateKey(dateKey, days) {
  const date = dateKeyToUtcDate(dateKey);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function monthKeyFromDateKey(dateKey) {
  return dateKey.slice(0, 7);
}

export function startOfMonthKey(dateKey) {
  return `${dateKey.slice(0, 7)}-01`;
}

export function addMonthsToDateKey(dateKey, months) {
  const [year, month] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1 + months, 1, 12, 0, 0)).toISOString().slice(0, 10);
}

export function weekdayIndex(dateKey) {
  const date = dateKeyToUtcDate(dateKey);
  return date.getUTCDay();
}

export function daysInMonth(dateKey) {
  const [year, month] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function relativeTimeFromNow(date, now = new Date()) {
  const diffMs = date.getTime() - now.getTime();
  const absMinutes = Math.round(Math.abs(diffMs) / 60000);
  if (absMinutes < 60) return `${absMinutes} min`;
  const hours = Math.floor(absMinutes / 60);
  const minutes = absMinutes % 60;
  if (hours < 48) return minutes ? `${hours} hr ${minutes} min` : `${hours} hr`;
  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  return remainingHours ? `${days} d ${remainingHours} hr` : `${days} d`;
}

export function statusLabel(status) {
  const labels = {
    planning_guidance_unverified: "Planning guidance",
    reference_only: "Reference only",
    prototype_reference: "Prototype reference",
    prototype_placeholder: "Prototype placeholder",
    verified: "Verified",
    pending_verification: "Pending verification"
  };
  return labels[status] || status.replace(/_/g, " ");
}
