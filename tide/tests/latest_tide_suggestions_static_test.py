from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def main():
    index = (ROOT / "index.html").read_text(encoding="utf-8")
    script = (ROOT / "assets" / "js" / "tide_page.js").read_text(encoding="utf-8")
    styles = (ROOT / "assets" / "css" / "tides.css").read_text(encoding="utf-8")

    for removed_id in (
        'id="includeTideReferences"',
        'id="verificationBadge"',
        'id="datasetBadge"',
        'id="timeZoneLabel"',
        'id="offlineLocationStatus"',
        'id="offlineSaveLocation"',
        'id="offlineRemoveLocation"',
    ):
        assert removed_id not in index

    assert "return [...farmLocations, ...tideReferenceLocations];" in script
    assert 'renderLocationOptgroup(t("page.farmLocations"), farmLocations)' in script
    assert 'renderLocationOptgroup(t("page.tideDataLocations"), tideReferenceLocations)' in script
    assert "includeTideReferences:" not in script
    assert "els.includeTideReferences" not in script
    assert ".app-nav a.desktop-admin-link" in styles
    assert "display: none;" in styles.split(".app-nav a.desktop-admin-link", 1)[1].split("}", 1)[0]
    print("Latest Tide suggestion static checks passed")


if __name__ == "__main__":
    main()
