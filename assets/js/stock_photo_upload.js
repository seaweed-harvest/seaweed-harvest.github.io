// Reuses the existing collection/process JPEG compression and private Supabase Storage pattern.
import { authClient } from "./auth_client.js";

export const STOCK_PHOTO_BUCKET = "stock-record-photos";
export const MAX_STOCK_PHOTOS = 2;
const MAX_BYTES = 700 * 1024;
const TARGET_BYTES = 550 * 1024;
const MAX_EDGE = 1920;

export function validateStockPhotoFiles(fileList, available = MAX_STOCK_PHOTOS) {
  const files = Array.from(fileList || []);
  if (files.length > available) throw new Error("Add at most " + available + " photo(s).");
  if (files.some(f => !f.type.startsWith("image/"))) throw new Error("Choose image files only.");
  return files;
}

export async function uploadStockPhotos(files, submissionId, userId) {
  if (!files.length) return [];
  if (!userId) throw new Error("Sign in before uploading stock photos.");
  const uploaded = [];
  try {
    for (const file of files) {
      const blob = await compressStockPhoto(file);
      const path = userId + "/" + submissionId + "/" + crypto.randomUUID() + ".jpg";
      const { error } = await authClient.storage.from(STOCK_PHOTO_BUCKET).upload(
        path, blob, { contentType: "image/jpeg", cacheControl: "3600", upsert: false }
      );
      if (error) throw error;
      uploaded.push({ storage_path: path, original_name: file.name.slice(0, 255),
        byte_size: blob.size, content_type: "image/jpeg" });
    }
    return uploaded;
  } catch (error) {
    await removeStockPhotos(uploaded);
    throw error;
  }
}

export async function removeStockPhotos(photos) {
  const paths = photos.map(photo => photo.storage_path).filter(Boolean);
  if (paths.length) await authClient.storage.from(STOCK_PHOTO_BUCKET).remove(paths);
}

async function compressStockPhoto(file) {
  const source = await loadImage(file);
  const ratio = Math.min(1, MAX_EDGE / Math.max(source.width, source.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(source.width * ratio));
  canvas.height = Math.max(1, Math.round(source.height * ratio));
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) { source.close(); throw new Error("Cannot process photo."); }
  context.fillStyle = "#fff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(source.image, 0, 0, canvas.width, canvas.height);
  source.close();
  let low = 0.4, high = 0.92, best = null, smallest = null;
  for (let n = 0; n < 8; n++) {
    const blob = await new Promise((resolve, reject) =>
      canvas.toBlob(b => b ? resolve(b) : reject(new Error("Photo compression failed.")), "image/jpeg", (low + high) / 2));
    if (!smallest || blob.size < smallest.size) smallest = blob;
    if (blob.size <= TARGET_BYTES) { best = blob; low = (low + high) / 2; }
    else high = (low + high) / 2;
  }
  const result = best || smallest;
  if (!result || result.size > MAX_BYTES) throw new Error("Photo exceeds 700 KB after compression.");
  return result;
}

async function loadImage(file) {
  if ("createImageBitmap" in window) {
    const img = await createImageBitmap(file);
    return { image: img, width: img.width, height: img.height, close: () => img.close?.() };
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return { image: img, width: img.naturalWidth, height: img.naturalHeight,
      close: () => URL.revokeObjectURL(url) };
  } catch (error) { URL.revokeObjectURL(url); throw error; }
}

export function renderPhotoPreviews(container, files) {
  container.replaceChildren();
  for (const file of files) {
    const img = document.createElement("img");
    const url = URL.createObjectURL(file);
    img.alt = file.name;
    img.src = url;
    img.addEventListener("load", () => URL.revokeObjectURL(url), { once: true });
    img.className = "stock-photo-thumbnail";
    container.append(img);
  }
}
