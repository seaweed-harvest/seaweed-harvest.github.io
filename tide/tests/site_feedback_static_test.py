from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def main():
    widget = (ROOT / "assets" / "js" / "site_feedback.js").read_text(encoding="utf-8")
    disclaimer = (ROOT / "assets" / "js" / "disclaimer.js").read_text(encoding="utf-8")
    worker = (ROOT / "service-worker.js").read_text(encoding="utf-8")

    assert 'import("./site_feedback.js?v=2")' in disclaimer
    assert 'import("/assets/js/site_feedback.js?v=8")' in disclaimer
    assert '"./assets/js/site_feedback.js"' in worker
    assert "Better ideas start with a question." in widget
    assert "Mawazo bora huanza na swali." in widget
    assert "source_app: sourceApp" in widget
    assert "enqueueFeedback(payload)" in widget
    assert "PHOTO_TARGET_BYTES = 550 * 1024" in widget
    assert "photo_data_url: photoDataUrl" in widget
    assert '<input name="feedbackPhoto" type="file" accept="image/*">' in widget
    assert 'capture="environment"' not in widget
    assert "Make a suggestion" in widget
    assert 'name="feedbackType"' not in widget
    print("Tide feedback static checks passed")


if __name__ == "__main__":
    main()
