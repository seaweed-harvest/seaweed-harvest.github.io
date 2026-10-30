export const MANIFEST_NAME = "seaweed-archive.json";
export async function downloadArchiveBlob(response, limit = 32 * 1024 * 1024) {
  if (!response.ok) throw new Error("Archive download failed");
  if (Number(response.headers.get("content-length") ?? 0) > limit) {
    throw new Error("Archive download exceeds its size limit");
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Archive download body is unavailable");
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > limit) {
      await reader.cancel();
      throw new Error("Archive download exceeds its size limit");
    }
    chunks.push(value);
  }
  return new Blob(chunks, {
    type: response.headers.get("content-type") ?? "application/octet-stream",
  });
}
export function segments(path) {
  if (typeof path !== "string" || !path || /[\\\x00-\x1f]/.test(path)) {
    throw new Error("Unsafe archive path");
  }
  const parts = path.split("/");
  if (parts.some((p) => !p || p === "." || p === "..")) {
    throw new Error("Unsafe archive path");
  }
  return parts;
}
export async function fileHandle(root, path, create = false) {
  const parts = segments(path);
  let dir = root;
  for (const part of parts.slice(0, -1)) {
    dir = await dir.getDirectoryHandle(part, { create });
  }
  return await dir.getFileHandle(parts.at(-1), { create });
}
export async function hashBlob(blob) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    await blob.arrayBuffer(),
  );
  return [...new Uint8Array(digest)].map((x) => x.toString(16).padStart(2, "0"))
    .join("");
}
export async function verifyFile(root, path, expectedHash, expectedSize) {
  const file = await (await fileHandle(root, path)).getFile();
  if (
    file.size !== Number(expectedSize) || await hashBlob(file) !== expectedHash
  ) throw new Error(`Local file failed verification: ${path}`);
  return file;
}
export async function saveVerified(root, path, blob, hash, size) {
  if (blob.size !== Number(size) || await hashBlob(blob) !== hash) {
    throw new Error("Downloaded file failed verification");
  }
  const writer = await (await fileHandle(root, path, true)).createWritable();
  try {
    await writer.write(blob);
    await writer.close();
  } catch (e) {
    await writer.abort().catch(() => {});
    throw e;
  }
  return await verifyFile(root, path, hash, size);
}
export async function readManifest(root, projectRef) {
  try {
    const m = JSON.parse(
      await (await (await fileHandle(root, MANIFEST_NAME)).getFile()).text(),
    );
    if (
      m.format_version !== 1 || m.project_ref !== projectRef || !m.copy_id ||
      !Array.isArray(m.files)
    ) throw new Error("This folder has an incompatible archive manifest");
    return m;
  } catch (e) {
    if (e.name !== "NotFoundError") throw e;
    return {
      format_version: 1,
      project_ref: projectRef,
      copy_id: crypto.randomUUID(),
      files: [],
      database_backups: [],
      snapshots: [],
    };
  }
}
export async function writeManifest(root, manifest) {
  const text = JSON.stringify(
    { ...manifest, updated_at: new Date().toISOString() },
    null,
    2,
  ) + "\n";
  const writer = await (await fileHandle(root, MANIFEST_NAME, true))
    .createWritable();
  try {
    await writer.write(text);
    await writer.close();
  } catch (e) {
    await writer.abort().catch(() => {});
    throw e;
  }
}
export function photoKey(row) {
  return `${row.object_id}:${row.object_version}`;
}
export function rememberPhoto(manifest, row, a) {
  const entry = {
    object_id: row.object_id,
    object_version: row.object_version,
    bucket_id: row.bucket_id,
    object_path: row.object_path,
    archive_id: a.id,
    relative_path: a.relative_path,
    sha256: a.sha256,
    byte_size: Number(a.byte_size),
    verified_at: new Date().toISOString(),
  };
  manifest.files = manifest.files.filter((f) =>
    photoKey(f) !== photoKey(entry)
  );
  manifest.files.push(entry);
  return entry;
}
export function missingDatabasePhotos(manifest, inventory) {
  const saved = new Map(manifest.files.map((f) => [photoKey(f), f]));
  return inventory.filter((row) => {
    const f = saved.get(photoKey(row));
    return !f || Number(f.byte_size) !== Number(row.byte_size) ||
      (row.sha256 && f.sha256 !== row.sha256);
  });
}
