import { createClient } from "npm:@supabase/supabase-js@2.110.2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const SUMMARY_SECRET = Deno.env.get("DAILY_AGGREGATION_SUMMARY_SECRET") ?? "";
const MANUAL_SECRET = Deno.env.get("DAILY_RECORD_EMAIL_MANUAL_SECRET") ?? "";
const FROM_EMAIL = Deno.env.get("DAILY_RECORD_EMAIL_FROM")
  ?? "Seaweed Harvest <no-reply@auth.seaweed-harvest.com>";
const APP_SITE_URL = (Deno.env.get("APP_SITE_URL") ?? "https://seaweed-harvest.com")
  .replace(/\/$/, "");
const PAGE_SIZE = 1000;

const responseHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-daily-email-summary-secret, x-daily-email-manual-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Cache-Control": "no-store",
  "Content-Type": "application/json"
};

type Recipient = {
  userId: string | null;
  email: string;
  name: string;
};

type DailySummary = {
  summary_date: string;
  collection_count: number;
  farmer_count: number;
  community_count: number;
  intake_weight_kg: number;
  intake_value_ksh: number;
  grade_a_kg: number;
  grade_b_kg: number;
  grade_c_kg: number;
  ungraded_kg: number;
  intake_community_breakdown: Array<{ community_name: string; weight_kg: number }>;
  site_sample_count: number;
  site_location_count: number;
  site_locations: string[];
  stock_record_count: number;
  stock_container_count: number;
  stock_volume_l: number;
  stock_sodium_benzoate_range: string | null;
  stock_citric_acid_range: string | null;
  stock_salinity_range: string | null;
  stock_ph_range: string | null;
  stock_ec_range: string | null;
  process_record_count: number;
  process_received_kg: number;
  process_wet_pulp_kg: number;
  process_pressed_liquid_l: number;
  process_dry_pulp_kg: number;
  process_lost_kg: number;
  process_press_count: number;
  process_minutes: number;
  process_avg_wet_pulp_per_press: number;
  process_wet_dry_percent: number;
  stock_l_per_intake_kg: number;
};

type EmailMetric = {
  label: string;
  value: string;
  full?: boolean;
};

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: responseHeaders });
  if (request.method !== "POST") return jsonResponse({ error: "POST required" }, 405);

  try {
    const hasSchedulerSecret = Boolean(SUMMARY_SECRET)
      && request.headers.get("x-daily-email-summary-secret") === SUMMARY_SECRET;
    const hasManualSecret = Boolean(MANUAL_SECRET)
      && request.headers.get("x-daily-email-manual-secret") === MANUAL_SECRET;
    if (!hasSchedulerSecret && !hasManualSecret) {
      return jsonResponse({ error: "Unauthorized daily summary invocation" }, 401);
    }

    const body = await request.json().catch(() => ({}));
    if (body.action === "delivery_status") {
      if (!RESEND_API_KEY) throw new HttpError(503, "RESEND_API_KEY is not configured");
      return jsonResponse(await loadDeliveryStatus(body.provider_message_id));
    }

    const summaryDate = validDate(body.summary_date)
      ? body.summary_date
      : shiftDate(nairobiDate(), -1);
    const aggregatorCode = validAggregatorCode(body.aggregator_code ?? "MAWIMBI");
    const dryRun = body.dry_run === true;
    const force = body.force === true;
    const testRecipient = optionalEmail(body.test_recipient);

    if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
      throw new HttpError(500, "Missing Supabase runtime credentials");
    }
    if (!dryRun && !RESEND_API_KEY) {
      throw new HttpError(503, "RESEND_API_KEY is not configured");
    }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false }
    });
    const aggregator = await loadAggregator(admin, aggregatorCode);
    const summary = await buildSummary(admin, aggregator.id, summaryDate);
    const recentSummaries = (await Promise.all(
      [1, 2, 3, 4].map((daysAgo) =>
        buildSummary(admin, aggregator.id, shiftDate(summaryDate, -daysAgo))
      )
    )).filter(hasOperationalRecords);
    const recipients = testRecipient
      ? [{ userId: null, email: testRecipient, name: "Test recipient" }]
      : await loadRecipients(admin, aggregator.id);
    const subject = `${aggregator.short_name || aggregator.organisation_name} daily record - ${displayDate(summaryDate)}`;

    if (dryRun) {
      return jsonResponse({
        ok: true,
        dry_run: true,
        aggregator: {
          id: aggregator.id,
          code: aggregator.aggregator_code,
          name: aggregator.organisation_name
        },
        summary_date: summaryDate,
        subject,
        recipient_count: recipients.length,
        recipients: recipients.map((recipient) => maskEmail(recipient.email)),
        summary,
        recent_summaries: recentSummaries
      });
    }

    const results = [];
    for (const recipient of recipients) {
      results.push(await deliverSummary({
        admin,
        aggregator,
        recipient,
        summary,
        recentSummaries,
        subject,
        force
      }));
    }

    const failed = results.filter((result) => result.status === "failed");
    const response = {
      ok: failed.length === 0,
      dry_run: false,
      aggregator: {
        id: aggregator.id,
        code: aggregator.aggregator_code,
        name: aggregator.organisation_name
      },
      summary_date: summaryDate,
      subject,
      recipient_count: recipients.length,
      sent_count: results.filter((result) => result.status === "sent").length,
      skipped_count: results.filter((result) => result.status === "skipped").length,
      failed_count: failed.length,
      no_recipients: recipients.length === 0,
      deliveries: results
    };
    return jsonResponse(response, failed.length ? 500 : 200);
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    return jsonResponse({
      ok: false,
      error: error instanceof Error ? error.message : "Daily summary failed"
    }, status);
  }
});

