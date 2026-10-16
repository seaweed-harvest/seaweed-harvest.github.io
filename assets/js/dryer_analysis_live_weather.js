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
  const days = new Map(), recent = [], recentAll = [];
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
    if (hour % 3 === 0) {
      const row = {x:time + EAT_SUFFIX, time:time.replace("T"," ")+" EAT", temp, rh};
      recentAll.push(row);
      if (date > stationLastDay) recent.push(row);
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
    daily, recent, recentAll, daily3:averageOver(3), daily7:averageOver(7),
    rain: daily.filter((d)=>d.date > regionalRainLastDay && d.complete),
    end:latest, updatedAt:Date.now(), lastDate:daily.at(-1)?.date || ""
  };
}

// Plot a single consistent source over the entire visible date range.
// Bati station observations stay intact in dryer_analysis_weather_snapshot.js,
// but are deliberately not spliced into the modelled time series.
export function modelWeatherTraces(live, days) {
  if (!live) return [];
  const recent=live.recentAll || live.recent;
  const daily=live.daily.filter(d=>Number.isFinite(d.temp) && Number.isFinite(d.rh));
  const windowSize=days===90?7:3;
  const series=days===7?recent:daily.map((r,i)=>{
    const rows=daily.slice(Math.max(0,i-windowSize+1),i+1);
    return {
      x:r.x,time:r.date+" EAT",
      temp:rows.reduce((total,item)=>total+item.temp,0)/rows.length,
      rh:rows.reduce((total,item)=>total+item.rh,0)/rows.length
    };
  });
  const rainfall=live.daily.filter(d=>d.complete&&Number.isFinite(d.rain));
  return [
    {x:series.map(d=>d.x),y:series.map(d=>d.temp),customdata:series.map(d=>d.time),
      name:"Temperature",type:"scatter",mode:"lines",
      line:{color:"#e78a55",width:2.7,shape:"spline",smoothing:.25},
      xaxis:"x",yaxis:"y",connectgaps:false,
      hovertemplate:"%{customdata}<br><b>%{y:.1f} °C</b><extra>Open-Meteo · Mwazaro model</extra>"},
    {x:series.map(d=>d.x),y:series.map(d=>d.rh),customdata:series.map(d=>d.time),
      name:"Humidity",type:"scatter",mode:"lines",
      line:{color:"#4ca58f",width:2.5,shape:"spline",smoothing:.25},
      xaxis:"x",yaxis:"y2",connectgaps:false,
      hovertemplate:"%{customdata}<br><b>%{y:.0f}% RH</b><extra>Open-Meteo · Mwazaro model</extra>"},
    {x:rainfall.map(d=>d.x),y:rainfall.map(d=>d.rain),
      customdata:rainfall.map(d=>d.date),name:"Rainfall",
      type:"bar",marker:{color:"#7da7d4"},opacity:.5,
      xaxis:"x",yaxis:"y3",
      hovertemplate:"%{customdata} EAT<br><b>%{y:.1f} mm</b><extra>Open-Meteo · Mwazaro modelled rainfall</extra>"}
  ];
}

// The station recorded different local conditions from the regional weather model.
// Calibrate the model against their overlap, using a recent robust median offset,
// while preserving the original model numbers in hover metadata. The first modeled
// day's movement therefore follows the actual model trend from the final observed
// station day, rather than drawing an artificial step on the plot.
function median(numbers) {
  const a=numbers.filter(Number.isFinite).sort((x,y)=>x-y);
  if (!a.length) return null;
  return a.length%2 ? a[(a.length-1)/2] : (a[a.length/2-1]+a[a.length/2])/2;
}

