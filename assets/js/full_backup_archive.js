import {
  downloadArchiveBlob,
  hashBlob,
  MANIFEST_NAME,
  missingDatabasePhotos,
  photoKey,
  readManifest,
  rememberPhoto,
  saveVerified,
  verifyFile,
  writeManifest,
} from "./archive_files.mjs";
import { LEDGER_LABELS, recordedPhotoCounts, lastCompletedBackup } from "./backup_summary.mjs";

const PHOTO_DOWNLOAD_CONCURRENCY = 8;
const PHOTO_IN_FLIGHT_BYTES = 32 * 1024 * 1024;

export function mountFullBackupArchive({ client, profile }) {
  if (
    profile?.account_status !== "active" || profile.is_protected_owner !== true
  ) return;
  const host = document.getElementById("fullBackupArchive");
  if (!host) return;
  host.hidden = false;
  document.getElementById("legacyBackup").open = false;
  const q = (id) => host.querySelector(`#${id}`);
  const state = {
    root: null,
    manifest: null,
    inventory: null,
    rows: [],
    busy: false,
    backupRunning: false,
    stopRequested: false,
    selectedPhotos: new Set(),
    results: new Map(),
    scopeKey: undefined,
  };
  const ref = new URL(client.supabaseUrl).hostname.split(".")[0];
  const say = (text, error = false) => {
    q("archiveStatus").textContent = text;
    q("archiveStatus").dataset.status = error ? "error" : "";
  };
  const sourceName = (bucket) => ({ "collection-photos":"Collections", "process-record-photos":"Process records",
    "reef-nursery-photos":"Reef nursery", "reef-seaweed-record-photos":"Reef monitoring",
    "green-space-photos":"Green spaces", "seaweed-drying-photos":"Drying trials",
    "site-feedback-photos":"Site feedback" })[bucket] ?? bucket;
  const bytes = (n) =>
    new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(
      Number(n) / 1e6,
    ) + " MB";
  const api = async (body, extra = {}) => {
    const { data, error } = await client.functions.invoke("backup-archive", {
      body,
      ...extra,
    });
    if (error || data?.error) {
      let message = data?.error || error?.message;
      try {
        message = (await error.context.json()).error || message;
      } catch {}
      const status = Number(error?.context?.status || error?.status || 0);
      if (status === 401) throw new Error("Your session has expired. Sign in again, then retry the backup.");
      if (!status && /fetch|network|load failed|send.*request/i.test(message || "")) {
        throw new Error("Cannot reach the backup service. Check your internet connection, then use Refresh inventory / retry.");
      }
      throw new Error(message || "Archive service unavailable");
    }
    return data;
  };
  const folder = () => {
    if (!state.root) throw new Error("Choose your archive folder first");
  };
  const run = (fn) => async () => {
    if (state.busy) return;
    state.busy = true;
    host.setAttribute("aria-busy", "true");
    host.querySelectorAll("button,input,select").forEach((e) =>
      e.disabled = true
    );
    try {
      await fn();
    } catch (e) {
      say(e.message, true);
    } finally {
      state.busy = false;
      host.removeAttribute("aria-busy");
      host.querySelectorAll("button,input,select").forEach((e) =>
        e.disabled = false
      );
      setReadiness();
    }
  };
  function setReadiness() {
    const noFolder = state.busy || !window.showDirectoryPicker || !state.root;
    for (
      const id of [
        "archiveSave",
        "archiveVerify",
        "archiveRestore",
        "archiveRepairPreview",
      ]
    ) q(id).disabled = noFolder;
    const scope = organisationIds();
    q("archiveSave").disabled = noFolder || (scope !== null && !scope.length) || state.scopeKey !== JSON.stringify(scope);
    q("archivePhotoOptions").hidden = !q("archiveIncludePhotos").checked;
    q("archiveCleanup").disabled = noFolder ||
      !state.inventory?.cleanup_enabled;
    q("archiveDatabase").disabled = state.busy ||
      !state.inventory?.database_runner_enabled;
    q("archiveFolder").disabled = state.busy || !window.showDirectoryPicker;
    q("archiveStop").disabled = !state.backupRunning || state.stopRequested;
    q("archiveStop").hidden = !state.backupRunning;
    q("archiveRunningHint").hidden = !state.backupRunning;
    if (!window.showDirectoryPicker) {
      q("archiveFolderLabel").textContent =
        "Local archive verification requires desktop Chrome or Edge with folder access.";
    }
  }
  const organisationIds = () => q("archiveAllOrganisations").checked ? null
    : [...host.querySelectorAll("input[data-organisation-id]:checked")].map((e) => e.dataset.organisationId);
  const matching = () =>
    state.rows.filter((row) =>
      (!q("archiveBucket").value ||
        row.bucket_id === q("archiveBucket").value) &&
      (!q("archiveBefore").value ||
        String(row.created_at ?? "").slice(0, 10) <= q("archiveBefore").value)
    );
  const selected = () => matching().filter((r) => state.selectedPhotos.has(photoKey(r)));
  function syncSelectAll() {
    const rows = matching(), count = selected().length;
    q("archiveSelectionCount").textContent = `${count} of ${rows.length} matching photos selected`;
    q("archiveSelectAll").checked = rows.length > 0 && count === rows.length;
    q("archiveSelectAll").indeterminate = count > 0 && count < rows.length;
  }
  function renderPhotoRows() {
    const tbody = q("archiveRows");
    tbody.replaceChildren();
    if (!q("archivePhotoDetails").open || !q("archiveIncludePhotos").checked) return;
    const rows = matching();
    const savedFiles = new Map((state.manifest?.files ?? []).map(f => [photoKey(f), f]));
    for (const row of rows) {
      const tr = document.createElement("tr"),
        pick = document.createElement("input");
      pick.type = "checkbox";
      pick.dataset.archiveKey = photoKey(row);
      pick.checked = state.selectedPhotos.has(photoKey(row));
      pick.addEventListener("change", () => {
        if (pick.checked) state.selectedPhotos.add(photoKey(row));
        else state.selectedPhotos.delete(photoKey(row));
        syncSelectAll();
        renderSummary();
      });
      pick.setAttribute("aria-label", `Select ${row.object_path}`);
      const first = document.createElement("td");
      first.append(pick);
      tr.append(first);
      const saved = savedFiles.get(photoKey(row));
      for (
        const text of [
          sourceName(row.bucket_id),
          row.object_path.split("/").at(-1),
          bytes(row.byte_size),
          row.archive?.cloud_state === "archived"
            ? "Original archived"
            : row.archive?.cloud_state === "deleting"
            ? "Cleanup pending"
            : "Original in cloud",
          state.results.get(photoKey(row)) ?? (saved ? "Saved; will verify before skipping" : "Not yet saved"),
        ]
      ) {
        const td = document.createElement("td");
        td.textContent = text;
        tr.append(td);
      }
      tr.children[2].title = row.object_path;
      if (row.archive?.cloud_state !== "archived") {
        const preview = document.createElement("button");
        preview.type = "button"; preview.textContent = "View photo";
        preview.addEventListener("click",run(async () => {
          const result = await api({ action: "prepare", object_id: row.object_id });
          q("archivePreviewImage").src = result.signed_url;
          q("archivePhotoPreview").showModal();
        }));
        tr.children[2].append(" ",preview);
      }
      tbody.append(tr);
    }
  }
  function tableRow(values, header = false) {
    const row = document.createElement("tr");
    for (const text of values) {
      const cell = document.createElement(header ? "th" : "td");
      if (header) cell.scope = "col";
      cell.textContent = String(text);
      row.append(cell);
    }
    return row;
  }
  function renderSummary() {
    const scope = organisationIds(), summary = state.inventory?.summary;
    const valid = state.scopeKey === JSON.stringify(scope);
    const rows = q("archiveSummaryRows"), head = q("archiveSummaryHead"), details = q("archiveLedgerBreakdown");
    rows.replaceChildren(); head.replaceChildren(); details.replaceChildren();
    const single = scope?.length === 1;
    q("archiveLedgerDetails").hidden = single || !valid || !summary;
    q("archiveSummaryTable").hidden = !valid || !summary;
    q("archiveSummaryTotals").textContent = !valid ? "Select organisations and refresh the summary."
      : summary ? `${Number(summary.record_count || 0).toLocaleString()} ${summary.overlapping_records ? "unique " : ""}ledger records` : "Records ready. Summary unavailable.";
    if (valid && summary) {
      head.append(tableRow(single ? ["Ledger", "Records"] : ["Organisation", "Records", "Photos"], true));
      if (single) {
        for (const l of summary.ledgers ?? []) if (Number(l.record_count)) rows.append(tableRow([LEDGER_LABELS[l.table] ?? l.table, Number(l.record_count).toLocaleString()]));
      } else {
        if (summary.overlapping_records) {
          const note = document.createElement("p");
          note.textContent = "Some ledger entries are linked to more than one organisation. The total counts each entry once.";
          details.append(note);
        }
        const organisations = [...(summary.organisations ?? [])];
        if (summary.shared && (summary.shared.record_count || summary.shared.photo_count)) organisations.push(summary.shared);
        for (const org of organisations) {
          rows.append(tableRow([org.name, Number(org.record_count || 0).toLocaleString(), Number(org.photo_count || 0).toLocaleString()]));
          const section = document.createElement("section"), name = document.createElement("strong"), list = document.createElement("table");
          name.textContent = org.name; section.append(name);
          for (const l of org.ledgers ?? []) if (Number(l.record_count)) list.append(tableRow([LEDGER_LABELS[l.table] ?? l.table, Number(l.record_count).toLocaleString()]));
          section.append(list); details.append(section);
        }
      }
    }
    const photos = selected(), available = state.rows.length;
    const coverage = recordedPhotoCounts(photos, state.manifest);
    const include = q("archiveIncludePhotos").checked;
    q("archivePhotoSummary").textContent = !valid ? "" : include
      ? `${photos.length.toLocaleString()} photos${photos.length !== available ? ` selected of ${available.toLocaleString()}` : ""} · ${bytes(photos.reduce((n,r) => n + Number(r.byte_size),0))}` +
        (state.manifest ? ` · ${coverage.newOrChanged.toLocaleString()} new or changed · ${coverage.recorded.toLocaleString()} already recorded` : "")
      : `${available.toLocaleString()} photos available`;
    const previous = lastCompletedBackup(state.manifest, scope);
    q("archiveHistory").textContent = !state.manifest ? "Choose an archive folder to see its last completed backup."
      : !previous ? "No completed backup for this selection in this folder."
      : `Last completed in this folder: ${new Date(previous.completed_at || previous.captured_at).toLocaleString()} · ${previous.organisation_ids == null ? "All organisations" : `${previous.organisation_ids.length} organisation${previous.organisation_ids.length === 1 ? "" : "s"}`} · ${previous.photos_requested ? `records and photos (${previous.expected_photo_versions?.length ?? 0})` : "records only"}`;
  }
  function render() {
    renderSummary();
    renderPhotoRows();
    const rows = matching();
    q("archiveTotals").textContent = `${rows.length} matching photos - ${bytes(rows.reduce((n,r) => n + Number(r.byte_size),0))}`;
    if (state.inventory?.missing_photo_references) q("archiveTotals").append(
      ` ${state.inventory.missing_photo_references} linked photo references are missing or ambiguous in cloud storage.`);
    syncSelectAll();
    const jobs = q("archiveDatabaseJobs");
    jobs.replaceChildren();
    for (const job of state.inventory?.database_jobs ?? []) {
      const line = document.createElement("p");
      line.textContent = `${job.created_at} · Database backup ${job.status}`;
      if (job.status === "verified") {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = "Save database backup to selected folder";
        button.addEventListener("click", run(() => saveDatabase(job)));
        line.append(" ", button);
      }
      if (job.status === "failed") {
        line.append(" · " + (job.error_message || "Operator review required"));
      }
      jobs.append(line);
    }
    q("archiveReadiness").textContent = state.inventory?.database_runner_enabled
      ? "Database runner enabled. A backup is usable only after the job succeeds and its files are saved and verified locally."
      : "Full database backups need the one-time runner setup. Photo archiving and operational snapshots are separate; they do not preserve Auth password hashes or complete database recovery.";
    if (!state.inventory?.cleanup_enabled) {
      q("archiveReadiness").append(
        " Cloud cleanup remains disabled until exact-version deletion is validated on this deployment.",
      );
    }
    setReadiness();
  }
  async function refresh() {
    say("Reading the current archive inventory…");
    const scope = organisationIds();
    if (scope !== null && !scope.length) {
      state.scopeKey = undefined; state.rows = []; render(); say("Choose at least one organisation or All organisations."); return;
    }
    state.scopeKey = undefined;
    state.rows = []; state.selectedPhotos.clear();
    renderSummary();
    q("archiveRows").replaceChildren();
    state.inventory = await api({ action: "inventory", organisation_ids: scope });
    state.scopeKey = JSON.stringify(scope);
    const choices = q("archiveOrganisations");
    choices.replaceChildren();
    for (const org of state.inventory.organisations ?? []) {
      const label = document.createElement("label"), input = document.createElement("input");
      input.type = "checkbox"; input.dataset.organisationId = org.id;
      input.checked = scope?.includes(org.id) ?? false;
      input.addEventListener("change", () => {
        q("archiveAllOrganisations").checked = false;
        void run(refresh)();
      });
      label.append(input, " ", org.name || org.code); choices.append(label);
    }
    state.rows = state.inventory.objects ?? [];
    state.selectedPhotos = new Set(state.rows.map(photoKey));
    state.results.clear();
    const previous = q("archiveBucket").value;
    q("archiveBucket").replaceChildren(
      new Option("All photo sources", ""),
    );
    for (
      const bucket of [...new Set(state.rows.map((r) => r.bucket_id))].sort()
    ) q("archiveBucket").append(new Option(sourceName(bucket), bucket));
    q("archiveBucket").value = previous;
    render();
    say("Ready.");
  }
  async function prepared(row) {
    if (row.archive) return row.archive;
    const response = await api({ action: "prepare", object_id: row.object_id });
    row.archive = response.archive;
    return response.archive;
  }
  async function receipt(a) {
    await api({
      action: "verify_local",
      archive_id: a.id,
      copy_id: state.manifest.copy_id,
      folder_label: state.root.name,
      sha256: a.sha256,
      byte_size: Number(a.byte_size),
    });
  }
  async function verifyRow(row) {
    folder();
    const a = await prepared(row);
    const file = await verifyFile(
      state.root,
      a.relative_path,
      a.sha256,
      a.byte_size,
    );
    rememberPhoto(state.manifest, row, a);
    await writeManifest(state.root, state.manifest);
    await receipt(a);
    return { a, file };
  }
  async function archiveSelected(rows) {
    const counts = { saved: 0, reused: 0, skipped: 0, failed: 0 };
    let next = 0, completed = 0, inFlightBytes = 0;
    const byteWaiters = new Set();
    const releaseBytes = (size) => {
      inFlightBytes -= size;
      for (const resolve of byteWaiters) resolve();
      byteWaiters.clear();
    };
    async function reserveBytes(size) {
      while (inFlightBytes + size > PHOTO_IN_FLIGHT_BYTES) {
        await new Promise(resolve => byteWaiters.add(resolve));
      }
      inFlightBytes += size;
    }
    let manifestQueue = Promise.resolve(), pendingChanges = 0;
    const pathLocks = new Map();
    // Each local file is still read back and hashed. Checkpoint the manifest in
    // small batches so reuse checks don't wait for a disk commit per photo.
    const flushManifest = (force = false) => {
      const task = manifestQueue.then(async () => {
        if (!force && !pendingChanges) return;
        pendingChanges = 0;
        await writeManifest(state.root, state.manifest);
      });
      manifestQueue = task.catch(() => {});
      return task;
    };
    const commitManifest = (change) => {
      change(); pendingChanges++;
      return pendingChanges >= 16 ? flushManifest() : Promise.resolve();
    };
    const progress = () => {
      q("archiveProgress").value = completed;
      say(`${state.stopRequested ? "Stopping after active files. " : ""}Checking / saving photos: ${completed} / ${rows.length} · ${counts.reused} reused · ${counts.saved} added · ${counts.skipped} skipped · ${counts.failed} failed`);
    };
    async function savePhoto(row) {
      const key = photoKey(row);
      let unlock, path, lock;
      try {
        // The first preparation already returns a signed URL. Reuse it for this
        // transfer; never cache signed URLs across backup runs.
        const initial = row.archive ? null : await api({ action: "prepare", object_id: row.object_id });
        const a = row.archive ?? initial.archive;
        if (a.object_version !== row.object_version || Number(a.byte_size) !== Number(row.byte_size)) {
          throw new Error("Cloud photo changed; refresh and retry");
        }
        row.archive = a;
        path = a.relative_path;
        const previous = pathLocks.get(path) ?? Promise.resolve();
        lock = new Promise(resolve => { unlock = resolve; });
        pathLocks.set(path, lock);
        // Identical content can share an archive path. Never open two writers
        // for that path; the next photo will verify and reuse the first copy.
        await previous;
        let exists = false, reuse = false;
        try {
          await verifyFile(state.root, a.relative_path, a.sha256, a.byte_size);
          reuse = true;
        } catch (error) {
          if (error.name !== "NotFoundError" && !error.message.startsWith("Local file failed")) throw error;
          exists = error.name !== "NotFoundError";
        }
        if (exists && !q("archiveReplaceExisting").checked) {
          counts.skipped++; state.results.set(key, "Skipped: existing copy differs");
          await commitManifest(() => {
            state.manifest.files = state.manifest.files.filter((f) => photoKey(f) !== key);
          });
          return;
        }
        if (!reuse) {
          if (a.cloud_state === "archived") throw new Error("Original is no longer in cloud storage");
          const result = initial ?? await api({ action: "prepare", object_id: row.object_id });
          if (result.archive.sha256 !== a.sha256 || result.archive.object_version !== a.object_version) {
            throw new Error("Cloud photo changed; refresh and retry");
          }
          const response = await fetch(result.signed_url, { cache: "no-store" });
          await saveVerified(state.root,a.relative_path,await downloadArchiveBlob(response),a.sha256,a.byte_size);
        }
        await commitManifest(() => rememberPhoto(state.manifest,row,a));
        // The read-back checksum and durable local manifest prove this backup.
        // Fresh server receipts are issued by verifyRow immediately before
        // cleanup/restore; sending one per normal download adds a round trip
        // without replacing that required fresh verification.
        counts[reuse ? "reused" : "saved"]++;
        state.results.set(key,reuse ? "Already verified; skipped download" : "Saved and verified");
      } catch {
        counts.failed++; state.results.set(key,"Failed; select and retry");
      } finally {
        unlock?.();
        if (pathLocks.get(path) === lock) pathLocks.delete(path);
        completed++;
        progress();
      }
    }
    progress();
    await Promise.all(Array.from({ length: Math.min(PHOTO_DOWNLOAD_CONCURRENCY, rows.length) }, async () => {
      while (!state.stopRequested && next < rows.length) {
        const row = rows[next++];
        const size = Math.min(PHOTO_IN_FLIGHT_BYTES, Math.max(1, Number(row.byte_size) || PHOTO_IN_FLIGHT_BYTES));
        await reserveBytes(size);
        if (state.stopRequested) { releaseBytes(size); return; }
        try { await savePhoto(row); } finally { releaseBytes(size); }
      }
    }));
    await flushManifest(true);
    counts.pending = rows.length - completed;
    return counts;
  }
  async function backUp() {
    folder();
    const scope = organisationIds();
    if (scope !== null && !scope.length) throw new Error("Choose at least one organisation");
    state.backupRunning = true;
    state.stopRequested = false;
    q("archiveStop").disabled = false;
    q("archiveStop").hidden = false;
    q("archiveRunningHint").hidden = false;
    q("archiveSave").textContent = "Back up";
    try {
    const photos = q("archiveIncludePhotos").checked ? selected() : [];
    q("archiveProgress").hidden = false;
    q("archiveProgress").max = Math.max(1,photos.length);
    q("archiveProgress").value = 0;
    const snapshot = await saveSnapshot(scope,photos,q("archiveIncludePhotos").checked);
    const counts = await archiveSelected(photos);
    snapshot.photo_results = counts;
    snapshot.status = counts.pending ? "stopped" : counts.failed || counts.skipped || (snapshot.photos_requested && snapshot.missing_linked_photo_references) ? "incomplete" : "complete";
    snapshot.finished_at = new Date().toISOString();
    if (snapshot.status === "complete") snapshot.completed_at = snapshot.finished_at;
    await writeManifest(state.root,state.manifest);
    render();
    q("archiveProgress").value = counts.pending ? Math.max(0, photos.length - counts.pending) : q("archiveProgress").max;
    if (counts.pending) {
      q("archiveSave").textContent = "Resume backup";
      say(`Stopped safely. Records saved; ${counts.saved} photos saved, ${counts.reused} reused, ${counts.failed} failed, ${counts.skipped} skipped, ${counts.pending} not started. Resume with the same folder; verified photos will be reused.`);
      return;
    }
    say((snapshot.photos_requested
      ? `Records saved and verified. Photos: ${counts.saved} saved, ${counts.reused} already verified, ${counts.skipped} skipped, ${counts.failed} failed.`
      : "Records saved and verified. Photos were not included.") +
      (counts.skipped || counts.failed ? " Re-select those photos and retry; replacement requires the checkbox." : "") +
      (snapshot.photos_requested && snapshot.missing_linked_photo_references ? ` ${snapshot.missing_linked_photo_references} linked photo references are unavailable.` : ""),
      counts.skipped + counts.failed > 0 || (snapshot.photos_requested && snapshot.missing_linked_photo_references > 0));
    } finally {
      state.backupRunning = false;
      q("archiveStop").disabled = true;
      q("archiveStop").hidden = true;
      q("archiveRunningHint").hidden = true;
    }
  }
  async function cleanup() {
    folder();
    const rows = selected();
    if (!rows.length) throw new Error("Select the originals to review");
    if (rows.length > 100) {
      throw new Error(
        "Review up to 100 cloud originals at a time so verification receipts remain fresh",
      );
    }
    const plans = [];
    for (const row of rows) {
      say(`Checking local original: ${row.object_path}`);
      const { a } = await verifyRow(row);
      plans.push({
        row,
        a,
        plan: await api({
          action: "preview_cleanup",
          archive_id: a.id,
          copy_id: state.manifest.copy_id,
        }),
      });
    }
    const total = plans.reduce((n, p) => n + Number(p.plan.bytes), 0);
    const answer = window.prompt(
      `Clear ${plans.length} cloud originals (up to ${
        bytes(total)
      }, less retained previews)?\n\nLocal copies were read and verified in ${state.root.name}. Records and small image previews remain. Keep this archive folder safe.\n\nType DELETE VERIFIED ORIGINALS to continue.`,
    );
    if (answer !== "DELETE VERIFIED ORIGINALS") {
      say("Cleanup cancelled. Cloud originals were not changed.");
      return;
    }
    for (const { row, a, plan } of plans) {
      const file = await verifyFile(
        state.root,
        a.relative_path,
        a.sha256,
        a.byte_size,
      );
      const preview = a.content_type.startsWith("image/")
        ? await makePreview(file)
        : null;
      say(`Clearing verified cloud version: ${row.object_path}`);
      const result = await api({
        action: "delete_original",
        archive_id: a.id,
        copy_id: state.manifest.copy_id,
        token: plan.token,
        confirmation: answer,
        preview_jpeg: preview,
      });
      if (result.warning) throw new Error(result.warning);
    }
    await refresh();
    say(
      `Archived ${plans.length} cloud originals. Local files and record references remain; small image previews are retained.`,
    );
  }
  async function saveDatabase(job) {
    folder();
    const result = await api({ action: "download_database", job_id: job.id });
    const files = [];
    for (const part of result.parts) {
      const path = `database/${job.id}/${part.file_name}`;
      try {
        await verifyFile(state.root, path, part.sha256, part.bytes);
      } catch {
        const response = await fetch(part.signed_url, { cache: "no-store" });
        if (!response.ok) throw new Error("Database archive download failed");
        await saveVerified(
          state.root,
          path,
          await downloadArchiveBlob(response),
          part.sha256,
          part.bytes,
        );
      }
      const { signed_url: _, storage_path: __, ...metadata } = part;
      files.push({ ...metadata, relative_path: path });
    }
    const backup = {
      job_id: job.id,
      manifest: result.manifest,
      files,
      verified_at: new Date().toISOString(),
    };
    state.manifest.database_backups = (state.manifest.database_backups ?? [])
      .filter((j) => j.job_id !== job.id);
    state.manifest.database_backups.push(backup);
    await writeManifest(state.root, state.manifest);
    const missing = missingDatabasePhotos(
      state.manifest,
      result.manifest.photo_inventory ?? [],
    );
    say(
      `Database archive saved and verified. ${missing.length} photo versions from that database snapshot still need local archiving. Run the offline verifier before treating the combined package as complete.`,
    );
  }
  q("archiveFolder").addEventListener(
    "click",
    run(async () => {
      if (!window.showDirectoryPicker) {
        throw new Error(
          "Choose an archive folder using desktop Chrome or Edge",
        );
      }
      state.root = await window.showDirectoryPicker({
        id: "seaweed-archive",
        mode: "readwrite",
      });
      state.manifest = await readManifest(state.root, ref);
      state.manifest.snapshots ??= [];
      await writeManifest(state.root, state.manifest);
      q("archiveFolderLabel").textContent =
        `Selected folder: ${state.root.name}`;
      render();
      say("Ready.");
    }),
  );
  q("archiveClosePreview").addEventListener("click", () => {
    q("archivePhotoPreview").close();
  });
  q("archivePhotoPreview").addEventListener("close", () => q("archivePreviewImage").removeAttribute("src"));
  q("archiveRefresh").addEventListener("click", run(refresh));
  q("archiveSave").addEventListener("click", run(backUp));
  q("archiveStop").addEventListener("click", () => {
    if (!state.backupRunning) return;
    state.stopRequested = true;
    q("archiveStop").disabled = true;
    say("Stopping safely: finishing active files and saving progress. Keep this page open until stopped.");
  });
  window.addEventListener("beforeunload", event => {
    if (!state.backupRunning) return;
    event.preventDefault();
    event.returnValue = "";
  });
  q("archiveVerify").addEventListener(
    "click",
    run(async () => {
      const rows = selected();
      if (!rows.length) throw new Error("Select files to verify");
      for (const row of rows) await verifyRow(row);
      render();
      say(`${rows.length} local originals read and verified.`);
    }),
  );
  q("archiveCleanup").addEventListener("click", run(cleanup));
  q("archiveRestore").addEventListener(
    "click",
    run(async () => {
      const rows = selected();
      if (!rows.length) throw new Error("Select archived originals to restore");
      if (
        !window.confirm(
          `Restore ${rows.length} verified originals to Supabase? This will use cloud storage again.`,
        )
      ) return;
      for (const row of rows) {
        const { a, file } = await verifyRow(row);
        say(`Restoring ${row.object_path}`);
        await api(file, {
          headers: {
            "x-archive-id": a.id,
            "x-archive-action": "restore",
            "Content-Type": "application/octet-stream",
          },
        });
      }
      await refresh();
      say("Selected originals restored and verified in Supabase.");
    }),
  );
  q("archiveRepairPreview").addEventListener(
    "click",
    run(async () => {
      const rows = selected();
      if (!rows.length) {
        throw new Error("Select archived originals with missing previews");
      }
      for (const row of rows) {
        const { a, file } = await verifyRow(row);
        await api({
          action: "repair_preview",
          archive_id: a.id,
          copy_id: state.manifest.copy_id,
          preview_jpeg: await makePreview(file),
        });
      }
      await refresh();
      say("Missing previews repaired; local originals retained.");
    }),
  );
  async function saveSnapshot(scope,photos,photosRequested) {
      folder();
      say("Saving selected application records...");
      const snapshot = await api({ action: "export_data", organisation_ids: scope });
      const captured = new Map((snapshot.photo_inventory ?? []).map((p) => [photoKey(p),p]));
      for (const row of photos) {
        const expected = captured.get(photoKey(row));
        if (!expected || expected.bucket_id !== row.bucket_id || expected.object_path !== row.object_path || Number(expected.byte_size) !== Number(row.byte_size)) {
          throw new Error("Photos changed since the inventory loaded. Refresh inventory, review your selection and retry.");
        }
      }
      const blob = new Blob([JSON.stringify(snapshot)], {
          type: "application/json",
        }),
        hash = await hashBlob(blob);
      const path = `snapshots/${
        new Date().toISOString().replaceAll(":", "-")
      }-${crypto.randomUUID()}.json`;
      await saveVerified(state.root, path, blob, hash, blob.size);
      const entry = {
        relative_path: path,
        sha256: hash,
        byte_size: blob.size,
        captured_at: snapshot.captured_at,
        status: "running",
        ledger_record_count: state.inventory?.summary?.record_count ?? null,
        database_recovery_complete: false,
        organisation_ids: scope,
        photos_requested: photosRequested,
        expected_photo_versions: photos.map((r) => captured.get(photoKey(r))),
        missing_linked_photo_references: snapshot.missing_photo_references ?? 0,
      };
      state.manifest.snapshots.push(entry);
      await writeManifest(state.root, state.manifest);
      return entry;
  }
  q("archiveDatabase").addEventListener(
    "click",
    run(async () => {
      await api({ action: "request_database" });
      await refresh();
      say(
        "Database backup queued for the configured runner. Refresh to see progress.",
      );
    }),
  );
  q("archiveBucket").addEventListener("change", render);
  q("archiveBefore").addEventListener("change", render);
  q("archiveSelectAll").addEventListener("change", () => {
    for (const row of matching()) {
      if (q("archiveSelectAll").checked) state.selectedPhotos.add(photoKey(row));
      else state.selectedPhotos.delete(photoKey(row));
    }
    render();
  });
  q("archiveAllOrganisations").addEventListener("change", run(refresh));
  q("archiveIncludePhotos").addEventListener("change",render);
  q("archivePhotoDetails").addEventListener("toggle",renderPhotoRows);
  if (!window.showDirectoryPicker) {
    say(
      "Local read-back verification requires a folder-capable desktop browser such as Chrome or Edge.",
      true,
    );
  }
  return run(refresh)();
}

async function makePreview(file) {
  const image = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  const scale = Math.min(1, 320 / image.width, 320 / image.height);
  canvas.width = Math.max(1, Math.round(image.width * scale));
  canvas.height = Math.max(24, Math.round(image.height * scale));
  const ctx = canvas.getContext("2d");
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  image.close();
  ctx.fillStyle = "rgba(0,0,0,0.7)";
  ctx.fillRect(0, canvas.height - 22, canvas.width, 22);
  ctx.fillStyle = "#fff";
  ctx.font = "12px sans-serif";
  ctx.fillText("Original archived", 5, canvas.height - 7);
  for (const quality of [.6, .35, .15]) {
    const blob = await new Promise((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", quality)
    );
    if (blob && blob.size <= 32768) {
      const b = new Uint8Array(await blob.arrayBuffer());
      return btoa(String.fromCharCode(...b));
    }
  }
  throw new Error(
    "Could not create a small preview. Cloud original was retained.",
  );
}

