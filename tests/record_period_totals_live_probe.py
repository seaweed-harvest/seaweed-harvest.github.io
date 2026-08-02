import datetime as dt

from seaweedke_ui_probe import (
    PROJECT_URL,
    api_keys,
    cleanup,
    create_admin,
    request_json,
)


RECORD_COUNT_FIELDS = {
    "summary": "record_count",
    "intake": "collection_count",
    "site_sample": "record_count",
    "stock": "record_count",
    "process": "record_count",
}


def parse_date(value):
    return dt.date.fromisoformat(value)


def expected_period_end(period_start, grouping):
    if grouping == "day":
        return period_start
    if grouping == "week":
        return period_start + dt.timedelta(days=6)
    if grouping == "month":
        next_month = (
            dt.date(period_start.year + 1, 1, 1)
            if period_start.month == 12
            else dt.date(period_start.year, period_start.month + 1, 1)
        )
        return next_month - dt.timedelta(days=1)
    return dt.date(period_start.year, 12, 31)


def main():
    keys = api_keys()
    user_id, email, password = create_admin(keys)
    try:
        mawimbi = request_json(
            "GET",
            f"{PROJECT_URL}/rest/v1/ag_aggregators"
            "?select=id&aggregator_code=eq.MAWIMBI&limit=1",
            keys["service_role"],
            keys["service_role"],
        )[0]
        request_json(
            "PATCH",
            f"{PROJECT_URL}/rest/v1/ag_user_profiles?id=eq.{user_id}",
            keys["service_role"],
            keys["service_role"],
            {"active_aggregator_id": mawimbi["id"]},
            "return=minimal",
        )
        session = request_json(
            "POST",
            f"{PROJECT_URL}/auth/v1/token?grant_type=password",
            keys["anon"],
            keys["anon"],
            {"email": email, "password": password},
        )
        access_token = session["access_token"]

        results = {}
        for record_type, count_field in RECORD_COUNT_FIELDS.items():
            baseline_total = None
            baseline_active_days = None
            results[record_type] = {}
            for grouping in ("day", "week", "month", "year"):
                result = request_json(
                    "POST",
                    f"{PROJECT_URL}/rest/v1/rpc/ag_sec_record_period_totals",
                    keys["anon"],
                    access_token,
                    {
                        "p_record_type": record_type,
                        "p_start_date": "2026-01-01",
                        "p_end_date": "2026-12-31",
                        "p_grouping": grouping,
                    },
                )
                assert result["record_type"] == record_type, result
                assert result["grouping"] == grouping, result
                rows = result["rows"]
                starts = [parse_date(row["period_start"]) for row in rows]
                assert starts == sorted(starts, reverse=True), (record_type, grouping)
                for row, start in zip(rows, starts):
                    assert int(row[count_field]) > 0, (record_type, grouping, row)
                    active_days = int(row["active_day_count"])
                    assert active_days > 0, (record_type, grouping, row)
                    if grouping == "day":
                        assert active_days == 1, (record_type, grouping, row)
                    if grouping == "week":
                        assert start.weekday() == 0, row
                    assert parse_date(row["period_end"]) == expected_period_end(
                        start, grouping
                    ), row

                grouped_total = sum(int(row[count_field]) for row in rows)
                rpc_total = int(result["totals"].get(count_field) or 0)
                assert grouped_total == rpc_total, (
                    record_type,
                    grouping,
                    grouped_total,
                    rpc_total,
                )
                if baseline_total is None:
                    baseline_total = rpc_total
                assert rpc_total == baseline_total, (record_type, grouping)
                rpc_active_days = int(result["totals"]["active_day_count"])
                grouped_active_days = sum(int(row["active_day_count"]) for row in rows)
                assert grouped_active_days == rpc_active_days, (
                    record_type,
                    grouping,
                    grouped_active_days,
                    rpc_active_days,
                )
                if baseline_active_days is None:
                    baseline_active_days = rpc_active_days
                assert rpc_active_days == baseline_active_days, (record_type, grouping)
                results[record_type][grouping] = {
                    "rows": len(rows),
                    "records": rpc_total,
                    "active_days": grouped_active_days,
                }

        assert results["summary"]["day"]["records"] > 0, results
        assert results["intake"]["day"]["records"] > 0, results
        assert results["stock"]["day"]["records"] > 0, results
        print({"status": "ok", "organisation": "MAWIMBI", "results": results})
    finally:
        cleanup(keys, user_id)


if __name__ == "__main__":
    main()