function smoothedModelDaily(live, span) {
  const days=live.daily.filter(d=>Number.isFinite(d.temp)&&Number.isFinite(d.rh));
  return days.map((d,i)=>{
    const sample=days.slice(Math.max(0,i-span+1),i+1);
    return { ...d,
      rawTemp:sample.reduce((s,x)=>s+x.temp,0)/sample.length,
      rawRh:sample.reduce((s,x)=>s+x.rh,0)/sample.length
    };
  });
}
function standardDate(time) { return String(time).slice(0,10); }
function datedNoon(date) { return date+"T12:00:00+03:00"; }
function stationDaily(snapshot, span) {
  const series=span===7?snapshot.threeMonth:snapshot.oneMonth;
  return series.x.map((x,i)=>({date:standardDate(x),temp:series.temp[i],rh:series.hum[i]}))
    .filter(row=>Number.isFinite(row.temp)&&Number.isFinite(row.rh));
}
function offsetsFor(station, model, archiveEnd) {
  const byDate=new Map(model.map(row=>[row.date,row]));
  const common=station.filter(row=>row.date<=archiveEnd&&byDate.has(row.date));
  const recent=common.slice(-21);
  const last=common.at(-1);
  const differences=(key)=>{
    const rawKey=key==="temp"?"rawTemp":"rawRh";
    const delta=median(recent.map(row=>row[key]-byDate.get(row.date)[rawKey]));
    const anchored=last?last[key]-byDate.get(last.date)[rawKey]:delta;
    return {stable:Number.isFinite(delta)?delta:0, anchor:Number.isFinite(anchored)?anchored:(delta||0)};
  };
  return {temp:differences("temp"),rh:differences("rh"), anchorDay:last?.date||archiveEnd};
}
function daysFrom(date1,date2) {
  return Math.round((Date.parse(date1+"T00:00:00Z")-Date.parse(date2+"T00:00:00Z"))/86400000);
}
function stationAlignedValue(raw,offset,days) {
  // Over the first ten days ease from handover alignment to the robust
  // overlapping-period bias. This only calibrates *modelled* values.
  const progression=Math.min(1,Math.max(0,(days-1)/10));
  const correction=offset.anchor+(offset.stable-offset.anchor)*progression;
  return raw+correction;
}

export function alignedModelDays(snapshot,live,span) {
  if(!live) return [];
  const station=stationDaily(snapshot,span),archiveEnd=station.at(-1)?.date||"";
  const model=smoothedModelDaily(live,span);
  const offset=offsetsFor(station,model,archiveEnd);
  return model.filter(row=>row.date>archiveEnd).map(row=>{
    const days=daysFrom(row.date,offset.anchorDay);
    return {...row,
      temp:stationAlignedValue(row.rawTemp,offset.temp,days),
      rh:Math.max(0,Math.min(100,stationAlignedValue(row.rawRh,offset.rh,days))),
      modelSource:"Mwazaro model · station-baseline adjusted"
    };
  });
}

function combineDailySeries(snapshot,live,days) {
  const span=days===90?7:3;
  const station=stationDaily(snapshot,span);
  const archived=station.map(d=>({
    ...d,x:datedNoon(d.date),origin:"Bati station (archived)",rawTemp:d.temp,rawRh:d.rh
  }));
  const updated=alignedModelDays(snapshot,live,span).map(d=>({
    ...d,x:datedNoon(d.date),origin:"Mwazaro model (station-aligned)"
  }));
  return archived.concat(updated).sort((a,b)=>a.date.localeCompare(b.date));
}

