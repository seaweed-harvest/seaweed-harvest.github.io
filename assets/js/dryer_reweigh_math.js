export function deriveReweighMeasurements(events, startKg, startAt) {
  const startTime = Date.parse(startAt || "");
  return (Array.isArray(events) ? events : []).map((event) => {
    const bays = Array.isArray(event?.bays) ? event.bays : [];
    const weights = bays.map((bay) => {
      if (bay?.weight_kg === null || bay?.weight_kg === undefined || bay?.weight_kg === "") return null;
      const weight = Number(bay.weight_kg);
      return Number.isFinite(weight) && weight >= 0 ? weight : null;
    });
    const totalKg = weights.length && weights.every((weight) => weight !== null)
      ? weights.reduce((sum, weight) => sum + weight, 0) : null;
    const measuredAt = Date.parse(event?.reweigh_at || "");
    return {
      at: event?.reweigh_at || "",
      weather: event?.weather || "",
      notes: event?.notes || "",
      bays,
      totalKg,
      lossPct: totalKg !== null && Number.isFinite(startKg) && startKg > 0
        ? (startKg - totalKg) / startKg * 100 : null,
      elapsedHours: Number.isFinite(measuredAt) && Number.isFinite(startTime) && measuredAt >= startTime
        ? (measuredAt - startTime) / 3600000 : null
    };
  }).sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}
