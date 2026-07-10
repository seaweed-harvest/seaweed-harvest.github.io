import { currentProfile, currentSession, signOut } from "./auth_client.js";

document.addEventListener("DOMContentLoaded", async () => {
  const status = document.getElementById("pendingStatus");
  const session = await currentSession();
  if (!session) {
    window.location.replace("./login.html");
    return;
  }

  try {
    const profile = await currentProfile(true);
    if (profile?.account_status === "active") {
      window.location.replace(profile.app_role === "farmer_viewer" ? "./farmer.html" : "./admin.html");
      return;
    }
    status.textContent = profile?.email || session.user.email || "";
  } catch (error) {
    status.textContent = error.message;
    status.dataset.status = "error";
  }

  document.getElementById("pendingSignOut").addEventListener("click", async () => {
    await signOut();
    window.location.replace("./login.html");
  });
});