async function loadDeliveryStatus(value: unknown) {
  const messageId = String(value || "").trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(messageId)) {
    throw new HttpError(400, "Select a valid provider message ID");
  }
  const response = await fetch(`https://api.resend.com/emails/${messageId}`, {
    headers: { Authorization: `Bearer ${RESEND_API_KEY}` }
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new HttpError(
      response.status,
      String(result?.message || result?.error || `Resend returned ${response.status}`)
    );
  }
  return {
    ok: true,
    provider_message_id: result.id || messageId,
    created_at: result.created_at || null,
    from: result.from || null,
    to: Array.isArray(result.to) ? result.to.map(maskEmail) : [],
    subject: result.subject || null,
    last_event: result.last_event || null
  };
}

async function loadAggregator(admin: any, code: string) {
  const { data, error } = await admin
    .from("ag_aggregators")
    .select("id,aggregator_code,organisation_name,short_name")
    .eq("aggregator_code", code)
    .eq("active", true)
    .maybeSingle();
  if (error) throw new HttpError(400, error.message);
  if (!data) throw new HttpError(404, `Active organisation ${code} was not found`);
  return data;
}

async function loadRecipients(admin: any, aggregatorId: string): Promise<Recipient[]> {
  const { data: memberships, error: membershipError } = await admin
    .from("ag_aggregator_memberships")
    .select("user_id")
    .eq("aggregator_id", aggregatorId)
    .eq("is_active", true)
    .eq("receive_daily_summary_email", true);
  if (membershipError) throw new HttpError(400, membershipError.message);

  const userIds = [...new Set((memberships || []).map((row: any) => String(row.user_id)))];
  if (!userIds.length) return [];

  const { data: profiles, error: profileError } = await admin
    .from("ag_user_profiles")
    .select("id,email,display_name,account_status")
    .in("id", userIds)
    .eq("account_status", "active");
  if (profileError) throw new HttpError(400, profileError.message);

  return (profiles || [])
    .map((profile: any) => ({
      userId: String(profile.id),
      email: String(profile.email || "").trim().toLowerCase(),
      name: String(profile.display_name || "").trim() || "Seaweed Harvest user"
    }))
    .filter((recipient: Recipient) => Boolean(optionalEmail(recipient.email)))
    .sort((left: Recipient, right: Recipient) => left.email.localeCompare(right.email));
}

