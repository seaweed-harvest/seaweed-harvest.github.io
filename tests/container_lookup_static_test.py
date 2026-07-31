import pathlib
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[1]


def read(relative_path):
    return (ROOT / relative_path).read_text(encoding="utf-8")


class ContainerLookupStaticTest(unittest.TestCase):
    def setUp(self):
        self.page = read("container_lookup.html")
        self.script = read("assets/js/container_lookup_page.js")
        self.navigation = read("assets/js/app_navigation.js")
        self.records = read("records.html")
        self.records_script = read("assets/js/records_page.js")
        self.styles = read("assets/css/ag.css")
        self.migration = read(
            "supabase/migrations/20260731110000_stock_container_lookup.sql"
        )
        self.worker = read("service-worker.js")

    def test_page_has_requested_filters_and_grouped_columns(self):
        for element_id in (
            "containerLookupSearch",
            "containerLookupFrom",
            "containerLookupTo",
            "containerLookupRows",
        ):
            self.assertIn(f'id="{element_id}"', self.page)
        for heading in (
            "Container",
            "Date",
            "Entry",
            "Species",
            "Volume",
            "Dose g/container",
            "Salinity",
            "pH",
            "EC mS/cm",
            "Recorded by",
            "Notes",
        ):
            self.assertIn(heading, self.page)
        self.assertIn("container-lookup-group-row", self.script)
        self.assertIn("Container ${escapeHtml(displayContainer(group.key))}", self.script)
        self.assertIn('aria-expanded="${expanded}"', self.script)
        self.assertIn("state.expandedContainers.has(group.key)", self.script)

    def test_group_summary_uses_common_values_and_qc_ranges(self):
        self.assertIn("commonGroupValue(rows, (row) => titleCase(row.species))", self.script)
        self.assertIn("commonGroupValue(rows, stockChemicalSummary)", self.script)
        self.assertIn('measurementRange(rows, "salinity_value", "salinity_unit")', self.script)
        self.assertIn('measurementRange(rows, "ph_value")', self.script)
        self.assertIn(
            'measurementRange(rows, "electrical_conductivity_ms_cm")',
            self.script,
        )
        self.assertIn("container-lookup-group-empty", self.script)

    def test_container_input_accepts_padded_and_unpadded_serials(self):
        self.assertIn('placeholder="e.g. 1,2,3 or 0001,0002,0003"', self.page)
        self.assertIn("ltrim(trim(token), '0')", self.migration)
        self.assertIn("ltrim(trim(record.carton_serial), '0')", self.migration)
        self.assertIn("regexp_split_to_table", self.migration)

    def test_lookup_is_permission_and_organisation_scoped(self):
        self.assertIn("public.ag_require_permission('can_view_data')", self.migration)
        self.assertIn(
            "public.ag_require_organisation_capability('form_stock_record')",
            self.migration,
        )
        self.assertIn("public.ag_require_active_aggregator()", self.migration)
        self.assertIn("record.aggregator_id = v_aggregator_id", self.migration)
        self.assertIn("to authenticated", self.migration)
        self.assertNotIn("grant execute on function public.ag_stock_container_lookup(text, date, date, integer)\n  to anon", self.migration)

    def test_lookup_is_a_stock_record_view_not_a_sidebar_item(self):
        self.assertNotIn('label: "Container Lookup"', self.navigation)
        self.assertIn('id="recordContainerLookupTab"', self.records)
        self.assertIn('href="./container_lookup.html"', self.records)
        self.assertIn('els.recordContainerLookupTab.hidden = state.category !== "stock"', self.records_script)
        self.assertIn('aria-current="page">Container Lookup</a>', self.page)
        period_tabs = self.page.split(
            '<nav class="ledger-view-tabs record-period-tabs"', 1
        )[1].split("</nav>", 1)[0]
        self.assertLess(period_tabs.index("Community Records"), period_tabs.index("Container Lookup"))
        self.assertLess(period_tabs.index("Container Lookup"), period_tabs.index("All Records"))
        self.assertIn('"./container_lookup.html"', self.worker)
        self.assertIn('"./assets/js/container_lookup_page.js"', self.worker)

    def test_collapsed_marker_and_summary_typography_are_distinct(self):
        self.assertIn('content: ">";', self.styles)
        self.assertIn(".container-lookup-group-toggle[aria-expanded=\"true\"]::before", self.styles)
        group_rule = self.styles.split(
            ".container-lookup-table .container-lookup-group-row > * {", 1
        )[1].split("}", 1)[0]
        self.assertIn("color: var(--text-sec);", group_rule)
        self.assertIn("font-weight: 600;", group_rule)

    def test_single_date_is_sent_as_an_exact_day(self):
        self.assertIn("start: from || to || null", self.script)
        self.assertIn("end: to || from || null", self.script)

    def test_all_columns_are_sortable(self):
        self.assertEqual(self.page.count("data-container-sort="), 11)
        self.assertIn("state.sortField === field", self.script)
        self.assertIn("rows: rows.sort(compareRows)", self.script)


if __name__ == "__main__":
    unittest.main()
