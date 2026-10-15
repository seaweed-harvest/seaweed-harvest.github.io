// One or more photos may be attached to each monitoring stage/visit, not to
// each individual rope. Files are staged locally until the Sample Rope Save.
export const PHOTO_STAGES = Object.freeze(["initial","week_2","week_4","week_6"]);
const PHOTO_BUCKET = "reef-seaweed-record-photos";
const MAX_SOURCE_BYTES = 25 * 1024 * 1024;
const escapeHtml = v => String(v ?? "").replace(/[&<>"']/g,c=>({
  "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
})[c]);

export function createSampleStagePhotoController({authClient,root,preparePhoto,onChange}) {
  const pending = new Map(PHOTO_STAGES.map(stage=>[stage,[]]));
  const get = stage => pending.get(stage) || [];
  const count = () => [...pending.values()].reduce((sum,files)=>sum+files.length,0);
  const emit = () => onChange?.(count());
  const render = stage => {
    const panel = root.querySelector(`[data-stage-photo-list="${stage}"]`);
    if (!panel) return;
    const files = get(stage);
    panel.innerHTML = files.length ? files.map(({id,file}) =>
      `<div class="reef-stage-photo-item">
        <span title="${escapeHtml(file.name)}">${escapeHtml(file.name)}</span>
        <button type="button" data-stage-remove="${stage}" data-photo-id="${id}" aria-label="Remove queued photo">×</button>
      </div>`).join("") : '<small>No photos queued</small>';
  };
  const queueFiles = (stage, inputFiles) => {
    if (!pending.has(stage)) return;
    const list = get(stage);
    for (const file of [...(inputFiles || [])]) {
      if (!String(file.type || "").startsWith("image/")) throw new Error("Select image files only.");
      if (file.size > MAX_SOURCE_BYTES) throw new Error("Photos must be smaller than 25 MB.");
      if (list.length >= 8) throw new Error("Choose up to 8 photos per stage per save.");
      list.push({id:crypto.randomUUID(),file});
    }
    render(stage);
    emit();
  };
  root.addEventListener("change", event=>{
    const input = event.target.closest("[data-stage-photo-file]");
    if (!input) return;
    const stage = input.dataset.stagePhotoFile;
    try { queueFiles(stage,input.files); }
    catch (error) { onChange?.(count(),error.message); }
    input.value = "";
  });
  root.addEventListener("click", event=>{
    const button = event.target.closest("[data-stage-remove]");
    if (!button) return;
    const stage = button.dataset.stageRemove;
    const files = get(stage);
    pending.set(stage,files.filter(item=>item.id!==button.dataset.photoId));
    render(stage);
    emit();
  });
  const upload = async ({siteCode,dates}) => {
    if (!count()) return 0;
    // Validate all stage dates before uploading any photo.
    for (const stage of PHOTO_STAGES) {
      if (get(stage).length && !dates?.[stage]) {
        throw new Error(`Enter the ${stage === "initial" ? "Initial" : stage.replace("_"," ")} date above its weights before uploading photos.`);
      }
    }
    let saved=0;
    for(const stage of PHOTO_STAGES) {
      for (const item of [...get(stage)]) {
        // Limit photo size using the existing proven JPEG compressor.
        const blob = await preparePhoto(item.file);
        if (blob.size < 1 || blob.size > 1048576) throw new Error("Photo compression must produce a JPEG below 1 MB.");
        const {data:reserved,error:reserveError}=await authClient.rpc("ag_reef_sample_rope_stage_photo_reserve",{
          p_site_code:siteCode,p_stage:stage,p_capture_date:dates[stage],p_original_name:item.file.name||"photo.jpg"
        });
        if(reserveError) throw reserveError;
        const {error:uploadError}=await authClient.storage.from(PHOTO_BUCKET).upload(reserved.storage_path,blob,{
          cacheControl:"3600",contentType:"image/jpeg",upsert:false
        });
        if(uploadError) throw uploadError;
        const {error:finalizeError}=await authClient.rpc("ag_reef_sample_rope_stage_photo_finalize",{
          p_photo_id:reserved.photo_id,p_byte_size:blob.size
        });
        if(finalizeError) throw finalizeError;
        pending.set(stage,get(stage).filter(file=>file.id!==item.id));
        render(stage);
        emit();
        saved++;
      }
    }
    return saved;
  };
  for(const stage of PHOTO_STAGES) render(stage);
  return {queueFiles,pending,count,upload};
}
