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

export function mountFullBackupArchive({ client, profile }) {
  if (
    profile?.account_status !== "active" || profile.is_protected_owner !== true
  ) return;
  const host = document.getElementById("fullBackupArchive");
  if (!host) return;
  host.hidden = false;
  const q = (id) => host.querySelector(`#${id}`);
  const state = {
    root: null,
    manifest: null,
    inventory: null,
    rows: [],
    busy: false,
  };
  const ref = new URL(client.supabaseUrl).hostname.split(".")[0];
  const say = (text, error = false) => {
    q("archiveStatus").textContent = text;
    q("archiveStatus").dataset.status = error ? "error" : "";
  };
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
        "archiveSnapshot",
      ]
    ) q(id).disabled = noFolder;
    q("archiveCleanup").disabled = noFolder ||
      !state.inventory?.cleanup_enabled;
    q("archiveDatabase").disabled = state.busy ||
      !state.inventory?.database_runner_enabled;
    q("archiveFolder").disabled = state.busy || !window.showDirectoryPicker;
    if (!window.showDirectoryPicker) {
      q("archiveFolderLabel").textContent =
        "Local archive verification requires desktop Chrome or Edge with folder access.";
    }
  }
  const matching = () =>
    state.rows.filter((row) =>
      (!q("archiveBucket").value ||
        row.bucket_id === q("archiveBucket").value) &&
      (!q("archiveBefore").value ||
        String(row.created_at ?? "").slice(0, 10) <= q("archiveBefore").value)
    );
  const selected = () => {
    const keys = new Set(
      [...host.querySelectorAll("input[data-archive-key]:checked")].map((e) =>
        e.dataset.archiveKey
      ),
    );
    return matching().filter((r) => keys.has(photoKey(r)));
  };
  function render() {
    const tbody = q("archiveRows");
    tbody.replaceChildren();
    const rows = matching();
    for (const row of rows) {
      const tr = document.createElement("tr"),
        pick = document.createElement("input");
      pick.type = "checkbox";
      pick.dataset.archiveKey = photoKey(row);
      pick.setAttribute("aria-label", `Select ${row.object_path}`);
      const first = document.createElement("td");
      first.append(pick);
      tr.append(first);
      const saved = state.manifest?.files.find((f) =>
        photoKey(f) === photoKey(row)
      );
      for (
        const text of [
          row.bucket_id,
          row.object_path,
          bytes(row.byte_size),
          row.archive?.cloud_state === "archived"
            ? "Original archived"
            : row.archive?.cloud_state === "deleting"
            ? "Cleanup pending"
            : "Original in cloud",
          saved
            ? "In selected archive; verify before clearing"
            : "Not verified in selected archive",
        ]
      ) {
        const td = document.createElement("td");
        td.textContent = text;
        tr.append(td);
      }
      tbody.append(tr);
    }
    q("archiveTotals").textContent = `${rows.length} matching originals · ${
      bytes(rows.reduce((n, r) => n + Number(r.byte_size), 0))
    }. Current cloud files and previews: ${
      bytes(state.inventory?.cloud_file_bytes ?? 0)
    }. Small previews are retained after image cleanup.`;
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
    state.inventory = await api({ action: "inventory" });
    state.rows = state.inventory.objects ?? [];
    const previous = q("archiveBucket").value;
    q("archiveBucket").replaceChildren(
      new Option("All photo/file buckets", ""),
    );
    for (
      const bucket of [...new Set(state.rows.map((r) => r.bucket_id))].sort()
    ) q("archiveBucket").append(new Option(bucket, bucket));
    q("archiveBucket").value = previous;
    render();
    say("Inventory loaded. No files have been deleted.");
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
  async function archiveMatching() {
    folder();
    const rows = matching();
    let done = 0;
    for (const row of rows) {
      say(`Archiving ${++done}/${rows.length}: ${row.object_path}`);
      const a = await prepared(row);
      let file;
      try {
        file = await verifyFile(
          state.root,
          a.relative_path,
          a.sha256,
          a.byte_size,
        );
      } catch (e) {
        if (
          e.name !== "NotFoundError" &&
          !e.message.startsWith("Local file failed")
        ) throw e;
        if (a.cloud_state === "archived") {
          throw new Error(
            `Local original missing or damaged: ${row.object_path}. It cannot be downloaded from its cloud preview.`,
          );
        }
        const result = await api({
          action: "prepare",
          object_id: row.object_id,
        });
        const response = await fetch(result.signed_url, { cache: "no-store" });
        if (!response.ok) throw new Error("Original download failed");
        file = await saveVerified(
          state.root,
          a.relative_path,
          await downloadArchiveBlob(response),
          a.sha256,
          a.byte_size,
        );
      }
      rememberPhoto(state.manifest, row, a);
      await writeManifest(state.root, state.manifest);
      await receipt(a);
    }
    render();
    say(
      `Saved and read-back verified ${rows.length} originals in ${state.root.name}. Existing matching files were reused; cloud originals remain unchanged.`,
    );
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
      await writeManifest(state.root, state.manifest);
      q("archiveFolderLabel").textContent =
        `Selected folder: ${state.root.name}`;
      render();
      say(
        "Archive folder selected. Existing originals will be checked and reused.",
      );
    }),
  );
  q("archiveRefresh").addEventListener("click", run(refresh));
  q("archiveSave").addEventListener("click", run(archiveMatching));
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
  q("archiveSnapshot").addEventListener(
    "click",
    run(async () => {
      folder();
      say("Capturing all organisations’ application records…");
      const snapshot = await api({ action: "export_data" });
      const blob = new Blob([JSON.stringify(snapshot)], {
          type: "application/json",
        }),
        hash = await hashBlob(blob);
      const path = `snapshots/${
        new Date().toISOString().replaceAll(":", "-")
      }.json`;
      await saveVerified(state.root, path, blob, hash, blob.size);
      state.manifest.snapshots.push({
        relative_path: path,
        sha256: hash,
        byte_size: blob.size,
        captured_at: snapshot.captured_at,
        database_recovery_complete: false,
      });
      await writeManifest(state.root, state.manifest);
      say(
        "Operational snapshot saved and verified. Full database recovery still requires a verified database dump.",
      );
    }),
  );
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
  q("archiveSelectAll").addEventListener(
    "change",
    () =>
      host.querySelectorAll("input[data-archive-key]").forEach((e) =>
        e.checked = q("archiveSelectAll").checked
      ),
  );
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
