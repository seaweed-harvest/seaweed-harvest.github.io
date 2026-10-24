# Dryer Table Analysis — mobile weather and drying timeline

Date: 24 October 2026

## User report and source
The COSME > Dryer Table > Records > Analysis > “2. Drying timeline + Weather” chart is readable on desktop but has overlapping axis titles, values, and timeline labels on an iPhone. User supplied a phone screenshot. Do not modify desktop behavior.

## Repository and base
- Repository: `seaweed-harvest/seaweed-harvest.github.io` (live app).
- Base: `main` at `c8464221c02145975248cdc0342de74b339ea710`.
- Branch: `fix/dryer-weather-mobile-stacked-20261024`.
- Approval: review branch and draft PR; no automatic deployment or merge.

## Scope and acceptance
- Only the existing Dryer Analysis weather chart’s presentation changes on narrow layouts (chart width <620px).
- Keep the desktop Plotly layout function and all data, weather model, stored records and range/tide behavior unchanged.
- Put temperature, humidity, rainfall, optional KMFRI tide and drying periods into separate, vertically stacked axes on mobile, with an abbreviated category-label display (full text stays in tooltips).
- Show date labels at the bottom, reduce mobile tick density, retain the existing date ranges and tide-day shading.
- Use the available phone width rather than an impossible collection of independent overlay axes; make the mobile chart taller instead of horizontally overflowing.
- Change between desktop and mobile layouts when parent width crosses breakpoint (including device rotation).
- Cache-bust the affected stylesheet and module only.

## Risk and rollback
Presentation-only Lane A candidate (no authentication, database, permission, payment, service-worker or deployment changes). If required browser verification is missing, retain draft PR and do not merge. Rollback: revert PR; no data migration or records mutation.

## Testing
- JavaScript syntax check.
- Deterministic Node contract checks of nonoverlapping y-axis domains, optional tide row, original desktop layout immutability, responsive switch, CSS heights and cache-busting.
- Required before merge: actual mobile and desktop browser probes (320–430px phones, tablet/desktop, 7d/30d/90d, tide on/off, rotate/resizing, hover/tap drying periods). These cannot be asserted as passed from a static test alone.