async function buildSummary(
  admin: any,
  aggregatorId: string,
  summaryDate: string
): Promise<DailySummary> {
  const { start, end } = nairobiRange(summaryDate);
  const [collections, siteSamples, stockRecords, processRecords] = await Promise.all([
    allPages((from, to) => admin
      .from("collections")
      .select("id,collected_at,sack_weight_kg,line_total_snapshot,total_price,price_per_kg,grade_code,seaweed_grade,community_id,community_name_snapshot,farmer_record_id,farmer_id,farmer_name_snapshot")
      .eq("aggregator_id", aggregatorId)
      .gte("collected_at", start)
      .lt("collected_at", end)
      .order("collected_at", { ascending: true })
      .range(from, to)),
    allPages((from, to) => admin
      .from("ag_site_water_sample_records")
      .select("id,community_id_snapshot,community_name_snapshot")
      .eq("aggregator_id", aggregatorId)
      .gte("sampled_at", start)
      .lt("sampled_at", end)
      .range(from, to)),
    allPages((from, to) => admin
      .from("ag_stabilization_packing_records")
      .select("id,carton_serial,record_type,weight_value,weight_unit,stabilizer_added,chemical_dose_value,chemical_dose_unit,citric_acid_added,citric_acid_dose_value,citric_acid_dose_unit,salinity_value,salinity_unit,ph_value,electrical_conductivity_ms_cm")
      .eq("aggregator_id", aggregatorId)
      .eq("packed_on", summaryDate)
      .range(from, to)),
    allPages((from, to) => admin
      .from("ag_process_records")
      .select("id,received_seaweed_kg,wet_pulp_kg,pressed_liquid_l,dry_pulp_kg,lost_seaweed_kg,number_of_presses,start_time,end_time")
      .eq("aggregator_id", aggregatorId)
      .eq("process_date", summaryDate)
      .range(from, to))
  ]);

  const collectionIds = collections.map((row: any) => String(row.id));
  const allocations = await loadAllocations(admin, collectionIds);
  const allocationIds = new Set(allocations.map((row: any) => String(row.collection_id)));
  const farmerKeys = new Set<string>();
  for (const allocation of allocations) {
    const key = firstValue(
      allocation.farmer_record_id,
      allocation.farmer_id_snapshot,
      normalizedText(allocation.farmer_name_snapshot)
    );
    if (key) farmerKeys.add(String(key));
  }

  let intakeWeight = 0;
  let intakeValue = 0;
  const grades = { A: 0, B: 0, C: 0, ungraded: 0 };
  const communities = new Map<string, { name: string; weight: number }>();
  const countedCommunities = new Set<string>();
  for (const collection of collections) {
    const weight = numberValue(collection.sack_weight_kg);
    intakeWeight += weight;
    intakeValue += firstNumber(
      collection.line_total_snapshot,
      collection.total_price,
      weight * numberValue(collection.price_per_kg)
    );
    const grade = String(collection.grade_code || collection.seaweed_grade || "")
      .trim().toUpperCase();
    if (grade === "A" || grade === "B" || grade === "C") grades[grade] += weight;
    else grades.ungraded += weight;

    const recordedCommunity = String(
      collection.community_id || collection.community_name_snapshot || ""
    ).trim();
    const communityName = String(
      collection.community_name_snapshot || collection.community_id || "Community not recorded"
    ).trim();
    const communityKey = String(
      collection.community_id || normalizedText(communityName) || "community-not-recorded"
    );
    if (recordedCommunity) countedCommunities.add(communityKey);
    const current = communities.get(communityKey) || { name: communityName, weight: 0 };
    current.weight += weight;
    communities.set(communityKey, current);

    if (!allocationIds.has(String(collection.id))) {
      const farmerKey = firstValue(
        collection.farmer_record_id,
        collection.farmer_id,
        normalizedText(collection.farmer_name_snapshot)
      );
      if (farmerKey) farmerKeys.add(String(farmerKey));
    }
  }

  const siteLocations = new Set<string>();
  for (const sample of siteSamples) {
    const label = [sample.community_id_snapshot, sample.community_name_snapshot]
      .map((value) => String(value || "").trim())
      .filter(Boolean)
      .join(" - ");
    if (label) siteLocations.add(label);
  }

  const initialStock = stockRecords.filter((row: any) =>
    String(row.record_type || "initial") === "initial");
  const stockVolume = initialStock.reduce((total: number, row: any) => {
    const value = numberValue(row.weight_value);
    if (row.weight_unit === "L") return total + value;
    if (row.weight_unit === "mL") return total + value / 1000;
    return total;
  }, 0);
  const stockContainers = new Set(
    initialStock.map((row: any) => String(row.carton_serial || "").trim()).filter(Boolean)
  );

  const processTotals = processRecords.reduce((totals: any, row: any) => {
    totals.received += numberValue(row.received_seaweed_kg);
    totals.wet += numberValue(row.wet_pulp_kg);
    totals.liquid += numberValue(row.pressed_liquid_l);
    totals.dry += numberValue(row.dry_pulp_kg);
    totals.lost += numberValue(row.lost_seaweed_kg);
    totals.presses += numberValue(row.number_of_presses);
    totals.minutes += timeDifferenceMinutes(row.start_time, row.end_time);
    return totals;
  }, { received: 0, wet: 0, liquid: 0, dry: 0, lost: 0, presses: 0, minutes: 0 });

  const showStockRanges = stockVolume > 0;
  return {
    summary_date: summaryDate,
    collection_count: collections.length,
    farmer_count: farmerKeys.size,
    community_count: countedCommunities.size,
    intake_weight_kg: rounded(intakeWeight),
    intake_value_ksh: rounded(intakeValue),
    grade_a_kg: rounded(grades.A),
    grade_b_kg: rounded(grades.B),
    grade_c_kg: rounded(grades.C),
    ungraded_kg: rounded(grades.ungraded),
    intake_community_breakdown: [...communities.values()]
      .map((item) => ({
        community_name: item.name.replace(/^CID\d+\s*-\s*/i, ""),
        weight_kg: rounded(item.weight)
      }))
      .sort((left, right) => left.community_name.localeCompare(right.community_name)),
    site_sample_count: siteSamples.length,
    site_location_count: siteLocations.size,
    site_locations: [...siteLocations].sort((left, right) => left.localeCompare(right)),
    stock_record_count: stockRecords.length,
    stock_container_count: stockContainers.size,
    stock_volume_l: rounded(stockVolume),
    stock_sodium_benzoate_range: showStockRanges
      ? groupedRange(stockRecords, "chemical_dose_value", "chemical_dose_unit", "g/container",
        (row) => row.stabilizer_added === true)
      : null,
    stock_citric_acid_range: showStockRanges
      ? groupedRange(stockRecords, "citric_acid_dose_value", "citric_acid_dose_unit", "g/container",
        (row) => row.citric_acid_added === true)
      : null,
    stock_salinity_range: showStockRanges
      ? groupedRange(stockRecords, "salinity_value", "salinity_unit", "PSU")
      : null,
    stock_ph_range: showStockRanges ? simpleRange(stockRecords, "ph_value") : null,
    stock_ec_range: showStockRanges
      ? simpleRange(stockRecords, "electrical_conductivity_ms_cm", "mS/cm")
      : null,
    process_record_count: processRecords.length,
    process_received_kg: rounded(processTotals.received),
    process_wet_pulp_kg: rounded(processTotals.wet),
    process_pressed_liquid_l: rounded(processTotals.liquid),
    process_dry_pulp_kg: rounded(processTotals.dry),
    process_lost_kg: rounded(processTotals.lost),
    process_press_count: rounded(processTotals.presses),
    process_minutes: rounded(processTotals.minutes),
    process_avg_wet_pulp_per_press: processTotals.presses > 0
      ? rounded(processTotals.wet / processTotals.presses)
      : 0,
    process_wet_dry_percent: processTotals.wet > 0
      ? rounded(100 - ((processTotals.dry / processTotals.wet) * 100))
      : 0,
    stock_l_per_intake_kg: intakeWeight > 0 ? rounded(stockVolume / intakeWeight, 3) : 0
  };
}

