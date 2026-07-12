import { currentProfile, currentSession, routeForProfile, setupAccountControls } from "./auth_client.js";

document.addEventListener("DOMContentLoaded", async () => {
  const status = document.getElementById("pendingStatus");
  const session = await currentSession();
  if (!session) {
    window.location.replace("./login.html");
    return;
  }

  try {
    const profile = await currentProfile(true);
    setupAccountControls(profile, {
      container: document.querySelector(".pending-header-controls"),
      returnPage: "access_pending.html"
    });
    if (profile?.account_status === "active") {
      const destination = routeForProfile(profile);
      if (!destination.includes("access_pending.html")) {
        window.location.replace(destination);
        return;
      }
    }
    status.textContent = profile?.email || session.user.email || "";
  } catch (error) {
    status.textContent = error.message;
    status.dataset.status = "error";
  }
});
