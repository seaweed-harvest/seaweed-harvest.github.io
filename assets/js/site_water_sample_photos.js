import { authClient, requireOrganisationCapability } from "./auth_client.js";
import { uploadRecordPhotos, removeRecordPhotos, validateRecordPhotoFiles, renderPhotoPreviews } from "./stock_photo_upload.js";

const BUCKET = "site-water-sample-photos";
const MAX = 4;
const id = new URLSearchParams(location.search).get("id");
const $ = (id) => document.getElementById(id);
let current = null;
let userId = null;
let uploadId = crypto.randomUUID();

document.addEventListener("DOMContentLoaded", async () => {
  const access = await requireOrganisationCapability(
    "form_site_water_samples", "can_submit_collection", "site_water_sample_photos.html"
  );
  if (!access) return;
  userId = access.session?.user?.id || (await authClient.auth.getUser()).data?.user?.id;
  if (!id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    status("Open an existing sample from its Records link.");
    return;
  }
  $("sitePhotoTake").addEventListener("click", () => $("sitePhotoCamera").click());
  $("sitePhotoChoose").addEventListener("click", () => $("sitePhotoFiles").click());
  for (const input of [$("sitePhotoCamera"),$("sitePhotoFiles")]) {
    input.addEventListener("change", () => {
      try { renderPhotoPreviews($("sitePhotoPreview"), pending()); status(""); }
      catch (error) {
        input.value = "";
        renderPhotoPreviews($("sitePhotoPreview"), pending());
        status(error.message);
      }
    });
  }
  $("sitePhotoAddForm").addEventListener("submit", save);
  await refresh();
});

function pending() {
  const available = MAX - (current?.photo_attachments?.length || 0);
  return validateRecordPhotoFiles(
    [...($("sitePhotoCamera").files || []), ...($("sitePhotoFiles").files || [])],
    available
  );
}
function status(message) { $("sitePhotoStatus").textContent = message; }

async function refresh() {
  status("Loading sample photos...");
  try {
    const { data, error } = await authClient.rpc("ag_get_site_water_sample_photos",{p_record_id:id});
    if (error) throw error;
    current = data;
    $("sitePhotoHeading").textContent = "Site water sample " + data.sample_number;
    const date = new Date(data.sampled_at).toLocaleString("en-GB",{timeZone:"Africa/Nairobi",dateStyle:"medium",timeStyle:"short"});
    $("sitePhotoDetail").textContent = data.community_name + " · " + date;
    const list = $("sitePhotoGallery");
    list.replaceChildren();
    for (const photo of data.photo_attachments || []) {
      const {data: signed,error: signedError} = await authClient.storage
        .from(BUCKET).createSignedUrl(photo.storage_path,3600);
      if (signedError) throw signedError;
      const link = document.createElement("a");
      link.href=signed.signedUrl; link.target="_blank"; link.rel="noopener noreferrer";
      const img=document.createElement("img");
      img.src=signed.signedUrl; img.alt=photo.original_name || "Coastal water sample result";
      link.append(img);list.append(link);
    }
    if (!data.photo_attachments.length) {
      const p=document.createElement("p");
      p.textContent="No photos attached yet. Add E. coli laboratory results whenever they are ready.";
      list.append(p);
    }
    const remaining=MAX-data.photo_attachments.length;
    $("sitePhotoAddForm").hidden=!data.can_add || remaining<=0;
    status(data.photo_attachments.length+" of "+MAX+" photos attached.");
  } catch (error) {status(error.message || "Could not load sample photos.");}
}
async function save(event) {
  event.preventDefault();
  const button=$("sitePhotoSave");
  let uploads=[];
  button.disabled=true;
  try {
    const files=pending();
    if (!files.length) throw new Error("Choose a photo first.");
    status("Uploading photos...");
    uploads=await uploadRecordPhotos(files,uploadId,userId,BUCKET);
    const {error}=await authClient.rpc("ag_add_site_water_sample_photos",{
      p_record_id:id,p_upload_id:uploadId,p_photos:uploads
    });
    if(error)throw error;
    uploads=[];
    uploadId=crypto.randomUUID();
    $("sitePhotoCamera").value=""; $("sitePhotoFiles").value="";
    $("sitePhotoPreview").replaceChildren();
    await refresh();
  } catch (error) {
    await removeRecordPhotos(uploads,BUCKET);
    status(error.message||"Photo could not be attached.");
  } finally {button.disabled=false;}
}