function hasOperationalRecords(summary: DailySummary) {
  return summary.collection_count > 0
    || summary.site_sample_count > 0
    || summary.stock_record_count > 0
    || summary.process_record_count > 0;
}

async function loadAllocations(admin: any, collectionIds: string[]) {
  const rows: any[] = [];
  for (let index = 0; index < collectionIds.length; index += 200) {
    const chunk = collectionIds.slice(index, index + 200);
    const { data, error } = await admin
      .from("ag_collection_farmer_allocations")
      .select("collection_id,farmer_record_id,farmer_id_snapshot,farmer_name_snapshot")
      .in("collection_id", chunk);
    if (error) throw new HttpError(400, error.message);
    rows.push(...(data || []));
  }
  return rows;
}

async function allPages(loadPage: (from: number, to: number) => PromiseLike<any>) {
  const rows: any[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await loadPage(offset, offset + PAGE_SIZE - 1);
    if (error) throw new HttpError(400, error.message);
    const page = data || [];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  return rows;
}

async function deliverSummary(options: {
  admin: any;
  aggregator: any;
  recipient: Recipient;
  summary: DailySummary;
  recentSummaries: DailySummary[];
  subject: string;
  force: boolean;
}) {
  const { admin, aggregator, recipient, summary, recentSummaries, subject, force } = options;
  const email = recipient.email.toLowerCase();
  const { data: existing, error: existingError } = await admin
    .from("ag_daily_record_email_deliveries")
    .select("id,status,attempt_count")
    .eq("aggregator_id", aggregator.id)
    .eq("summary_date", summary.summary_date)
    .eq("recipient_email", email)
    .maybeSingle();
  if (existingError) throw new HttpError(400, existingError.message);
  if (existing?.status === "sent" && !force) {
    return { recipient: maskEmail(email), status: "skipped", reason: "already_sent" };
  }

  const attemptAt = new Date().toISOString();
  const delivery = {
    aggregator_id: aggregator.id,
    summary_date: summary.summary_date,
    recipient_user_id: recipient.userId,
    recipient_email: email,
    status: "pending",
    attempt_count: numberValue(existing?.attempt_count) + 1,
    subject,
    summary_payload: summary,
    provider_message_id: null,
    error_text: null,
    first_attempt_at: existing?.id ? undefined : attemptAt,
    last_attempt_at: attemptAt,
    sent_at: null,
    updated_at: attemptAt
  };
  const cleanDelivery = Object.fromEntries(
    Object.entries(delivery).filter(([, value]) => value !== undefined)
  );
  const { error: pendingError } = await admin
    .from("ag_daily_record_email_deliveries")
    .upsert(cleanDelivery, {
      onConflict: "aggregator_id,summary_date,recipient_email"
    });
  if (pendingError) throw new HttpError(400, pendingError.message);

  try {
    const html = emailHtml(aggregator, recipient, summary, recentSummaries);
    const text = emailText(aggregator, summary, recentSummaries);
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
        "Idempotency-Key": force
          ? `daily-record:${aggregator.id}:${summary.summary_date}:${email}:${crypto.randomUUID()}`
          : `daily-record:${aggregator.id}:${summary.summary_date}:${email}`
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: [email],
        subject,
        html,
        text
      })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(String(result?.message || result?.error || `Resend returned ${response.status}`));
    }
    await admin.from("ag_daily_record_email_deliveries").update({
      status: "sent",
      provider_message_id: result?.id || null,
      error_text: null,
      sent_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    })
      .eq("aggregator_id", aggregator.id)
      .eq("summary_date", summary.summary_date)
      .eq("recipient_email", email);
    return {
      recipient: maskEmail(email),
      status: "sent",
      provider_message_id: result?.id || null
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Email delivery failed";
    await admin.from("ag_daily_record_email_deliveries").update({
      status: "failed",
      error_text: message.slice(0, 1000),
      updated_at: new Date().toISOString()
    })
      .eq("aggregator_id", aggregator.id)
      .eq("summary_date", summary.summary_date)
      .eq("recipient_email", email);
    return { recipient: maskEmail(email), status: "failed", error: message };
  }
}

