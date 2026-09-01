import json
import pathlib
import subprocess
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[1]
SCRIPT_PATH = ROOT / "assets/js/dryer_table_records.js"


def extract_function(source, name):
    marker = f"function {name}("
    start = source.index(marker)
    opening = source.index("{", start)
    depth = 0
    quote = None
    escaped = False
    template_depth = 0

    for index in range(opening, len(source)):
        character = source[index]
        if escaped:
            escaped = False
            continue
        if character == "\\" and quote:
            escaped = True
            continue
        if quote:
            if quote == "`" and character == "$" and index + 1 < len(source) and source[index + 1] == "{":
                template_depth += 1
                continue
            if quote == "`" and character == "}" and template_depth:
                template_depth -= 1
                continue
            if character == quote and template_depth == 0:
                quote = None
            continue
        if character in ("'", '"', "`"):
            quote = character
            continue
        if character == "{":
            depth += 1
        elif character == "}":
            depth -= 1
            if depth == 0:
                return source[start:index + 1]
    raise AssertionError(f"Function {name} could not be extracted")


def run_functions(function_names, expression):
    source = SCRIPT_PATH.read_text(encoding="utf-8")
    functions = "\n".join(extract_function(source, name) for name in function_names)
    script = f"{functions}\nconsole.log(JSON.stringify({expression}));"
    result = subprocess.run(
        ["node", "--input-type=module", "-e", script],
        check=True,
        capture_output=True,
        text=True,
    )
    return json.loads(result.stdout)


class DryerPhotoCountLogicTest(unittest.TestCase):
    def test_one_table_photo_plus_two_photos_for_eight_bays_is_seventeen(self):
        rows = [
            {
                "submission_id": "event-one",
                "bay_number": bay,
                "table_photo_count": 1,
                "loading_photo_count": 2,
                "unloading_photo_count": 0,
                "photo_count": 2,
            }
            for bay in range(1, 9)
        ]
        result = run_functions(
            ["groupedPhotoCount", "nonNegativeInteger"],
            f"groupedPhotoCount({json.dumps(rows)})",
        )
        self.assertEqual(result, 17)

    def test_table_photo_is_counted_once_per_submission_in_mixed_group(self):
        rows = [
            {
                "submission_id": "event-one",
                "bay_number": 1,
                "table_photo_count": 1,
                "loading_photo_count": 2,
                "unloading_photo_count": 1,
                "photo_count": 3,
            },
            {
                "submission_id": "event-one",
                "bay_number": 2,
                "table_photo_count": 1,
                "loading_photo_count": 2,
                "unloading_photo_count": 1,
                "photo_count": 3,
            },
            {
                "submission_id": "event-two",
                "bay_number": 1,
                "table_photo_count": 1,
                "loading_photo_count": 2,
                "unloading_photo_count": 0,
                "photo_count": 2,
            },
        ]
        result = run_functions(
            ["groupedPhotoCount", "nonNegativeInteger"],
            f"groupedPhotoCount({json.dumps(rows)})",
        )
        self.assertEqual(result, 10)

    def test_duplicate_bay_rows_do_not_inflate_group_total(self):
        rows = [
            {
                "submission_id": "event-one",
                "bay_number": 1,
                "table_photo_count": 1,
                "loading_photo_count": 2,
                "unloading_photo_count": 0,
                "photo_count": 2,
            },
            {
                "submission_id": "event-one",
                "bay_number": 1,
                "table_photo_count": 1,
                "loading_photo_count": 2,
                "unloading_photo_count": 0,
                "photo_count": 2,
            },
        ]
        result = run_functions(
            ["groupedPhotoCount", "nonNegativeInteger"],
            f"groupedPhotoCount({json.dumps(rows)})",
        )
        self.assertEqual(result, 3)

    def test_bay_photo_label_identifies_each_phase(self):
        row = {
            "submission_id": "11111111-1111-4111-8111-111111111111",
            "table_location": "Bati (Table 1)",
            "bay_number": 4,
            "loading_photo_count": 2,
            "unloading_photo_count": 3,
        }
        result = run_functions(
            [
                "bayPhotoMarkup",
                "nonNegativeInteger",
                "formatInteger",
                "escapeHtml",
                "escapeAttribute",
            ],
            f"bayPhotoMarkup({json.dumps(row)})",
        )
        self.assertIn("2 loading · 3 unloading", result)
        self.assertIn('data-dryer-photo-bay="4"', result)
        self.assertIn("data-dryer-photo-submission", result)

    def test_bay_without_photos_has_no_false_action(self):
        row = {
            "submission_id": "11111111-1111-4111-8111-111111111111",
            "bay_number": 4,
            "loading_photo_count": 0,
            "unloading_photo_count": 0,
        }
        result = run_functions(
            [
                "bayPhotoMarkup",
                "nonNegativeInteger",
                "formatInteger",
                "escapeHtml",
                "escapeAttribute",
            ],
            f"bayPhotoMarkup({json.dumps(row)})",
        )
        self.assertEqual(result, "-")


if __name__ == "__main__":
    unittest.main()
