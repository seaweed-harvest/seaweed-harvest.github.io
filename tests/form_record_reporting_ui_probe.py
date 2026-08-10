import json
import pathlib
import tempfile

from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.common.exceptions import TimeoutException
from selenium.webdriver.support.ui import Select, WebDriverWait

from seaweedke_ui_probe import api_keys, cleanup, create_admin, start_server


def main():
    keys = api_keys()
    user_id, email, password = create_admin(keys, aggregator_code="MAWIMBI")
    server, base_url = start_server()
    driver = None
    screenshots = []
    try:
        options = webdriver.ChromeOptions()
        options.add_argument("--headless=new")
        options.add_argument("--disable-gpu")
        options.add_argument("--no-sandbox")
        options.add_argument("--window-size=1440,1000")
        options.set_capability("goog:loggingPrefs", {"browser": "ALL"})
        driver = webdriver.Chrome(options=options)
        wait = WebDriverWait(driver, 30)

        driver.get(f"{base_url}/login.html")
        wait.until(lambda current: current.find_element(By.ID, "loginEmail").is_displayed())
        driver.find_element(By.ID, "loginEmail").send_keys(email)
        driver.find_element(By.ID, "loginPassword").send_keys(password)
        driver.find_element(By.CSS_SELECTOR, "#loginForm button[type='submit']").click()
        wait.until(lambda current: "home.html" in current.current_url)

        driver.get(f"{base_url}/records.html")
        wait.until(lambda current: current.find_element(
            By.ID, "operationalSummaryWorkspace"
        ).is_displayed())
        wait.until(lambda current: current.execute_script(
            "return document.body.dataset.recordPeriod || '';"
        ) == "monthly")
        period_buttons = driver.find_elements(By.CSS_SELECTOR, "#recordPeriodTabs [data-record-period]")
        assert [button.get_attribute("textContent").strip() for button in period_buttons] == [
            "Interval Totals",
            "Today's Record",
            "Community Records",
            "Container Lookup",
            "All Records",
        ]
        period_state = driver.find_element(
            By.CSS_SELECTOR, '#recordPeriodTabs [data-record-period="monthly"]'
        ).get_attribute("aria-selected")
        assert period_state == "true", period_state

        driver.find_element(
            By.CSS_SELECTOR, '#recordPeriodTabs [data-record-period="today"]'
        ).click()
        wait.until(lambda current: current.find_element(
            By.ID, "recordTodayWorkspace"
        ).is_displayed())
        wait.until(lambda current: current.find_element(
            By.ID, "todaySummaryPanel"
        ).is_displayed())
        assert driver.find_element(By.ID, "todayIntakeDate").is_displayed()
        assert driver.find_element(
            By.CSS_SELECTOR, '[data-today-record-tab="summary"]'
        ).get_attribute("aria-selected") == "true"

        driver.find_element(
            By.CSS_SELECTOR, '[data-today-record-tab="stock-record"]'
        ).click()
        wait.until(lambda current: current.find_element(
            By.ID, "recordContainerLookupTab"
        ).is_displayed())
        assert not driver.find_element(By.ID, "recordCommunityTab").is_displayed()
        assert driver.find_element(
            By.CSS_SELECTOR, '[data-today-record-tab="stock-record"]'
        ).get_attribute("aria-selected") == "true"

        driver.find_element(
            By.CSS_SELECTOR, '[data-today-record-tab="summary"]'
        ).click()
        wait.until(lambda current: not current.find_element(
            By.ID, "recordContainerLookupTab"
        ).is_displayed())
        assert driver.find_element(By.ID, "recordCommunityTab").is_displayed()

        wait.until(lambda current: len(current.find_elements(
            By.CSS_SELECTOR, ".operational-summary-metric-link"
        )) == 1)
        selected_day = driver.find_element(By.ID, "todayIntakeDate").get_attribute("value")
        qc_link = driver.find_element(
            By.CSS_SELECTOR, ".operational-summary-metric-link"
        ).get_attribute("href")
        assert "container_lookup.html" in qc_link, qc_link
        assert f"from={selected_day}" in qc_link, qc_link
        assert f"to={selected_day}" in qc_link, qc_link
        today_navigation = driver.find_element(
            By.XPATH,
            '//*[@id="recordsSidebar"]//a[normalize-space()="Today\'s Intake"]',
        )
        ledger_navigation = driver.find_element(
            By.XPATH,
            '//*[@id="recordsSidebar"]//a[normalize-space()="Record Ledgers"]',
        )
        assert "records.html?view=today&category=intake" in today_navigation.get_attribute("href")
        assert today_navigation.get_attribute("aria-current") is None
        assert ledger_navigation.get_attribute("aria-current") == "page"

        daily_desktop = pathlib.Path(tempfile.gettempdir()) / "record-ledgers-today-desktop.png"
        driver.save_screenshot(str(daily_desktop))
        screenshots.append(daily_desktop)

        driver.find_element(By.CSS_SELECTOR, '#recordPeriodTabs [data-record-period="monthly"]').click()
        wait.until(lambda current: current.find_element(
            By.ID, "operationalSummaryWorkspace"
        ).is_displayed())
        assert not driver.find_element(By.ID, "recordTodayWorkspace").is_displayed()
        assert driver.find_element(
            By.CSS_SELECTOR, '[data-ledger-category="summary"]'
        ).get_attribute("aria-selected") == "true"
        wait.until(lambda current: current.find_element(
            By.ID, "loadOperationalSummary"
        ).is_enabled())
        wait.until(lambda current: current.find_element(
            By.ID, "operationalSummaryCount"
        ).text != "Loading")
        assert driver.find_element(By.ID, "operationalSummaryStatus").text == ""
        wait.until(lambda current: current.find_element(
            By.ID, "operationalSummaryTitle"
        ).text == "Interval totals")
        assert Select(driver.find_element(By.ID, "operationalSummaryGrouping")).first_selected_option.text == "Day"
        assert len(driver.find_elements(
            By.CSS_SELECTOR, "#operationalSummaryCalendar .collection-calendar-month"
        )) == 4
        monthly_head = [
            cell.get_attribute("textContent").strip()
            for cell in driver.find_elements(
                By.CSS_SELECTOR, "#operationalSummaryHead th"
            )
        ]
        assert monthly_head == [
            "Day", "Collected kg", "Total paid KSH", "A kg", "B kg", "C kg",
            "Collections", "Farmers", "Communities", "Site samples", "Stock L",
            "Containers", "Received kg", "Lost kg", "Process time", "Presses",
            "Avg wet pulp/press kg", "Avg stock L / intake kg",
        ], monthly_head
        Select(driver.find_element(By.ID, "operationalSummaryGrouping")).select_by_value("week")
        wait.until(lambda current: current.find_element(
            By.CSS_SELECTOR, "#operationalSummaryHead th"
        ).get_attribute("textContent").strip() == "Week starting")
        wait.until(lambda current: "grouping=week" in current.current_url)
        weekly_summary_head = [
            cell.get_attribute("textContent").strip()
            for cell in driver.find_elements(By.CSS_SELECTOR, "#operationalSummaryHead th")
        ]
        assert weekly_summary_head[1] == "Active days", weekly_summary_head
        weekly_summary_label = driver.find_element(
            By.CSS_SELECTOR, "#operationalSummaryRows tr td"
        ).text
        assert not weekly_summary_label.startswith("Week starting"), weekly_summary_label

        driver.find_element(
            By.CSS_SELECTOR, '#recordPeriodTabs [data-record-period="community"]'
        ).click()
        wait.until(lambda current: current.find_element(
            By.ID, "operationalSummaryTitle"
        ).text == "Community summary")
        wait.until(lambda current: current.find_element(
            By.CSS_SELECTOR, "#operationalSummaryHead th"
        ).get_attribute("textContent").strip() == "Community")
        community_head = [
            cell.get_attribute("textContent").strip()
            for cell in driver.find_elements(
                By.CSS_SELECTOR, "#operationalSummaryHead th"
            )
        ]
        assert community_head == [
            "Community", "Collected kg", "Total paid KSH", "A kg", "B kg", "C kg",
            "Collections", "Farmers", "Site samples", "Temp C", "Salinity",
            "TDS mg/L", "EC mS/cm",
        ], community_head
        wait.until(lambda current: current.find_element(
            By.ID, "loadOperationalSummary"
        ).is_enabled())
        wait.until(lambda current: current.find_element(
            By.ID, "operationalSummaryCount"
        ).text != "Loading")
        assert driver.find_element(By.ID, "operationalSummaryStatus").text == ""
        assert "communit" in driver.find_element(
            By.ID, "operationalSummaryCount"
        ).text.lower()
        assert "Stock L" not in community_head
        assert "Process time" not in community_head

        driver.find_element(
            By.CSS_SELECTOR, '#recordPeriodTabs [data-record-period="monthly"]'
        ).click()
        wait.until(lambda current: current.find_element(
            By.ID, "operationalSummaryTitle"
        ).text == "Interval totals")
        wait.until(lambda current: current.find_element(
            By.ID, "operationalSummaryCount"
        ).text != "Loading")
        wait.until(lambda current: current.find_element(
            By.ID, "loadOperationalSummary"
        ).is_enabled())

        driver.find_element(By.CSS_SELECTOR, '[data-ledger-category="process"]').click()
        try:
            wait.until(lambda current: len(current.find_elements(
                By.CSS_SELECTOR, "#formLedgerCalendar .collection-calendar-month"
            )) == 4)
        except TimeoutException as error:
            raise AssertionError({
                "route": driver.current_url,
                "status": driver.find_element(By.ID, "formLedgerStatus").text,
                "calendar_status": driver.find_element(By.ID, "formLedgerCalendarStatus").text,
                "console": driver.get_log("browser"),
            }) from error
        assert Select(driver.find_element(By.ID, "formLedgerGrouping")).first_selected_option.text == "Day"
        Select(driver.find_element(By.ID, "formLedgerGrouping")).select_by_value("month")
        wait.until(lambda current: current.find_element(
            By.CSS_SELECTOR, "#formLedgerMonthlyHead th"
        ).get_attribute("textContent").strip() == "Month")
        wait.until(lambda current: "grouping=month" in current.current_url)
        process_month_head = [
            cell.get_attribute("textContent").strip()
            for cell in driver.find_elements(By.CSS_SELECTOR, "#formLedgerMonthlyHead th")
        ]
        assert process_month_head[1] == "Active days", process_month_head
        assert "First date" not in process_month_head, process_month_head
        assert "Last date" not in process_month_head, process_month_head
        heading_layout = driver.execute_script(
            """
            const heading = document.querySelector(".form-ledger-heading").getBoundingClientRect();
            const tabs = document.getElementById("formLedgerCategories").getBoundingClientRect();
            return {
              headingTop: Math.round(heading.top),
              tabsTop: Math.round(tabs.top),
              tabsRight: Math.round(tabs.right),
              panelRight: Math.round(document.querySelector(".form-ledger-panel").getBoundingClientRect().right)
            };
            """
        )
        assert abs(heading_layout["tabsRight"] - heading_layout["panelRight"]) <= 24, heading_layout

        driver.find_element(By.CSS_SELECTOR, '[data-ledger-category="intake"]').click()
        wait.until(lambda current: current.find_element(
            By.ID, "collectionLedgerWorkspace"
        ).is_displayed())
        assert "records.html" in driver.current_url
        assert "category=intake" in driver.current_url
        assert not driver.find_element(By.ID, "formLedgerWorkspace").is_displayed()
        assert Select(driver.find_element(By.ID, "monthlyGrouping")).first_selected_option.text == "Day"
        wait.until(lambda current: current.find_element(
            By.ID, "monthlyCount"
        ).text != "Loading")
        assert driver.find_element(By.ID, "monthlyCount").text != "0 rows"
        assert len(driver.find_elements(By.CSS_SELECTOR, "#monthlyRows tr")) > 0
        intake_day_head = [
            cell.get_attribute("textContent").strip()
            for cell in driver.find_elements(By.CSS_SELECTOR, "#ledgerMonthlyView thead th")
            if cell.is_displayed()
        ]
        for removed_heading in ("Active days", "Avg kg", "First date", "Last date"):
            assert removed_heading not in intake_day_head, intake_day_head
        intake_desktop = pathlib.Path(tempfile.gettempdir()) / "record-ledgers-intake-desktop.png"
        driver.save_screenshot(str(intake_desktop))
        screenshots.append(intake_desktop)

        Select(driver.find_element(By.ID, "monthlyGrouping")).select_by_value("week")
        wait.until(lambda current: current.find_element(
            By.ID, "monthlyActiveDaysHeading"
        ).is_displayed())
        wait.until(lambda current: "grouping=week" in current.current_url)
        intake_week_label = driver.find_element(By.CSS_SELECTOR, "#monthlyRows tr td").text
        assert not intake_week_label.startswith("Week starting"), intake_week_label
        intake_week = pathlib.Path(tempfile.gettempdir()) / "record-ledgers-intake-week-desktop.png"
        driver.save_screenshot(str(intake_week))
        screenshots.append(intake_week)

        driver.find_element(By.CSS_SELECTOR, '[data-ledger-category="stock"]').click()
        wait.until(lambda current: current.find_element(
            By.ID, "formLedgerWorkspace"
        ).is_displayed())
        wait.until(lambda current: "Stock records" in current.find_element(
            By.ID, "formLedgerMonthlyTitle"
        ).text)
        wait.until(lambda current: len(current.find_elements(
            By.CSS_SELECTOR, "#formLedgerMonthlyMetrics .form-ledger-metric"
        )) == 6)
        wait.until(lambda current: current.find_element(
            By.ID, "loadFormLedgerMonthly"
        ).is_enabled())
        assert driver.find_element(By.ID, "formLedgerStatus").text == ""
        assert driver.find_element(By.ID, "recordContainerLookupTab").is_displayed()
        assert not driver.find_element(By.ID, "recordCommunityTab").is_displayed()
        driver.find_element(By.ID, "recordContainerLookupTab").click()
        wait.until(lambda current: current.find_element(
            By.ID, "containerLookupWorkspace"
        ).is_displayed())
        assert "records.html" in driver.current_url
        assert "view=container" in driver.current_url
        assert driver.find_element(By.ID, "formLedgerCategories").is_displayed()
        assert driver.find_element(
            By.CSS_SELECTOR, '[data-ledger-category="stock"]'
        ).get_attribute("aria-selected") == "true"
        visible_stock_periods = [
            button.text for button in driver.find_elements(
                By.CSS_SELECTOR, "#recordPeriodTabs [data-record-period]"
            ) if button.is_displayed()
        ]
        assert visible_stock_periods == [
            "Interval Totals", "Today's Record", "Container Lookup", "All Records"
        ], visible_stock_periods
        driver.find_element(
            By.CSS_SELECTOR, '#recordPeriodTabs [data-record-period="monthly"]'
        ).click()
        wait.until(lambda current: current.find_element(
            By.ID, "formLedgerMonthlyPanel"
        ).is_displayed())
        wait.until(lambda current: current.find_element(
            By.ID, "loadFormLedgerMonthly"
        ).is_enabled())

        driver.find_element(By.CSS_SELECTOR, '[data-ledger-category="site_sample"]').click()
        wait.until(lambda current: current.find_element(
            By.ID, "loadFormLedgerMonthly"
        ).is_enabled())
        assert driver.find_element(
            By.CSS_SELECTOR, '#recordPeriodTabs [data-record-period="community"]'
        ).is_displayed()
        driver.find_element(By.CSS_SELECTOR, '#recordPeriodTabs [data-record-period="community"]').click()
        wait.until(lambda current: current.find_element(
            By.ID, "formLedgerCommunityPanel"
        ).is_displayed())
        wait.until(lambda current: len(current.find_elements(
            By.CSS_SELECTOR, "#formLedgerCommunityMetrics .form-ledger-metric"
        )) == 6)
        wait.until(lambda current: current.find_element(
            By.ID, "loadFormLedgerCommunity"
        ).is_enabled())
        assert driver.find_element(By.ID, "formLedgerStatus").text == ""

        desktop = pathlib.Path(tempfile.gettempdir()) / "form-record-reporting-desktop.png"
        driver.save_screenshot(str(desktop))
        screenshots.append(desktop)

        driver.find_element(By.CSS_SELECTOR, '#recordPeriodTabs [data-record-period="today"]').click()
        wait.until(lambda current: current.find_element(
            By.ID, "recordTodayWorkspace"
        ).is_displayed())
        assert driver.find_element(
            By.CSS_SELECTOR, '[data-today-record-tab="site-sample"]'
        ).get_attribute("aria-selected") == "true"

        driver.get(f"{base_url}/records.html?view=today&category=intake")
        wait.until(lambda current: current.find_element(
            By.ID, "recordTodayWorkspace"
        ).is_displayed())
        wait.until(lambda current: current.find_element(
            By.CSS_SELECTOR,
            '#recordsSidebar a[aria-current="page"]',
        ).text == "Today's Intake")

        route_audit = []
        monthly_workspaces = {
            "summary": "operationalSummaryWorkspace",
            "intake": "collectionLedgerWorkspace",
            "site_sample": "formLedgerWorkspace",
            "stock": "formLedgerWorkspace",
            "process": "formLedgerWorkspace",
        }
        for category, workspace_id in monthly_workspaces.items():
            driver.get(f"{base_url}/records.html?category={category}&view=monthly")
            wait.until(lambda current, expected=workspace_id: current.find_element(
                By.ID, expected
            ).is_displayed())
            wait.until(lambda current: current.find_element(
                By.CSS_SELECTOR, '#recordPeriodTabs [data-record-period="monthly"]'
            ).get_attribute("aria-selected") == "true")
            route_audit.append(f"monthly:{category}")

        for category in ("summary", "intake", "site_sample", "stock", "process"):
            driver.get(f"{base_url}/records.html?category={category}&view=all")
            expected = (
                "operationalSummaryWorkspace" if category == "summary"
                else "collectionLedgerWorkspace" if category == "intake"
                else "formLedgerWorkspace"
            )
            wait.until(lambda current, expected_id=expected: current.find_element(
                By.ID, expected_id
            ).is_displayed())
            route_audit.append(f"all:{category}")

        for category, expected_panel in (
            ("summary", "operationalSummaryWorkspace"),
            ("intake", "collectionLedgerWorkspace"),
            ("site_sample", "formLedgerCommunityPanel"),
        ):
            driver.get(f"{base_url}/records.html?category={category}&view=community")
            wait.until(lambda current, expected_id=expected_panel: current.find_element(
                By.ID, expected_id
            ).is_displayed())
            route_audit.append(f"community:{category}")

        driver.get(f"{base_url}/records.html?category=stock&view=container")
        wait.until(lambda current: current.find_element(
            By.ID, "containerLookupWorkspace"
        ).is_displayed())
        route_audit.append("container:stock")

        driver.get(f"{base_url}/admin_monthly.html?grouping=week")
        wait.until(lambda current: "records.html" in current.current_url)
        assert "category=intake" in driver.current_url
        assert "view=monthly" in driver.current_url
        assert "grouping=week" in driver.current_url
        route_audit.append("legacy:admin_monthly")

        driver.set_window_size(390, 844)
        driver.get(f"{base_url}/records.html?category=site_sample&view=monthly")
        wait.until(lambda current: current.find_element(
            By.ID, "recordTodayWorkspace"
        ).is_displayed())
        wait.until(lambda current: current.execute_script(
            "return document.body.dataset.recordPeriod || '';"
        ) == "today")
        mobile = driver.execute_script(
            """
            const tabs = document.getElementById("todayRecordTabs");
            const periods = [...document.querySelectorAll("#recordPeriodTabs [data-record-period]")]
              .filter((button) => getComputedStyle(button).display !== "none")
              .map((button) => button.dataset.recordPeriod);
            return {
              viewport: document.documentElement.clientWidth,
              scrollWidth: document.documentElement.scrollWidth,
              tabClientWidth: tabs.clientWidth,
              tabScrollWidth: tabs.scrollWidth,
              periods,
              dailyVisible: !document.getElementById("recordTodayWorkspace").hidden,
              historicalVisible: !document.getElementById("formLedgerCategories").hidden
            };
            """
        )
        assert mobile["scrollWidth"] <= mobile["viewport"] + 1, mobile
        assert mobile["tabScrollWidth"] >= mobile["tabClientWidth"], mobile
        assert mobile["periods"] == ["today"], mobile
        assert mobile["dailyVisible"], mobile
        assert not mobile["historicalVisible"], mobile

        mobile_shot = pathlib.Path(tempfile.gettempdir()) / "form-record-reporting-mobile.png"
        driver.save_screenshot(str(mobile_shot))
        screenshots.append(mobile_shot)

        severe_logs = [
            entry for entry in driver.get_log("browser")
            if entry.get("level") == "SEVERE"
            and "favicon" not in entry.get("message", "").lower()
        ]
        assert not severe_logs, severe_logs
        print(json.dumps({
            "status": "ok",
            "heading": heading_layout,
            "mobile": mobile,
            "routes": route_audit,
            "screenshots": [str(path) for path in screenshots],
        }, indent=2))
    finally:
        if driver:
            driver.quit()
        server.shutdown()
        server.server_close()
        cleanup(keys, user_id)


if __name__ == "__main__":
    main()
