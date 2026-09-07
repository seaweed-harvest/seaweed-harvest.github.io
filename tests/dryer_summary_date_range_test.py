"""Synthetic regression checks for dryer-event summary dates (no network)."""
import json
import os
import pathlib
import re
import subprocess
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "assets/js/dryer_table_records.js"
HARNESS = r"""
const fs = require('node:fs');
const vm = require('node:vm');
const input = JSON.parse(fs.readFileSync(0, 'utf8'));
const source = fs.readFileSync(process.argv[1], 'utf8').replace(/^import .*;\r?\n/gm, '');
const context = vm.createContext({document: {addEventListener() {}}, input});
vm.runInContext(source, context);
const result = vm.runInContext(`(() => {
  const groups = groupedBayRows(input.rows, input.mode || 'event');
  return groups.map(group => ({
    label: group.label,
    key: group.storageKey,
    header: groupHeaderRow(group, false),
    rows: group.rows.map(row => bayRowMarkup(row, group.storageKey, true))
  }));
})()`, context);
console.log(JSON.stringify(result));
"""


def bay(number=1, **changes):
    return {
        "submission_id": "synthetic-dryer-event",
        "table_location": "Bati (Table 4)",
        "bay_number": number,
        "loading_at": "2026-08-29T17:29:00+03:00",
        "unloading_at": "2026-09-04T08:47:00+03:00",
        "recorded_at": "2026-09-05T12:00:00+03:00",
        "status": "complete",
        "loading_weight_kg": 10,
        "unloading_weight_kg": 4,
        "table_photo_count": 1,
        "loading_photo_count": 2,
        "unloading_photo_count": 0,
        **changes,
    }


class DryerSummaryDateRangeTest(unittest.TestCase):
    def render(self, rows, mode="event", timezone="Australia/Perth"):
        result = subprocess.run(
            ["node", "-e", HARNESS, str(SCRIPT)],
            input=json.dumps({"rows": rows, "mode": mode}),
            text=True, capture_output=True, check=True, timeout=15,
            env={**os.environ, "TZ": timezone},
        )
        # ICU versions use either Sep or Sept for the existing en-GB formatter.
        return json.loads(re.sub(r"\bSept\b", "Sep", result.stdout))

    def test_completed_event_has_dates_without_times(self):
        group = self.render([bay()])[0]
        self.assertEqual(group["label"], "Bati (Table 4) — 29 Aug 2026 – 04 Sep 2026")
        self.assertIn("0 drying · 1 complete", group["header"])

    def test_earliest_load_and_latest_unload_ignore_row_order(self):
        rows = [bay(1, loading_at="2026-08-30T10:00:00+03:00"),
                bay(4, unloading_at="2026-09-03T12:00:00+03:00")]
        expected = "Bati (Table 4) — 29 Aug 2026 – 04 Sep 2026"
        self.assertEqual(self.render(rows)[0]["label"], expected)
        self.assertEqual(self.render(list(reversed(rows)))[0]["label"], expected)

    def test_partial_unloading_keeps_drying_count_and_other_summary_details(self):
        group = self.render([bay(), bay(3, unloading_at=None, status="drying",
                                              unloading_weight_kg=None), bay(4)])[0]
        self.assertIn("29 Aug 2026 – 04 Sep 2026", group["label"])
        self.assertIn("3 bays · 30 kg loaded · 8 kg unloaded · 1 drying · 2 complete", group["header"])
        self.assertIn(">7 photos</button>", group["header"])
        self.assertIn('data-dryer-photo-title="' + group["label"] + '"', group["header"])

    def test_no_unloading_preserves_loading_timestamp(self):
        for value in (None, "", "not-a-date"):
            with self.subTest(unloading_at=value):
                group = self.render([bay(unloading_at=value, status="drying")])[0]
                self.assertEqual(group["label"], "Bati (Table 4) — 29 Aug 2026, 17:29")

    def test_invalid_timestamps_do_not_hide_valid_endpoints(self):
        group = self.render([bay(1, unloading_at="invalid"), bay(2, loading_at="invalid")])[0]
        self.assertEqual(group["label"], "Bati (Table 4) — 29 Aug 2026 – 04 Sep 2026")

    def test_missing_load_does_not_invent_a_start_date(self):
        group = self.render([bay(loading_at=None)])[0]
        self.assertEqual(group["label"], "Bati (Table 4) — 05 Sep 2026, 12:00")
        group = self.render([bay(loading_at=None, recorded_at=None, unloading_at=None)])[0]
        self.assertEqual(group["label"], "Bati (Table 4) — -")

    def test_backwards_unload_does_not_render_reversed_range(self):
        group = self.render([bay(unloading_at="2026-08-28T17:29:00+03:00")])[0]
        self.assertEqual(group["label"], "Bati (Table 4) — 29 Aug 2026, 17:29")

    def test_same_day_unloading_still_has_both_endpoints(self):
        group = self.render([bay(unloading_at="2026-08-29T18:00:00+03:00")])[0]
        self.assertEqual(group["label"], "Bati (Table 4) — 29 Aug 2026 – 29 Aug 2026")

    def test_dates_use_kenya_not_browser_or_utc_day(self):
        rows = [bay(loading_at="2026-08-28T22:29:00Z", unloading_at="2026-09-03T22:00:00Z")]
        for zone in ("Australia/Perth", "Pacific/Honolulu", "UTC"):
            with self.subTest(timezone=zone):
                self.assertEqual(self.render(rows, timezone=zone)[0]["label"],
                                 "Bati (Table 4) — 29 Aug 2026 – 04 Sep 2026")

    def test_latest_unload_compares_instants_not_timestamp_strings(self):
        rows = [bay(1, unloading_at="2026-09-04T00:30:00+08:00"),
                bay(2, unloading_at="2026-09-03T22:00:00Z")]
        self.assertEqual(self.render(rows)[0]["label"], "Bati (Table 4) — 29 Aug 2026 – 04 Sep 2026")

    def test_other_group_modes_and_individual_row_timestamps_are_unchanged(self):
        self.assertEqual(self.render([bay()], "table")[0]["label"], "Bati (Table 4)")
        self.assertEqual(self.render([bay()], "load_date")[0]["label"], "29 Aug 2026")
        row = self.render([bay()])[0]["rows"][0]
        self.assertIn("29 Aug 2026, 17:29", row)
        self.assertIn("04 Sep 2026, 08:47", row)
        self.assertIn("<td>10</td>", row)
        self.assertIn("<td>4</td>", row)

    def test_events_stay_separate_and_sorted_by_loading_not_unloading(self):
        groups = self.render([bay(unloading_at="2026-09-06T10:00:00+03:00"),
                              bay(submission_id="newer", loading_at="2026-08-30T09:00:00+03:00")])
        self.assertEqual(len(groups), 2)
        self.assertEqual(groups[0]["key"], "event:newer")
        self.assertEqual(groups[0]["label"], "Bati (Table 4) — 30 Aug 2026 – 04 Sep 2026")
        self.assertEqual(groups[1]["label"], "Bati (Table 4) — 29 Aug 2026 – 06 Sep 2026")


if __name__ == "__main__":
    unittest.main()
