import { authClient, requireOrganisationCapability } from "./auth_client.js";

const id = new URLSearchParams(location.search).get("id");
const statusEl = document.getElementById("processPhotoViewStatus");
const gallery = document.getElementById("processPhotoGallery");

document.addEventListener("DOMContentLoaded", async () => {
  const access = await requireOrganisationCapability(
    "form_process_record", "can_submit_collection", "process_record_photos.html"
  );
  if (!access) return;
  if (!id || !/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(id)) {
    statusEl.textContent = "Open a process record from the record ledger.";
    return;
  }
  try {
    statusEl.textContent = "Loading photos...";
    const { data, error } = await authClient.rpc("ag_get_process_record_photos", { p_record_id: id });
    if (error) throw error;
    document.getElementById("processPhotoRecordHeading").textContent =
      "Process PR-" + String(data.record_number || "").padStart(5, "0");
    document.getElementById("processPhotoRecordDetail").textContent = data.process_date || "";
    document.getElementById("processPhotoRecordCount").textContent =
      String(data.photo_count || 0) + " of 6 photos";
    gallery.replaceChildren();
    for (const photo of (data.photo_attachments || [])) {
      const { data: signed, error: signingError } = await authClient.storage
        .from("process-record-photos").createSignedUrl(photo.storage_path, 3600);
      if (signingError) throw signingError;
      const link = document.createElement("a");
      link.href = signed.signedUrl;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      const img = document.createElement("img");
      img.src = signed.signedUrl;
      img.alt = photo.original_name || "Process photo";
      link.append(img);
      gallery.append(link);
    }
    statusEl.textContent = "";
  } catch (error) {
    statusEl.textContent = error.message || "Could not load process photos.";
    statusEl.dataset.status = "error";
  }
});