function emailHtml(
  aggregator: any,
  recipient: Recipient,
  summary: DailySummary,
  recentSummaries: DailySummary[]
) {
  const recordUrl = `${APP_SITE_URL}/today.html?records=summary&date=${summary.summary_date}`;
  const communities = summary.intake_community_breakdown.length
    ? summary.intake_community_breakdown
      .map((item) => `${formatNumber(item.weight_kg)}kg - ${escapeHtml(item.community_name)}`)
      .join("<br>")
    : "No intake communities recorded";
  const siteStatus = summary.site_sample_count
    ? `${formatInteger(summary.site_sample_count)} sample${summary.site_sample_count === 1 ? "" : "s"}`
      + (summary.site_locations.length
        ? `<br><span style="font-weight:400">${summary.site_locations.map(escapeHtml).join("<br>")}</span>`
        : "")
    : "No site water sample taken";
  const stockRanges = summary.stock_volume_l > 0
    ? [
        metric("Sodium benzoate", summary.stock_sodium_benzoate_range || "-"),
        metric("Citric acid", summary.stock_citric_acid_range || "-"),
        metric("Salinity", summary.stock_salinity_range || "-"),
        metric("pH", summary.stock_ph_range || "-"),
        metric("EC", summary.stock_ec_range || "-")
      ]
    : [];
  const recentRecords = recentSummaries.length
    ? `<tr><td style="padding:18px 24px 0">
        <div style="margin:0 0 8px;padding-top:14px;border-top:2px solid #0f766e;font-size:13px;font-weight:700;color:#365f59">Recent daily records</div>
        ${recentSummaries.map((recent) => emailMetricTable(
          displayDate(recent.summary_date),
          [
            metric("Total intake weight", `${formatNumber(recent.intake_weight_kg)} kg`),
            metric("Total paid", `${formatNumber(recent.intake_value_ksh)} KSH`),
            metric("Stock volume", `${formatNumber(recent.stock_volume_l)} L`),
            metric("Processing time", formatDuration(recent.process_minutes)),
            metric("Collections", formatInteger(recent.collection_count)),
            metric("Site samples", formatInteger(recent.site_sample_count)),
            metric("Communities", formatInteger(recent.community_count))
          ],
          `${APP_SITE_URL}/today.html?records=summary&date=${recent.summary_date}`
        )).join("")}
      </td></tr>`
    : "";

  return `<!doctype html>
<html>
<body style="margin:0;background:#eef8f7;color:#123d39;font-family:Arial,sans-serif">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
    <tr><td align="center" style="padding:20px 10px">
      <table role="presentation" width="720" cellspacing="0" cellpadding="0" border="0"
        style="width:100%;max-width:720px;background:#fff;border:1px solid #c7e2dd;border-radius:8px;overflow:hidden">
        <tr><td style="height:6px;background:#0f766e;font-size:0;line-height:0">&nbsp;</td></tr>
        <tr><td style="padding:18px 24px 12px">
          <img src="${APP_SITE_URL}/assets/images/seaweed-harvest-logo.png" width="230" alt="Seaweed Harvest"
            style="display:block;width:230px;max-width:72%;height:auto;border:0">
          <div style="margin-top:8px;font-size:13px;color:#466b66">${escapeHtml(aggregator.organisation_name)}</div>
        </td></tr>
        <tr><td style="padding:12px 24px 6px;border-top:1px solid #dcece9">
          <div style="font-size:13px;color:#5f7e79">DAILY RECORD</div>
          <div style="margin:4px 0 0;line-height:1.35">
            <span style="font-size:22px;font-weight:700;color:#123d39">${displayDate(summary.summary_date)}</span>
            <span style="font-size:13px;font-weight:400;color:#466b66">
              (<a href="${recordUrl}" style="color:#2b7dbc!important;background:transparent;text-decoration:underline;font-weight:400">open daily record</a>)
            </span>
          </div>
          <p style="margin:6px 0 0;color:#466b66;font-size:14px">Hello ${escapeHtml(recipient.name)}, here is the completed daily record.</p>
        </td></tr>
        ${emailSection("Facility Process Record", [
          metric("Received seaweed", `${formatNumber(summary.process_received_kg)} kg`),
          metric("Pressed liquid", `${formatNumber(summary.process_pressed_liquid_l)} L`),
          metric("Lost seaweed", `${formatNumber(summary.process_lost_kg)} kg`),
          metric("Total processing time", formatDuration(summary.process_minutes)),
          metric("Avg Wet Pulp Per Press", `${formatNumber(summary.process_avg_wet_pulp_per_press)} kg`),
          metric("Number of presses", formatInteger(summary.process_press_count)),
          metric("Wet/dry extraction", `${formatNumber(summary.process_wet_dry_percent)} %`),
          metric("Stock L / intake kg", `${formatNumber(summary.stock_l_per_intake_kg, 3)} L/kg`)
        ])}
        ${emailSection("Intake Collection", [
          metric("Total weight", `${formatNumber(summary.intake_weight_kg)} kg`),
          metric("Total paid", `${formatNumber(summary.intake_value_ksh)} KSH`),
          metric("Farmers", formatInteger(summary.farmer_count)),
          metric("Collections", formatInteger(summary.collection_count)),
          metric("Grade A", `${formatNumber(summary.grade_a_kg)} kg`),
          metric("Grade B", `${formatNumber(summary.grade_b_kg)} kg`),
          metric("Grade C", `${formatNumber(summary.grade_c_kg)} kg`),
          metric("Communities", communities, true)
        ])}
        ${emailSection("Stock Record", [
          metric("Total volume", `${formatNumber(summary.stock_volume_l)} L`),
          metric("Containers filled", formatInteger(summary.stock_container_count)),
          ...stockRanges
        ])}
        ${emailSection("Site Water Samples", [
          metric("Status", siteStatus, true)
        ])}
        ${recentRecords}
        <tr><td style="padding:10px 24px 18px">
          <p style="margin:0;color:#6b8581;font-size:12px">Sent automatically at 08:00 East Africa Time.</p>
        </td></tr>
        <tr><td style="padding:14px 24px;background:#f7fbfa;border-top:1px solid #d9ebe7;text-align:center;color:#6b8581;font-size:12px;line-height:1.5">by Cascadia Nature-based Solutions.</td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function emailSection(title: string, metrics: EmailMetric[]) {
  return `<tr><td style="padding:10px 24px 0">${emailMetricTable(title, metrics)}</td></tr>`;
}

function emailMetricTable(title: string, metrics: EmailMetric[], recordUrl = "") {
  const rows: string[] = [];
  let current: EmailMetric[] = [];
  const flush = () => {
    if (!current.length) return;
    const cells = current.map((item) => renderMetric(item, 1));
    while (cells.length < 4) cells.push('<td style="width:25%"></td>');
    rows.push(`<tr>${cells.join("")}</tr>`);
    current = [];
  };
  for (const item of metrics) {
    if (item.full) {
      flush();
      rows.push(`<tr>${renderMetric(item, 4)}</tr>`);
      continue;
    }
    current.push(item);
    if (current.length === 4) flush();
  }
  flush();
  const heading = recordUrl
    ? `<span style="font-size:16px;color:#123d39">${escapeHtml(title)}</span>
       <span style="font-size:12px;font-weight:400;color:#466b66">
         (<a href="${recordUrl}" style="color:#2b7dbc!important;background:transparent;text-decoration:underline;font-weight:400">open daily record</a>)
       </span>`
    : escapeHtml(title);
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"
      style="width:100%;margin:0 0 7px;border:1px solid #c7e2dd;border-radius:6px;overflow:hidden;table-layout:fixed">
      <tr><td colspan="4" style="padding:7px 9px;border-bottom:1px solid #dcece9;font-weight:700;color:#274f49">${heading}</td></tr>
      ${rows.join("")}
    </table>`;
}

