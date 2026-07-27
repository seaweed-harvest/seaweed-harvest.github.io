import contextlib
import urllib.error

from seaweedke_ui_probe import (
    PROJECT_URL,
    add_cosme_membership,
    api_keys,
    cleanup,
    create_admin,
    request_json,
)


def expect_denied(call, label):
    try:
        call()
    except urllib.error.HTTPError as error:
        if error.code not in {400, 403}:
            raise AssertionError(
                f"{label}: expected 400/403, received {error.code}"
            ) from error
        return
    raise AssertionError(f"{label}: request unexpectedly succeeded")


def main():
    keys = api_keys()
    user_id, email, password = create_admin(keys)
    try:
        cosme_id = add_cosme_membership(keys, user_id)
        request_json(
            "PATCH",
            f"{PROJECT_URL}/rest/v1/ag_user_profiles?id=eq.{user_id}",
            keys["service_role"],
            keys["service_role"],
            {
                "active_aggregator_id": cosme_id,
                "can_manage_users": True,
                "can_manage_settings": True,
                "can_submit_collection": True,
                "can_view_data": True,
            },
            "return=minimal",
        )
        session = request_json(
            "POST",
            f"{PROJECT_URL}/auth/v1/token?grant_type=password",
            keys["anon"],
            keys["anon"],
            {"email": email, "password": password},
        )
        token = session["access_token"]

        profile = request_json(
            "POST",
            f"{PROJECT_URL}/rest/v1/rpc/ag_my_profile",
            keys["anon"],
            token,
            {},
        )
        capabilities = profile["organisation_capabilities"]
        for key in (
            "form_site_water_samples",
            "form_intake_collection",
            "form_stock_record",
            "form_process_record",
        ):
            if capabilities.get(key) is not False:
                raise AssertionError(f"COSME unexpectedly enables {key}")
        if not capabilities.get("form_reef_nursery"):
            raise AssertionError("COSME Reef Nursery capability is disabled")
        if not capabilities.get("form_dryer_table"):
            raise AssertionError("COSME Dryer Table capability is disabled")

        permissions = request_json(
            "POST",
            f"{PROJECT_URL}/rest/v1/rpc/ag_admin_organisation_permissions",
            keys["anon"],
            token,
            {},
        )
        if permissions["organisation"]["code"] != "COSME":
            raise AssertionError("Organisation permission RPC did not use COSME")

        expect_denied(
            lambda: request_json(
                "POST",
                f"{PROJECT_URL}/rest/v1/rpc/ag_form_record_ledger",
                keys["anon"],
                token,
                {"p_record_type": "process"},
            ),
            "COSME process ledger",
        )
        expect_denied(
            lambda: request_json(
                "POST",
                f"{PROJECT_URL}/rest/v1/rpc/ag_form_record_summary",
                keys["anon"],
                token,
                {"p_record_type": "stock"},
            ),
            "COSME stock summary",
        )
        expect_denied(
            lambda: request_json(
                "POST",
                f"{PROJECT_URL}/rest/v1/rpc/ag_submit_process_record",
                keys["anon"],
                token,
                {"p_submission_id": user_id, "p_record": {}},
            ),
            "COSME process submission",
        )

        print("PASS: COSME disabled forms also deny their connected database RPCs")
    finally:
        with contextlib.suppress(Exception):
            cleanup(keys, user_id)


if __name__ == "__main__":
    main()
