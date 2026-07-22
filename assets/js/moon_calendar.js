const SYNODIC_MONTH_DAYS = 29.530588853;
const NEW_MOON_REFERENCE_MS = Date.UTC(2000, 0, 6, 18, 14, 0);
const DAY_MS = 86400000;

function moonPhase(date) {
  const days = (date.getTime() - NEW_MOON_REFERENCE_MS) / DAY_MS;
  return (((days % SYNODIC_MONTH_DAYS) + SYNODIC_MONTH_DAYS) % SYNODIC_MONTH_DAYS) / SYNODIC_MONTH_DAYS;
}

function nextMoonEvent(fromDate, targetPhase) {
  const currentPhase = moonPhase(fromDate);
  let difference = targetPhase - currentPhase;
  if (difference <= 0.005) difference += 1;
  return new Date(fromDate.getTime() + difference * SYNODIC_MONTH_DAYS * DAY_MS);
}

export function moonEvents(startDate, endDate) {
  const events = [];
  let probe = new Date(startDate.getTime() - 35 * DAY_MS);
  const endMs = endDate.getTime();

  while (probe.getTime() < endMs + 35 * DAY_MS) {
    const candidates = [
      { date: nextMoonEvent(probe, 0), type: "new", label: "New moon" },
      { date: nextMoonEvent(probe, 0.5), type: "full", label: "Full moon" }
    ];

    candidates.forEach((event) => {
      if (event.date.getTime() >= startDate.getTime() && event.date.getTime() <= endMs) {
        events.push(event);
      }
    });
    probe = new Date(probe.getTime() + 14 * DAY_MS);
  }

  events.sort((left, right) => left.date - right.date);
  return events.filter((event, index) => !events.slice(0, index).some((existing) => (
    existing.type === event.type && Math.abs(existing.date - event.date) < 48 * 3600000
  )));
}
