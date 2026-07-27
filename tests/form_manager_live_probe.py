import contextlib
import uuid

from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait

from seaweedke_ui_probe import (
    PROJECT_URL,
    add_cosme_membership,
    api_keys,
    cleanup,
    create_admin,
    request_json,
    start_server,
)


def main():
    keys = api_keys()
    user_id, email, password = create_admin(keys)
    cosme_id = None
    submission_id = str(uuid.uuid4())
    access_token = None
    server = None
    driver = None
    try:
        cosme_id = add_cosme_membership(keys, user_id)
        request_json(
            "PATCH",
            f"{PROJECT_URL}/rest/v1/ag_user_profiles?id=eq.{user_id}",
            keys["service_role"],
            keys["service_role"],
            {
                "active_aggregator_id": cosme_id,
                "can_manage_settings": True,
            },
            "return=minimal",
        )
        current = request_json(
            "GET",
            (
                f"{PROJECT_URL}/rest/v1/ag_form_access_settings"
                f"?select=entry_access&organisation_id=eq.{cosme_id}"
                "&form_key=eq.form_reef_nursery"
            ),
            keys["service_role"],
            keys["service_role"],
        )
        assert current and current[0]["entry_access"] == "private", current

        session = request_json(
            "POST",
            f"{PROJECT_URL}/auth/v1/token?grant_type=password",
            keys["anon"],
            keys["anon"],
            {"email": email, "password": password},
        )
        access_token = session["access_token"]
        manager = request_json(
            "POST",
            f"{PROJECT_URL}/rest/v1/rpc/ag_admin_save_form_access",
            keys["anon"],
            access_token,
            {
                "p_form_key": "form_reef_nursery",
                "p_entry_access": "review",
            },
        )
        form = next(
            row for row in manager["forms"]
            if row["form_key"] == "form_reef_nursery"
        )
        assert form["entry_access"] == "review", form
        assert form["share_link_id"], form

        context = request_json(
            "POST",
            f"{PROJECT_URL}/rest/v1/rpc/ag_public_form_entry_context",
            keys["anon"],
            keys["anon"],
            {
                "p_form_key": "form_reef_nursery",
                "p_organisation_code": "COSME",
                "p_share_token": form["share_link_id"],
            },
        )
        assert context["allowed"] is True, context
        assert context["submission_kind"] == "test", context
        assert context["records_private"] is True, context
        assert len(context["training_matrix"]) == 6, context

        server, base_url = start_server()
        options = webdriver.ChromeOptions()
        options.add_argument("--headless=new")
        options.add_argument("--disable-gpu")
        options.add_argument("--no-sandbox")
        options.add_argument("--window-size=1280,900")
        options.set_capability("goog:loggingPrefs", {"browser": "ALL"})
        driver = webdriver.Chrome(options=options)
        driver.get(
            f"{base_url}/reef_nursery.html"
            f"?org=COSME&share={form['share_link_id']}"
        )
        wait = WebDriverWait(driver, 30)
        wait.until(
            lambda current: current.find_element(
                By.TAG_NAME, "body"
            ).get_attribute("data-auth-pending") is None
        )
        assert driver.find_element(By.ID, "reefReviewNotice").is_displayed()
        assert not driver.find_element(By.ID, "reefNurserySidebar").is_displayed()
        assert not driver.find_element(By.ID, "reefRecordsTab").is_displayed()
        assert not driver.find_element(By.ID, "saveReefNursery").is_displayed()
        wait.until(
            lambda current: current.find_element(
                By.ID, "reefRecordNumber"
            ).get_attribute("textContent").strip() == "Test submission"
        )
        record_number = driver.find_element(
            By.ID, "reefRecordNumber"
        ).get_attribute("textContent").strip()
        assert record_number == "Test submission", record_number
        browser_errors = [
            entry for entry in driver.get_log("browser")
            if entry.get("level") == "SEVERE"
            and "favicon" not in entry.get("message", "").lower()
        ]
        assert not browser_errors, browser_errors

        saved = request_json(
            "POST",
            f"{PROJECT_URL}/rest/v1/rpc/ag_public_shared_form_submission",
            keys["anon"],
            keys["anon"],
            {
                "p_share_token": form["share_link_id"],
                "p_submission_id": submission_id,
                "p_payload": {
                    "form": "reef_nursery",
                    "record": {"session": {"trainer_name": "Live probe"}},
                    "photos": [],
                },
                "p_submitter_name": "Live probe",
                "p_client_key": str(uuid.uuid4()),
                "p_user_agent": "form-manager-live-probe",
            },
        )
        assert saved["ok"] is True, saved
        row = request_json(
            "GET",
            (
                f"{PROJECT_URL}/rest/v1/ag_shared_form_submissions"
                f"?select=id,submission_kind&client_submission_id=eq.{submission_id}"
            ),
            keys["service_role"],
            keys["service_role"],
        )
        assert len(row) == 1 and row[0]["submission_kind"] == "test", row
        print("PASS: revocable Reef review link stores an isolated test submission")
    finally:
        if driver:
            driver.quit()
        if server:
            server.shutdown()
            server.server_close()
        if access_token:
            with contextlib.suppress(Exception):
                request_json(
                    "POST",
                    f"{PROJECT_URL}/rest/v1/rpc/ag_admin_save_form_access",
                    keys["anon"],
                    access_token,
                    {
                        "p_form_key": "form_reef_nursery",
                        "p_entry_access": "private",
                    },
                )
        if cosme_id:
            with contextlib.suppress(Exception):
                request_json(
                    "DELETE",
                    (
                        f"{PROJECT_URL}/rest/v1/ag_shared_form_submissions"
                        f"?client_submission_id=eq.{submission_id}"
                    ),
                    keys["service_role"],
                    keys["service_role"],
                )
        cleanup(keys, user_id)


if __name__ == "__main__":
    main()
