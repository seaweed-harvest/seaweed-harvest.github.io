export function mapCoordinates(row) {
  const latitude = coordinateNumber(row?.gps_latitude);
  const longitude = coordinateNumber(row?.gps_longitude);
  if (latitude === null || longitude === null) return null;
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;
  return [latitude, longitude];
}

export function hasMapCoordinates(row) {
  return mapCoordinates(row) !== null;
}

function coordinateNumber(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (!text) return null;
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}