function metric(label: string, value: string, full = false): EmailMetric {
  return { label, value, full };
}

function renderMetric(item: EmailMetric, span: number) {
  const width = span * 25;
  return `<td${span > 1 ? ` colspan="${span}"` : ""} style="width:${width}%;padding:6px 9px;border-bottom:1px solid #e2efed;vertical-align:top">
    <div style="font-size:10px;color:#4f7771;font-weight:700;text-transform:uppercase;line-height:1.2">${escapeHtml(item.label)}</div>
    <div style="margin-top:2px;color:#123d39;font-size:14px;font-weight:400;line-height:1.2">${item.value}</div>
  </td>`;
}

function emailText(
  aggregator: any,
  summary: DailySummary,
  recentSummaries: DailySummary[]
) {
  const communities = summary.intake_community_breakdown.length
    ? summary.intake_community_breakdown
      .map((item) => `${formatNumber(item.weight_kg)}kg - ${item.community_name}`).join("; ")
    : "None";
  const site = summary.site_sample_count
    ? `${summary.site_sample_count}; ${summary.site_locations.join(", ") || "location not recorded"}`
    : "No site water sample taken";
  return [
    `Seaweed Harvest - ${aggregator.organisation_name}`,
    `Daily record: ${displayDate(summary.summary_date)}`,
    "",
    "FACILITY PROCESS RECORD",
    `Received seaweed: ${formatNumber(summary.process_received_kg)} kg`,
    `Pressed liquid: ${formatNumber(summary.process_pressed_liquid_l)} L`,
    `Lost seaweed: ${formatNumber(summary.process_lost_kg)} kg`,
    `Total processing time: ${formatDuration(summary.process_minutes)}`,
    `Avg Wet Pulp Per Press: ${formatNumber(summary.process_avg_wet_pulp_per_press)} kg`,
    `Number of presses: ${formatInteger(summary.process_press_count)}`,
    `Wet/dry extraction: ${formatNumber(summary.process_wet_dry_percent)} %`,
    `Stock L / intake kg: ${formatNumber(summary.stock_l_per_intake_kg, 3)} L/kg`,
    "",
    "INTAKE COLLECTION",
    `Total weight: ${formatNumber(summary.intake_weight_kg)} kg`,
    `Total paid: ${formatNumber(summary.intake_value_ksh)} KSH`,
    `Grade A: ${formatNumber(summary.grade_a_kg)} kg`,
    `Grade B: ${formatNumber(summary.grade_b_kg)} kg`,
    `Grade C: ${formatNumber(summary.grade_c_kg)} kg`,
    `Farmers: ${formatInteger(summary.farmer_count)}`,
    `Collections: ${formatInteger(summary.collection_count)}`,
    `Communities: ${communities}`,
    "",
    "STOCK RECORD",
    `Total volume: ${formatNumber(summary.stock_volume_l)} L`,
    `Containers filled: ${formatInteger(summary.stock_container_count)}`,
    ...(summary.stock_volume_l > 0 ? [
      `Sodium benzoate: ${summary.stock_sodium_benzoate_range || "-"}`,
      `Citric acid: ${summary.stock_citric_acid_range || "-"}`,
      `Salinity: ${summary.stock_salinity_range || "-"}`,
      `pH: ${summary.stock_ph_range || "-"}`,
      `EC: ${summary.stock_ec_range || "-"}`
    ] : []),
    "",
    "SITE WATER SAMPLES",
    site,
    ...(recentSummaries.length ? [
      "",
      "RECENT DAILY RECORDS",
      ...recentSummaries.map((recent) =>
        `${displayDate(recent.summary_date)}: intake ${formatNumber(recent.intake_weight_kg)} kg; `
        + `paid ${formatNumber(recent.intake_value_ksh)} KSH; stock ${formatNumber(recent.stock_volume_l)} L; `
        + `processing ${formatDuration(recent.process_minutes)}; collections ${formatInteger(recent.collection_count)}; `
        + `site samples ${formatInteger(recent.site_sample_count)}; communities ${formatInteger(recent.community_count)}; `
        + `open ${APP_SITE_URL}/today.html?records=summary&date=${recent.summary_date}`
      )
    ] : []),
    "",
    `Open daily record: ${APP_SITE_URL}/today.html?records=summary&date=${summary.summary_date}`,
    "",
    "by Cascadia Nature-based Solutions."
  ].join("\n");
}

