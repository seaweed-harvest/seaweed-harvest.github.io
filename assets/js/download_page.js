const releaseManifestUrl = "./downloads/release.json";

function formatFileSize(bytes) {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value <= 0) return "-";
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

async function loadAndroidRelease() {
  const response = await fetch(`${releaseManifestUrl}?t=${Date.now()}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`Release information returned ${response.status}.`);

  const release = await response.json();
  const apk = Array.isArray(release.files)
    ? release.files.find((file) => file?.type === "apk" && file.filename)
    : null;
  if (!apk) throw new Error("The Android release is missing from the release information.");

  const downloadLink = document.querySelector("#androidDownloadLink");
  const version = document.querySelector("#androidReleaseVersion");
  const size = document.querySelector("#androidReleaseSize");
  const checksum = document.querySelector("#androidReleaseChecksum");
  const filename = String(apk.filename);

  downloadLink.href = apk.url || `./downloads/${encodeURIComponent(filename)}`;
  downloadLink.download = filename;
  version.textContent = release.versionName || "-";
  size.textContent = formatFileSize(apk.bytes);
  checksum.textContent = apk.sha256 || "Not supplied";
}

loadAndroidRelease().catch((error) => {
  console.warn("Using the download page's fallback release information.", error);
});
