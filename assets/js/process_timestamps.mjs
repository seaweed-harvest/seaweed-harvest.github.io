const NAIROBI_OFFSET = "+03:00";

export function defaultFinishDate(startDate, startTime, finishTime) {
  if (!startDate) return "";
  const overnight = Boolean(startTime && finishTime && finishTime < startTime);
  return addIsoDays(startDate, overnight ? 1 : 0);
}

export function processTimestampRange(startDate, startTime, finishDate, finishTime) {
  if (!startDate || !startTime || !finishDate || !finishTime) return null;
  const start = Date.parse(`${startDate}T${startTime}:00${NAIROBI_OFFSET}`);
  const finish = Date.parse(`${finishDate}T${finishTime}:00${NAIROBI_OFFSET}`);
  if (!Number.isFinite(start) || !Number.isFinite(finish)) return null;
  return { start, finish };
}

export function processDurationMinutes(startDate, startTime, finishDate, finishTime) {
  const timestamps = processTimestampRange(startDate, startTime, finishDate, finishTime);
  if (!timestamps || timestamps.finish <= timestamps.start) return null;
  return Math.round((timestamps.finish - timestamps.start) / 60000);
}

export function formatProcessDuration(startDate, startTime, finishDate, finishTime) {
  const minutes = processDurationMinutes(startDate, startTime, finishDate, finishTime);
  if (minutes === null) return "-";
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (!hours) return `${remainder} min`;
  return remainder ? `${hours} h ${remainder} min` : `${hours} h`;
}

function addIsoDays(value, days) {
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return "";
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