function groupedRange(
  rows: any[],
  valueKey: string,
  unitKey: string,
  defaultUnit: string,
  include: (row: any) => boolean = () => true
) {
  const groups = new Map<string, number[]>();
  for (const row of rows) {
    if (!include(row) || row[valueKey] === null || row[valueKey] === undefined) continue;
    const unit = String(row[unitKey] || defaultUnit).trim() || defaultUnit;
    const values = groups.get(unit) || [];
    values.push(numberValue(row[valueKey]));
    groups.set(unit, values);
  }
  if (!groups.size) return null;
  return [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([unit, values]) => rangeFromValues(values, unit))
    .join("; ");
}

function simpleRange(rows: any[], valueKey: string, unit = "") {
  const values = rows
    .map((row) => row[valueKey])
    .filter((value) => value !== null && value !== undefined)
    .map(numberValue);
  return values.length ? rangeFromValues(values, unit) : null;
}

function rangeFromValues(values: number[], unit = "") {
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const value = minimum === maximum
    ? formatNumber(minimum, 3)
    : `${formatNumber(minimum, 3)} - ${formatNumber(maximum, 3)}`;
  return unit ? `${value} ${unit}` : value;
}

function nairobiDate(value = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Nairobi",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(value);
  const part = (type: string) => parts.find((item) => item.type === type)?.value || "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function nairobiRange(date: string) {
  const startDate = new Date(`${date}T00:00:00+03:00`);
  return {
    start: startDate.toISOString(),
    end: new Date(startDate.getTime() + 86400000).toISOString()
  };
}