function combineHourlySeries(snapshot,live) {
  const old=snapshot.recent.x.map((x,i)=>({
    x:/[+-]\d\d:\d\d$/.test(x)?x:x+"+03:00",
    date:standardDate(x),time:x.replace("T"," ")+" EAT",
    temp:snapshot.recent.temp[i],rh:snapshot.recent.hum[i],
    origin:"Bati station (archived)",rawTemp:snapshot.recent.temp[i],rawRh:snapshot.recent.hum[i]
  })).filter(d=>Number.isFinite(d.temp)&&Number.isFinite(d.rh));
  if(!live)return old;
  const last=Date.parse(old.at(-1)?.x||"");
  const model=live.recentAll||live.recent;
  const overlap=model.filter(r=>Date.parse(r.x)<=last);
  const stationByTime=new Map(old.map(d=>[Date.parse(d.x),d]));
  const common=overlap.filter(r=>stationByTime.has(Date.parse(r.x))).slice(-8);
  const tOffset=median(common.map(r=>stationByTime.get(Date.parse(r.x)).temp-r.temp))??0;
  const rhOffset=median(common.map(r=>stationByTime.get(Date.parse(r.x)).rh-r.rh))??0;
  const finalArchive=old.at(-1);
  const matchingModel=model.find(r=>Date.parse(r.x)===last);
  const anchorTemp=matchingModel?finalArchive.temp-matchingModel.temp:tOffset;
  const anchorRh=matchingModel?finalArchive.rh-matchingModel.rh:rhOffset;
  const newer=model.filter(d=>Date.parse(d.x)>last).map(r=>{
    const days=Math.max(0,(Date.parse(r.x)-last)/86400000);
    const fade=Math.min(1,days/10);
    const tempCorrection=anchorTemp+(tOffset-anchorTemp)*fade;
    const rhCorrection=anchorRh+(rhOffset-anchorRh)*fade;
    return {
      ...r,date:standardDate(r.x),rawTemp:r.temp,rawRh:r.rh,
      temp:r.temp+tempCorrection,rh:Math.max(0,Math.min(100,r.rh+rhCorrection)),
      origin:"Mwazaro model (station-aligned)"
    };
  });
  return old.concat(newer);
}

export function seamlessDryerWeatherTraces(snapshot,live,days) {
  const rows=days===7?combineHourlySeries(snapshot,live):combineDailySeries(snapshot,live,days);
  const plotLine=(key,rawKey,name,color,axis,units,format)=>{
    const customdata=rows.map(d=>[
      d.date,
      d.origin,
      Number(d[rawKey]).toFixed(key==="temp"?1:0)+units
    ]);
    return {
      x:rows.map(d=>d.x),y:rows.map(d=>d[key]),customdata,
      type:"scatter",mode:"lines",name,line:{color,width:2.6,shape:"spline",smoothing:.25},
      xaxis:"x",yaxis:axis,connectgaps:false,
      hovertemplate:"%{customdata[0]}<br><b>%{y:"+format+"} "+units+"</b><br>%{customdata[1]}<br>Original value: %{customdata[2]}<extra>"+name+"</extra>"
    };
  };
  const archiveRain=snapshot.rain.x.map((x,i)=>({
    date:standardDate(x),x:datedNoon(standardDate(x)),rain:snapshot.rain.y[i],
    origin:snapshot.rain.source[i]||"Regional archive",modelled:false
  }));
  const modelRain=(live?.rain||[]).map(d=>({
    date:d.date,x:datedNoon(d.date),rain:d.rain,origin:SOURCE+" (not a gauge)",modelled:true
  }));
  const rainfall=archiveRain.concat(modelRain).sort((a,b)=>a.date.localeCompare(b.date));
  return [
    plotLine("temp","rawTemp","Temperature","#e78a55","y","°C",".1f"),
    plotLine("rh","rawRh","Humidity","#4ca58f","y2","% RH",".0f"),
    {
      x:rainfall.map(d=>d.x),y:rainfall.map(d=>d.rain),
      customdata:rainfall.map(d=>[d.date,d.origin]),type:"bar",name:"Rainfall",
      marker:{color:"#7da7d4",pattern:{shape:rainfall.map(d=>d.modelled?"/":"")}},
      opacity:.55,xaxis:"x",yaxis:"y3",
      hovertemplate:"%{customdata[0]}<br><b>%{y:.1f} mm</b><br>%{customdata[1]}<extra>Rainfall</extra>"
    }
  ];
}
