import pathlib
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[1]


def read(relative_path):
    return (ROOT / relative_path).read_text(encoding="utf-8")


class OperationalSummaryRefinementStaticTest(unittest.TestCase):
    def setUp(self):
        self.migration = read(
            "supabase/migrations/20260731120000_operational_summary_refinement.sql"
        )
        self.records = read("records.html")
        self.records_script = read("assets/js/records_page.js")
        self.today_script = read("assets/js/today_record_tabs.js")
        self.period_migration = read(
            "supabase/migrations/20260801090000_record_period_totals.sql"
        )

    def test_daily_summary_counts_distinct_retested_containers_and_links_date(self):
        self.assertIn(
            "count(distinct nullif(trim(stock.carton_serial), ''))",
            self.migration,
        )
        self.assertIn(
            "lower(coalesce(stock.record_type, 'initial')) = 'retest'",
            self.migration,
        )
        self.assertIn('"QC Retested Stock"', self.today_script)
        self.assertIn(
            "./container_lookup.html?from=${encodeURIComponent(recordDate())}"
            "&to=${encodeURIComponent(recordDate())}",
            self.today_script,
        )

    def test_monthly_summary_uses_month_totals_and_weighted_ratios(self):
        self.assertIn(
            "create function public.ag_sec_monthly_operational_summary",
            self.migration,
        )
        self.assertIn(
            "sum(volume_l) filter (where record_type <> 'retest')",
            self.migration,
        )
        self.assertIn(
            "sum(wet_pulp_kg)",
            self.migration,
        )
        self.assertIn(
            "/ nullif(coalesce(sum(presses), 0), 0)",
            self.migration,
        )
        self.assertIn(
            "/ nullif(coalesce(collection.intake_weight_kg, 0), 0)",
            self.migration,
        )
        for field in (
            "stock_volume_l",
            "stock_container_count",
            "community_count",
            "farmer_count",
            "collection_count",
            "process_lost_kg",
            "process_minutes",
            "process_press_count",
            "process_avg_wet_pulp_per_press",
            "stock_l_per_intake_kg",
        ):
            self.assertIn(field, self.migration)

    def test_monthly_table_drops_requested_columns(self):
        start = self.records.index('<thead id="operationalSummaryHead">')
        end = self.records.index("</thead>", start)
        summary_head = self.records[start:end]
        for dropped in (
            "Sample locations",
            "Sodium benzoate",
            "Citric acid",
            "Salinity",
            "<th>pH</th>",
            "<th>EC</th>",
            "Pressed L",
        ):
            self.assertNotIn(dropped, summary_head)
        self.assertIn("Avg wet pulp/press kg", summary_head)
        self.assertIn("Avg stock L / intake kg", summary_head)
        self.assertIn('colspan="18"', self.records)

    def test_community_summary_starts_with_all_active_linked_communities(self):
        self.assertIn(
            "create function public.ag_sec_community_operational_summary",
            self.migration,
        )
        self.assertIn("from public.communities community", self.migration)
        self.assertIn(
            "join public.ag_aggregator_communities link",
            self.migration,
        )
        self.assertIn("and link.is_active", self.migration)
        self.assertIn("where community.active", self.migration)
        self.assertIn("left join public.collections collection", self.migration)
        self.assertIn(
            "left join public.ag_site_water_sample_records sample",
            self.migration,
        )
        for field in (
            "site_sample_count",
            "temperature_min",
            "temperature_max",
            "salinity_min",
            "salinity_max",
            "tds_min_mg_l",
            "tds_max_mg_l",
            "ec_min_ms_cm",
            "ec_max_ms_cm",
        ):
            self.assertIn(field, self.migration)
        self.assertIn("sample.tds_value * 1000", self.migration)

    def test_ui_routes_period_summary_to_shared_rpc_and_community_to_dedicated_rpc(self):
        self.assertIn(
            'name: "ag_sec_record_period_totals"',
            self.records_script,
        )
        self.assertIn(
            'name: "ag_sec_community_operational_summary"',
            self.records_script,
        )
        self.assertIn('"Community", "Collected kg"', self.records_script)
        self.assertIn('"TDS mg/L", "EC mS/cm"', self.records_script)
        self.assertIn("const labels = operationalSummaryLabels()", self.records_script)
        self.assertIn('grouping === "day" ? [] : ["Active days"]', self.records_script)
        self.assertIn('p_record_type: "summary"', self.records_script)
        self.assertIn('p_grouping: reportingGrouping', self.records_script)

    def test_new_summary_rpcs_are_permission_protected(self):
        self.assertGreaterEqual(
            self.migration.count(
                "perform public.ag_require_permission('can_view_data')"
            ),
            2,
        )
        self.assertIn(
            "grant execute on function "
            "public.ag_sec_monthly_operational_summary(date, date)",
            self.migration,
        )
        self.assertIn(
            "grant execute on function "
            "public.ag_sec_community_operational_summary(date, date)",
            self.migration,
        )
        self.assertNotIn("to anon;", self.migration)
        self.assertIn(
            "grant execute on function public.ag_sec_record_period_totals",
            self.period_migration,
        )
        self.assertIn("v_grouping not in ('day', 'week', 'month', 'year')", self.period_migration)


if __name__ == "__main__":
    unittest.main()
