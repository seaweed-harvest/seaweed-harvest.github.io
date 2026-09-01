import base64
import json
import pathlib
import subprocess
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[1]
MATH_PATH = ROOT / "assets/js/dryer_payment_math.js"


def run_math(expression):
    source = MATH_PATH.read_text(encoding="utf-8")
    encoded = base64.b64encode(source.encode("utf-8")).decode("ascii")
    script = (
        f"const module = await import('data:text/javascript;base64,{encoded}');"
        f"console.log(JSON.stringify({expression}));"
    )
    result = subprocess.run(
        ["node", "--input-type=module", "-e", script],
        check=True,
        capture_output=True,
        text=True,
    )
    return json.loads(result.stdout)


class DryerTablePaymentLogicTest(unittest.TestCase):
    def test_contract_examples(self):
        cases = {
            "eight_loadings": (8, 0, True, 500, 200),
            "eight_loadings_three_unloadings": (8, 3, True, 575, 275),
            "twenty_one_loadings": (21, 0, True, 825, 525),
            "mixed_below_threshold": (5, 5, False, None, 250),
            "seven_loadings": (7, 0, False, None, 175),
            "three_loadings": (3, 0, False, None, 75),
        }
        for name, (loadings, unloadings, qualifies, contract, reference) in cases.items():
            with self.subTest(name=name):
                result = run_math(
                    f"module.calculateContractWorkAmount({loadings}, {unloadings})"
                )
                self.assertEqual(result["qualifies"], qualifies)
                self.assertEqual(result["contractAmountKes"], contract)
                self.assertEqual(result["referenceAmountKes"], reference)

    def test_phone_credit_never_reduces_work_compensation(self):
        result = run_math(
            "module.calculateSelectedPayment(["
            "{approved_work_amount_kes: 825, phone_data_allowance_kes: 100},"
            "{approved_work_amount_kes: 175, phone_data_allowance_kes: 100}"
            "], 1000)"
        )
        self.assertEqual(
            result,
            {
                "dayCount": 2,
                "workAmount": 1000,
                "phoneDataAmount": 200,
                "phoneDataCreditApplied": 200,
                "transferAmount": 1000,
            },
        )

    def test_credit_is_limited_to_available_balance(self):
        result = run_math(
            "module.calculateSelectedPayment(["
            "{approved_work_amount_kes: 175, phone_data_allowance_kes: 100},"
            "{approved_work_amount_kes: 75, phone_data_allowance_kes: 100}"
            "], 50)"
        )
        self.assertEqual(result["workAmount"], 250)
        self.assertEqual(result["phoneDataAmount"], 200)
        self.assertEqual(result["phoneDataCreditApplied"], 50)
        self.assertEqual(result["transferAmount"], 400)

    def test_no_credit_is_applied_without_phone_allowance(self):
        result = run_math(
            "module.calculateSelectedPayment(["
            "{approved_work_amount_kes: 500, phone_data_allowance_kes: 0}"
            "], 1000)"
        )
        self.assertEqual(result["phoneDataCreditApplied"], 0)
        self.assertEqual(result["transferAmount"], 500)


if __name__ == "__main__":
    unittest.main()
