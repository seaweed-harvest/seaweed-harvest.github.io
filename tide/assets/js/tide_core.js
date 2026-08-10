const DEG = Math.PI / 180;
const SYNODIC_MONTH = 29.530588853;
const NEW_MOON_REF = Date.UTC(2000, 0, 6, 18, 14, 0);
const J2000 = Date.UTC(2000, 0, 1, 12, 0, 0);

const SPEEDS = {
  M2: 28.9841042,
  S2: 30.0,
  N2: 28.4397295,
  K1: 15.0410686,
  O1: 13.9430356,
  P1: 14.9589314,
  K2: 30.0821373
};

const V0_J2000 = {
  M2: 124.3,
  S2: 0.0,
  N2: 349.34,
  K1: 190.47,
  O1: 293.83,
  P1: 169.53,
  K2: 200.93
};

const NODAL_F = {
  M2: 0.965,
  S2: 1.0,
  N2: 0.965,
  K1: 1.115,
  O1: 1.187,
  P1: 1.0,
  K2: 1.23
};

const NODAL_U = {
  M2: 0.66,
  S2: 0,
  N2: 0.66,
  K1: 2.71,
  O1: -3.31,
  P1: 0,
  K2: 5.42
};

export function tideHeight(date, profile) {
  if (!profile || !Array.isArray(profile.constituents)) return NaN;

  const hours = (date.getTime() - J2000) / 3600000;
  let height = Number(profile.meanLevelM || 0);

  for (const constituent of profile.constituents) {
    const speed = SPEEDS[constituent.id];
    const v0 = V0_J2000[constituent.id];
    if (!Number.isFinite(speed) || !Number.isFinite(v0)) continue;

    const arg =
      speed * hours +
      v0 +
      (NODAL_U[constituent.id] || 0) -
      Number(constituent.phase || 0);

    height +=
      (NODAL_F[constituent.id] || 1) *
      Number(constituent.amp || 0) *
      Math.cos(arg * DEG);
  }

  return height;
}

export function tideCurve(profile, startDate, endDate, intervalMinutes = 30) {
  const points = [];
  const stepMs = intervalMinutes * 60000;
  const endMs = endDate.getTime();

  for (let t = startDate.getTime(); t <= endMs; t += stepMs) {
    const date = new Date(t);
    points.push({
      timeMs: t,
      date,
      heightM: tideHeight(date, profile)
    });
  }

  return points;
}

export function tideExtremes(curve) {
  const extremes = [];

  for (let i = 1; i < curve.length - 1; i += 1) {
    const previous = curve[i - 1].heightM;
    const current = curve[i].heightM;
    const next = curve[i + 1].heightM;

    if (current > previous && current > next) {
      extremes.push({
        type: "high",
        timeMs: curve[i].timeMs,
        date: curve[i].date,
        heightM: current
      });
    } else if (current < previous && current < next) {
      extremes.push({
        type: "low",
        timeMs: curve[i].timeMs,
        date: curve[i].date,
        heightM: current
      });
    }
  }

  return extremes;
}

export function moonPhase(date) {
  const days = (date.getTime() - NEW_MOON_REF) / 86400000;
  return (((days % SYNODIC_MONTH) + SYNODIC_MONTH) % SYNODIC_MONTH) / SYNODIC_MONTH;
}

export function moonIllumination(phase) {
  return ((1 - Math.cos(phase * 2 * Math.PI)) / 2) * 100;
}

export function moonPhaseName(phase) {
  if (phase < 0.0625 || phase >= 0.9375) return "New Moon";
  if (phase < 0.1875) return "Waxing Crescent";
  if (phase < 0.3125) return "First Quarter";
  if (phase < 0.4375) return "Waxing Gibbous";
  if (phase < 0.5625) return "Full Moon";
  if (phase < 0.6875) return "Waning Gibbous";
  if (phase < 0.8125) return "Last Quarter";
  return "Waning Crescent";
}

export function nextMoonEvent(fromDate, targetPhase) {
  const current = moonPhase(fromDate);
  let diff = targetPhase - current;
  if (diff <= 0.005) diff += 1;
  return new Date(fromDate.getTime() + diff * SYNODIC_MONTH * 86400000);
}

export function moonEvents(startDate, endDate) {
  const events = [];
  let probe = new Date(startDate.getTime() - 35 * 86400000);
  const endMs = endDate.getTime();

  while (probe.getTime() < endMs + 35 * 86400000) {
    const newMoon = nextMoonEvent(probe, 0);
    const fullMoon = nextMoonEvent(probe, 0.5);

    if (newMoon.getTime() >= startDate.getTime() && newMoon.getTime() <= endMs) {
      events.push({ date: newMoon, type: "new", label: "New Moon" });
    }

    if (fullMoon.getTime() >= startDate.getTime() && fullMoon.getTime() <= endMs) {
      events.push({ date: fullMoon, type: "full", label: "Full Moon" });
    }

    probe = new Date(probe.getTime() + 14 * 86400000);
  }

  events.sort((a, b) => a.date - b.date);
  return dedupeMoonEvents(events);
}

function dedupeMoonEvents(events) {
  const out = [];

  for (const event of events) {
    const duplicate = out.some((existing) => {
      return existing.type === event.type && Math.abs(existing.date - event.date) < 48 * 3600000;
    });

    if (!duplicate) out.push(event);
  }

  return out;
}

export function springWindows(startDate, endDate) {
  const events = moonEvents(
    new Date(startDate.getTime() - 8 * 86400000),
    new Date(endDate.getTime() + 8 * 86400000)
  );

  return events
    .map((event) => {
      const springLow = new Date(event.date.getTime() + 1.5 * 86400000);
      return {
        moonEvent: event,
        springLow,
        start: new Date(springLow.getTime() - 3 * 86400000),
        end: new Date(springLow.getTime() + 3 * 86400000)
      };
    })
    .filter((window) => {
      return window.end.getTime() >= startDate.getTime() && window.start.getTime() <= endDate.getTime();
    });
}

export function findNextExtreme(extremes, now, type) {
  const nowMs = now.getTime();
  return extremes.find((extreme) => extreme.type === type && extreme.timeMs >= nowMs) || null;
}

export function findNextHarvestLow(extremes, now, thresholdM, enabled = true) {
  if (!enabled) return null;

  const nowMs = now.getTime();
  return (
    extremes.find((extreme) => {
      return extreme.type === "low" && extreme.timeMs >= nowMs && extreme.heightM <= thresholdM;
    }) || null
  );
}

export function rangeAroundNow(now, daysBefore, daysAfter) {
  return {
    start: new Date(now.getTime() - daysBefore * 86400000),
    end: new Date(now.getTime() + daysAfter * 86400000)
  };
}
