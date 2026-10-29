import { currentProfile, currentSession, routeForProfile, setupAccountControls } from "./auth_client.js?v=18";

document.addEventListener("DOMContentLoaded", async () => {
  const status = document.getElementById("pendingStatus");
  const showStatus = (message, failed = false) => {
    if (failed) document.querySelector(".auth-panel h2").textContent = "Access check failed";
    status.textContent = message;
    if (failed) status.dataset.status = "error";
    document.body.removeAttribute("data-auth-pending");
  };
  try {
    const session = await currentSession();
    if (!session) {
      window.location.replace("./login.html");
      return;
    }
    const profile = await currentProfile(true);
    if (profile) setupAccountControls(profile, {
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
    if (profile?.account_status === "active") {
      document.querySelector(".auth-panel h2").textContent = "Application access";
      document.querySelector(".auth-panel > p").textContent =
        "This account does not have Seaweed Harvest access. Check the organisation and application selected.";
    }
    showStatus(profile?.email || session.user.email || "");
  } catch (error) {
    showStatus(error.message, true);
  }
});
