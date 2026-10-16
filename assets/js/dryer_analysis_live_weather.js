/*
 * Optional live context for Dryer Table analysis.
 * This is Open-Meteo gridded/modelled weather near Mwazaro (NOT the
 * Bati Seaweed Station, and NOT rain-gauge observations).
 * No application records are written by this module.
 */
const LAT = -4.592185, LON = 39.394008; // Mwazaro seaweed farming site
const EAT_SUFFIX = ":00+03:00";
const SOURCE = "Open-Meteo · modelled Mwazaro conditions";
export const MODEL_SOURCE = SOURCE;

export async function loadDryerModelWeather(stationLastDay, regionalRainLastDay) {
  const params = new URLSearchParams({
    latitude: String(LAT), longitude: String(LON),
    hourly: "temperature_2m,relative_humidity_2m,precipitation",
    past_days: "92", forecast_days: "1",
    timezone: "Africa/Nairobi", cell_selection: "land"
  });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 14000);
  let result;
  try {
    const response = await fetch("https://api.open-meteo.com/v1/forecast?" + params, {
      signal: controller.signal, cache: "no-store"
    });
    if (!response.ok) throw new Error("HTTP " + response.status);
    result = await response.json();
  } finally {
    clearTimeout(timeout);
  }
  return parseDryerModelWeather(result, stationLastDay, regionalRainLastDay);
}

export function parseDryerModelWeather(data, stationLastDay, regionalRainLastDay, now = Date.now()) {
  const hourly = data?.hourly || {};
  const times = hourly.time, temperatures = hourly.temperature_2m;
  const humidities = hourly.relative_humidity_2m, rain = hourly.precipitation;
  if (data?.timezone !== "Africa/Nairobi" || !Array.isArray(times) || !times.length ||
      [temperatures, humidities, rain].some((a) => !Array.isArray(a) || a.length !== times.length)) {
    throw new Error("Missing or incorrectly time-zoned hourly weather series");
  }
  const days = new Map(), recent = [];
  let latest = null;
  times.forEach((time, i) => {
    if (typeof time !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(time)) return;
    const t = Date.parse(time + EAT_SUFFIX);
    if (!Number.isFinite(t) || t > now) return; // Do not present forecasts as observed history.
    const temp = temperatures[i], rh = humidities[i], p = rain[i];
    if (![temp, rh, p].every((n) => typeof n === "number" && Number.isFinite(n)) ||
        temp < -10 || temp > 55 || rh < 0 || rh > 100 || p < 0 || p > 500) return;
    latest = t;
    const date = time.slice(0, 10), hour = Number(time.slice(11, 13));
    if (!days.has(date)) days.set(date, { date, x: date + "T12:00:00+03:00", tempTotal: 0, rhTotal: 0, count: 0, rain: 0, rainHours: 0 });
    const day = days.get(date);
    if (hour >= 7 && hour < 18) { day.tempTotal += temp; day.rhTotal += rh; day.count++; }
    day.rain += p; day.rainHours++;
    if (date > stationLastDay && hour % 3 === 0) {
      recent.push({ x: time + EAT_SUFFIX, time: time.replace("T"," ") + " EAT", temp, rh });
    }
  });
  const daily = [...days.values()].sort((a,b)=>a.date.localeCompare(b.date)).map((d)=>({
    date: d.date, x: d.x,
    temp: d.count >= 2 ? d.tempTotal / d.count : null,
    rh: d.count >= 2 ? d.rhTotal / d.count : null,
    rain: Math.round(d.rain * 10) / 10,
    complete: d.rainHours >= 23
  }));
  const newer = daily.filter((d)=>d.date > stationLastDay && d.temp !== null);
  if (recent.length < 3 || !newer.length || !latest) throw new Error("No recent weather data beyond the archived records");
  function averageOver(size) {
    return newer.map((item,i)=>{
      const window = newer.slice(Math.max(0,i-size+1), i+1);
      return {x:item.x, time:item.date + " EAT", temp:window.reduce((n,r)=>n+r.temp,0)/window.length,
        rh:window.reduce((n,r)=>n+r.rh,0)/window.length};
    });
  }
  return {
    daily, recent, daily3:averageOver(3), daily7:averageOver(7),
    rain: daily.filter((d)=>d.date > regionalRainLastDay && d.complete),
    end:latest, updatedAt:Date.now(), lastDate:daily.at(-1)?.date || ""
  };
}

export function modelWeatherTraces(live, days) {
  if (!live) return [];
  const rows = days === 7 ? live.recent : days === 30 ? live.daily3 : live.daily7;
  const points = (key, yaxis, label, color, format) => ({
    x:rows.map((r)=>r.x), y:rows.map((r)=>r[key]),
    customdata:rows.map((r)=>r.time),
    type:"scatter",mode:"lines",name:label, xaxis:"x",yaxis,
    line:{color,width:2.6,dash:"dash"},
    hovertemplate:"%{customdata}<br><b>%{y:"+format.split(" ")[0]+"} "+format.split(" ").slice(1).join(" ")+"</b><extra>"+SOURCE+"</extra>"
  });
  return [
    points("temp","y","Temperature (modelled)","#e78a55",".1f °C"),
    points("rh","y2","Humidity (modelled)","#4ca58f",".0f % RH"),
    {x:live.rain.map((r)=>r.x), y:live.rain.map((r)=>r.rain),
      customdata:live.rain.map((r)=>r.date),type:"bar",name:"Rainfall (modelled)",opacity:.65,
      marker:{color:"#7da7d4",pattern:{shape:"/"}},xaxis:"x",yaxis:"y3",
      hovertemplate:"%{customdata} (EAT)<br><b>%{y:.1f} mm</b><extra>"+SOURCE+" (not a gauge)</extra>"}
  ];
}