from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def read(relative_path):
    return (ROOT / relative_path).read_text(encoding="utf-8")


def test_web_auth_loader_uses_the_full_brand_logo():
    for page_name in ("index.html", "login.html"):
        page = read(page_name)
        loader = page.split('class="auth-session-loader"', 1)[1].split("</div>", 1)[0]
        assert "seaweed-harvest-logo.svg" in loader
        assert "seaweed-harvest-icon-192.png" not in loader


def test_desktop_header_uses_wordmark_and_mobile_navigation_keeps_app_icon():
    css = read("assets/css/ag.css")
    navigation = read("assets/js/app_navigation.js")

    assert "@media (min-width: 981px)" in css
    assert 'background: url("../images/seaweed-harvest-logo.svg")' in css
    assert 'brandImage.src = "./assets/images/seaweed-harvest-icon-192.png"' in navigation
