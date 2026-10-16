/* KMFRI 2026 High-Low Tide Predictions for Mombasa, pages 10–13.
 * https://kmfri.go.ke/images/2026/pdf/2026-tide-predictions-kenya-1.pdf
 * Rows are: day  HH:MM (East Africa Time UTC+3)  lowest predicted low (m LAT).
 * Earlier predictions 19 Jun–17 Sep are retained from the site snapshot.
 */
const rowsByMonth = {
  "10": "01 12:52 0.43\n02 00:49 0.65\n03 01:32 0.92\n04 16:11 1.20\n05 18:13 1.15\n06 19:31 0.92\n07 20:20 0.66\n08 20:58 0.46\n09 21:32 0.33\n10 09:56 0.25\n11 10:30 0.17\n12 11:01 0.18\n13 11:31 0.26\n14 11:57 0.61\n15 12:30 0.58\n16 00:25 0.79\n17 00:53 1.00\n18 01:26 1.23\n19 02:17 1.48\n20 18:29 1.39\n21 19:28 1.17\n22 20:05 0.95\n23 20:37 0.73\n24 21:08 0.55\n25 09:37 0.30\n26 10:10 0.12\n27 10:45 0.03\n28 11:21 0.05\n29 11:59 0.17\n30 12:41 0.39\n31 13:29 0.66",
  "11": "01 14:30 0.93\n02 15:56 1.13\n03 17:36 1.14\n04 18:53 1.01\n05 19:46 0.86\n06 20:28 0.73\n07 09:05 0.59\n08 09:41 0.42\n09 10:13 0.32\n10 10:44 0.29\n11 11:13 0.33\n12 11:42 0.42\n13 12:12 0.55\n14 12:44 0.72\n15 13:21 0.91\n16 14:07 1.11\n17 15:14 1.28\n18 16:46 1.34\n19 18:07 1.26\n20 19:04 1.10\n21 19:49 0.91\n22 08:33 0.66\n23 09:13 0.39\n24 09:52 0.19\n25 10:31 0.07\n26 11:11 0.06\n27 11:52 0.15\n28 12:36 0.32\n29 13:23 0.54\n30 14:19 0.78",
  "12": "01 15:24 0.99\n02 16:41 1.13\n03 17:58 1.17\n04 19:03 1.15\n05 08:05 1.05\n06 08:50 0.83\n07 09:28 0.65\n08 10:01 0.52\n09 10:33 0.45\n10 11:03 0.43\n11 11:33 0.45\n12 11:54 0.76\n13 12:34 0.60\n14 13:07 0.72\n15 13:43 0.86\n16 14:27 1.01\n17 15:23 1.14\n18 16:34 1.22\n19 17:49 1.21\n20 07:07 1.10\n21 08:06 0.82\n22 08:56 0.54\n23 09:41 0.30\n24 10:24 0.13\n25 11:05 0.06\n26 11:46 0.08\n27 12:28 0.18\n28 13:10 0.34\n29 13:55 0.56\n30 14:43 0.82\n31 15:38 1.09",
  "09": "18 01:27 1.05\n19 02:03 1.30\n20 03:04 1.55\n21 19:38 1.35\n22 20:22 1.09\n23 20:52 0.84\n24 21:20 0.62\n25 21:47 0.43\n26 22:14 0.31\n27 10:33 0.17\n28 11:05 0.08\n29 11:38 0.10\n30 12:14 0.22"
};
const tide = window.DRYER_TIDE;
if (tide && Array.isArray(tide.date) && Array.isArray(tide.height)) {
  const existing = new Set(tide.date);
  Object.entries(rowsByMonth).forEach(([month, text]) => {
    text.trim().split(/\r?\n/).forEach((line) => {
      const [day, time, rawHeight] = line.trim().split(/\s+/);
      const date = "2026-" + month + "-" + day;
      const height = Number(rawHeight);
      if (existing.has(date) || !/^\d\d:\d\d$/.test(time) || !Number.isFinite(height)) return;
      existing.add(date);
      tide.x.push(date + "T" + time + ":00");
      tide.date.push(date);
      tide.time.push(time);
      tide.height.push(height);
    });
  });
  // Same ordering across x, date, time and height after extension.
  const ordered=tide.date.map((date,i)=>({date,x:tide.x[i],time:tide.time[i],height:tide.height[i]}))
    .sort((a,b)=>a.date.localeCompare(b.date));
  tide.x=ordered.map(x=>x.x);
  tide.date=ordered.map(x=>x.date);
  tide.time=ordered.map(x=>x.time);
  tide.height=ordered.map(x=>x.height);
  tide.coverageEnd=tide.date[tide.date.length-1];
  tide.source="KMFRI 2026 Mombasa High–Low Tide Predictions (UTC+3)";
}
