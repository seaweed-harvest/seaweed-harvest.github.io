import contextlib
import time
import urllib.error

from seaweedke_ui_probe import (
    PROJECT_URL,
    add_cosme_membership,
    api_keys,
    cleanup,
    create_admin,
    request_json,
)


def create_single_organisation_admin(keys):
    suffix = str(int(time.time() * 1000))
    email = f"codex.organisation.scope.{suffix}@example.com"
    password = f"OrganisationScope!{suffix}Aa9"
    user = request_json(
        "POST",
        f"{PROJECT_URL}/auth/v1/admin/users",
        keys["service_role"],
        keys["service_role"],
        {
            "email": email,
            "password": password,
            "email_confirm": True,
            "user_metadata": {"full_name": "Organisation Scope Probe"},
        },
    )
    bati = request_json(
        "GET",
        f"{PROJECT_URL}/rest/v1/ag_aggregators?select=id&aggregator_code=eq.BATI&limit=1",
        keys["service_role"],
        keys["service_role"],
    )[0]
    request_json(
        "PATCH",
        f"{PROJECT_URL}/rest/v1/ag_user_profiles?id=eq.{user['id']}",
        keys["service_role"],
        keys["service_role"],
        {
            "email": email,
            "display_name": "Organisation Scope Probe",
            "app_role": "company_admin",
            "account_status": "active",
            "active_aggregator_id": bati["id"],
            "can_access_admin": True,
            "can_manage_users": True,
            "can_manage_organisation_permissions": True,
        },
        "return=minimal",
    )
    request_json(
        "POST",
        f"{PROJECT_URL}/rest/v1/ag_aggregator_memberships",
        keys["service_role"],
        keys["service_role"],
        {
            "aggregator_id": bati["id"],
            "user_id": user["id"],
            "membership_role": "aggregator_admin",
            "is_active": True,
        },
        "return=minimal",
    )
    return user["id"], email, password, bati["id"]


def password_session(keys, email, password):
    return request_json(
        "POST",
        f"{PROJECT_URL}/auth/v1/token?grant_type=password",
        keys["anon"],
        keys["anon"],
        {"email": email, "password": password},
    )["access_token"]


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
    scoped_user_id = None
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
                "can_manage_organisation_permissions": True,
                "can_submit_collection": True,
                "can_view_data": True,
            },
            "return=minimal",
        )
        token = password_session(keys, email, password)

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
        if capabilities.get("form_green_space") is not False:
            raise AssertionError("COSME unexpectedly enables Green Space")

        organisation_options = request_json(
            "POST",
            f"{PROJECT_URL}/rest/v1/rpc/ag_admin_organisation_permission_options",
            keys["anon"],
            token,
            {},
        )
        if not organisation_options["can_access"]:
            raise AssertionError("System admin could not access organisation permissions")

        permissions = request_json(
            "POST",
            f"{PROJECT_URL}/rest/v1/rpc/ag_admin_organisation_permissions",
            keys["anon"],
            token,
            {"p_organisation_id": cosme_id},
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

        scoped_user_id, scoped_email, scoped_password, bati_id = (
            create_single_organisation_admin(keys)
        )
        scoped_token = password_session(keys, scoped_email, scoped_password)
        single_scope = request_json(
            "POST",
            f"{PROJECT_URL}/rest/v1/rpc/ag_admin_organisation_permission_options",
            keys["anon"],
            scoped_token,
            {},
        )
        if single_scope != {
            "can_access": False,
            "active_organisation_id": None,
            "organisations": [],
        }:
            raise AssertionError(
                f"Single-organisation user received organisation details: {single_scope}"
            )

        scoped_cosme_id = add_cosme_membership(keys, scoped_user_id)
        update_result = request_json(
            "POST",
            f"{PROJECT_URL}/functions/v1/admin-users",
            keys["anon"],
            token,
            {
                "action": "update",
                "user_id": scoped_user_id,
                "app_role": "company_admin",
                "account_status": "active",
                "aggregator_ids": [bati_id, scoped_cosme_id],
                "organisation_form_access": {
                    bati_id: {
                        "form_site_water_samples": True,
                        "form_intake_collection": True,
                        "form_stock_record": False,
                        "form_process_record": False,
                        "form_reef_nursery": False,
                        "form_dryer_table": False,
                        "form_green_space": False,
                    }
                }
            },
        )
        if not update_result.get("ok"):
            raise AssertionError(f"User form access update failed: {update_result}")
        scoped_profile = request_json(
            "POST",
            f"{PROJECT_URL}/rest/v1/rpc/ag_my_profile",
            keys["anon"],
            scoped_token,
            {},
        )
        scoped_capabilities = scoped_profile["organisation_capabilities"]
        if not scoped_capabilities.get("form_intake_collection"):
            raise AssertionError("User-specific access hid an allowed collection form")
        if scoped_capabilities.get("form_process_record"):
            raise AssertionError("User-specific access did not hide Process Record")
        expect_denied(
            lambda: request_json(
                "POST",
                f"{PROJECT_URL}/rest/v1/rpc/ag_form_record_summary",
                keys["anon"],
                scoped_token,
                {"p_record_type": "process"},
            ),
            "user-restricted process summary",
        )

        multi_scope = request_json(
            "POST",
            f"{PROJECT_URL}/rest/v1/rpc/ag_admin_organisation_permission_options",
            keys["anon"],
            scoped_token,
            {},
        )
        scoped_codes = {
            row["aggregator_code"] for row in multi_scope["organisations"]
        }
        if not multi_scope["can_access"] or scoped_codes != {"BATI", "COSME"}:
            raise AssertionError(
                f"Multi-organisation scope leaked or omitted organisations: {multi_scope}"
            )

        print(
            "PASS: organisation forms, records, and single/multi-organisation "
            "permission scoping"
        )
    finally:
        if scoped_user_id:
            with contextlib.suppress(Exception):
                cleanup(keys, scoped_user_id)
        with contextlib.suppress(Exception):
            cleanup(keys, user_id)


if __name__ == "__main__":
    main()
