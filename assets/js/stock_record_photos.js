import { authClient, requireOrganisationCapability } from "./auth_client.js";
import {
  STOCK_PHOTO_BUCKET, validateStockPhotoFiles, uploadStockPhotos,
  removeStockPhotos, renderPhotoPreviews, MAX_STOCK_PHOTOS
} from "./stock_photo_upload.js";

const id = new URLSearchParams(location.search).get("id");
const statusEl = document.getElementById("stockPhotoViewStatus");
const gallery = document.getElementById("stockPhotoGallery");
const form = document.getElementById("stockPhotoAddForm");
const input = document.getElementById("additionalStockPhotos");
const camera = document.getElementById("additionalStockCameraPhoto");
const take = document.getElementById("additionalStockTakePhoto");
const choose = document.getElementById("additionalStockChoosePhotos");
const preview = document.getElementById("additionalStockPhotoPreview");
const button = document.getElementById("addStockPhotosButton");
let userId = null, current = null;
let attachmentId = crypto.randomUUID();

document.addEventListener("DOMContentLoaded", async () => {
  const access = await requireOrganisationCapability(
    "form_stock_record", "can_submit_collection", "stock_record_photos.html"
  );
  if (!access) return;
  userId = access.session?.user?.id;
  if (!id || !/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(id)) {
    status("Open a stock photo record using the link from the stock ledger.");
    return;
  }
  take.addEventListener("click", () => camera.click());
  choose.addEventListener("click", () => input.click());
  for (const control of [input, camera]) {
    control.addEventListener("change", () => {
      try {
        renderPhotoPreviews(preview, pendingPhotos());
        status("");
      } catch (error) {
        control.value = "";
        renderPhotoPreviews(preview, pendingPhotos());
        status(error.message);
      }
    });
  }
  form.addEventListener("submit", save);
  await refresh();
});

async function refresh() {
  status("Loading stock photos...");
  try {
    const { data, error } = await authClient.rpc("ag_get_stabilization_stock_photos", { p_record_id: id });
    if (error) throw error;
    current = data;
    document.getElementById("stockPhotoRecordHeading").textContent =
      "Carton " + data.carton_serial;
    document.getElementById("stockPhotoRecordDetail").textContent =
      (data.record_type === "retest" ? "QC retest" : "New carton") + " · " +
      data.packed_on + " · " + data.recorded_by_name;
    gallery.replaceChildren();
    for (const photo of data.photo_attachments || []) {
      const { data: urlData, error: urlError } = await authClient.storage
        .from(STOCK_PHOTO_BUCKET).createSignedUrl(photo.storage_path, 3600);
      if (urlError) throw urlError;
      const a = document.createElement("a");
      a.href = urlData.signedUrl; a.target = "_blank"; a.rel = "noopener noreferrer";
      const img = document.createElement("img");
      img.src = urlData.signedUrl; img.alt = photo.original_name || "Stock photo";
      a.append(img); gallery.append(a);
    }
    if (!data.photo_attachments?.length) {
      const p = document.createElement("p");
      p.textContent = "No photos attached to this record yet.";
      gallery.append(p);
    }
    const available = MAX_STOCK_PHOTOS - data.photo_attachments.length;
    form.hidden = !data.can_add || available <= 0;
    status(data.photo_attachments.length + " of " + MAX_STOCK_PHOTOS + " stock photos attached.");
  } catch (error) {
    status(error.message || "Could not load photos.");
  }
}

function pendingPhotos() {
  return validateStockPhotoFiles(
    [...(input.files || []), ...(camera.files || [])],
    MAX_STOCK_PHOTOS - current.photo_attachments.length
  );
}

async function save(event) {
  event.preventDefault();
  let uploads = [];
  button.disabled = true;
  try {
    const available = MAX_STOCK_PHOTOS - current.photo_attachments.length;
    const files = pendingPhotos();
    if (!files.length) throw new Error("Choose a photo first.");
    status("Uploading photos...");
    uploads = await uploadStockPhotos(files, attachmentId, userId);
    const { error } = await authClient.rpc("ag_add_stabilization_stock_photos", {
      p_record_id: id, p_submission_id: attachmentId, p_photos: uploads
    });
    if (error) throw error;
    uploads = []; // From this point the committed record owns the stored objects.
    attachmentId = crypto.randomUUID();
    input.value = ""; camera.value = ""; preview.replaceChildren();
    await refresh();
  } catch (error) {
    await removeStockPhotos(uploads);
    status(error.message || "Could not attach photos.");
  } finally {
    button.disabled = false;
  }
}
function status(message) { statusEl.textContent = message; }