function shiftDate(date: string, days: number) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function displayDate(date: string) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Nairobi",
    day: "2-digit",
    month: "short",
    year: "numeric"
  }).format(new Date(`${date}T12:00:00+03:00`));
}

function timeDifferenceMinutes(start: unknown, end: unknown) {
  const startMinutes = timeMinutes(start);
  const endMinutes = timeMinutes(end);
  if (startMinutes === null || endMinutes === null) return 0;
  return endMinutes - startMinutes;
}

function timeMinutes(value: unknown): number | null {
  const match = String(value || "").match(/^(\d{1,2}):(\d{2})(?::(\d{2}(?:\.\d+)?))?/);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]) + Number(match[3] || 0) / 60;
}

function formatDuration(value: unknown) {
  const minutes = Math.max(0, Math.round(numberValue(value)));
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (hours && remainder) return `${hours} h ${remainder} min`;
  if (hours) return `${hours} h`;
  return `${remainder} min`;
}

function firstValue(...values: unknown[]) {
  return values.find((value) => value !== null && value !== undefined && String(value).trim());
}

function firstNumber(...values: unknown[]) {
  for (const value of values) {
    const number = Number(value);
    if (value !== null && value !== undefined && Number.isFinite(number)) return number;
  }
  return 0;
}

function numberValue(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function rounded(value: unknown, digits = 2) {
  const multiplier = 10 ** digits;
  return Math.round((numberValue(value) + Number.EPSILON) * multiplier) / multiplier;
}

function normalizedText(value: unknown) {
  const text = String(value || "").trim().toLowerCase();
  return text || null;
}

function formatNumber(value: unknown, digits = 2) {
  return numberValue(value).toLocaleString("en-KE", {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits
  });
}

function formatInteger(value: unknown) {
  return numberValue(value).toLocaleString("en-KE", { maximumFractionDigits: 0 });
}

function validDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function validAggregatorCode(value: unknown) {
  const code = String(value || "").trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9_-]{1,19}$/.test(code)) {
    throw new HttpError(400, "Select a valid organisation code");
  }
  return code;
}

function optionalEmail(value: unknown): string | null {
  const email = String(value || "").trim().toLowerCase();
  if (!email) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new HttpError(400, "Enter a valid email address");
  }
  return email;
}

function maskEmail(value: string) {
  const [name, domain] = value.split("@");
  if (!domain) return "***";
  return `${name.slice(0, 2)}***@${domain}`;
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: responseHeaders });
}

class HttpError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}
