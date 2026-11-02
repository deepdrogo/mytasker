"""Project websites and their favicons: validation, the SSRF guard, rasterising and storage."""

import io
import socket

import pytest
from PIL import Image

from apps.projects import icons
from apps.projects.models import Project

pytestmark = pytest.mark.django_db


def _png(size=32, color=(10, 200, 120, 255), fmt="PNG"):
    out = io.BytesIO()
    Image.new("RGBA", (size, size), color).save(out, fmt)
    return out.getvalue()


@pytest.fixture
def media(tmp_path, settings):
    settings.MEDIA_ROOT = tmp_path
    return tmp_path


@pytest.mark.parametrize(
    ("raw", "expected"),
    [("mytasker.io", "https://mytasker.io"), (" https://a.dev/x ", "https://a.dev/x"), ("", "")],
)
def test_normalize_website(raw, expected):
    assert icons.normalize_website(raw) == expected


@pytest.mark.parametrize("raw", ["ftp://example.com", "javascript:alert(1)", "localhost", "https://u:p@example.com"])
def test_normalize_rejects(raw):
    with pytest.raises(ValueError):
        icons.normalize_website(raw)


@pytest.mark.parametrize(
    "address", ["127.0.0.1", "10.0.0.5", "169.254.169.254", "192.168.1.1", "::1", "::ffff:127.0.0.1"]
)
def test_private_addresses_are_refused(monkeypatch, address):
    family = socket.AF_INET6 if ":" in address else socket.AF_INET
    monkeypatch.setattr(
        icons.socket, "getaddrinfo", lambda *a, **k: [(family, socket.SOCK_STREAM, 6, "", (address, 443))]
    )
    with pytest.raises(icons.IconError):
        icons._assert_public("https://example.com/")


def test_odd_ports_are_refused():
    with pytest.raises(icons.IconError):
        icons._assert_public("https://example.com:8015/")


def test_rasterize_makes_a_square_png():
    png = icons.rasterize(_png(16))
    image = Image.open(io.BytesIO(png))
    assert image.format == "PNG"
    assert image.size == (icons.ICON_SIZE, icons.ICON_SIZE)
    ico = icons.rasterize(_png(48, fmt="ICO"))
    assert Image.open(io.BytesIO(ico)).size == (icons.ICON_SIZE, icons.ICON_SIZE)


def test_rasterize_refuses_junk():
    assert icons.rasterize(b"<svg xmlns='http://www.w3.org/2000/svg'></svg>") is None
    assert icons.rasterize(b"not an image") is None
    assert icons.rasterize(_png(32, color=(0, 0, 0, 0))) is None


def test_link_ranking_prefers_a_crisp_bitmap():
    parser = icons._IconLinks()
    parser.feed(
        '<link rel="icon" href="/16.png" sizes="16x16">'
        '<link rel="icon" type="image/svg+xml" href="/logo.svg">'
        '<link rel="apple-touch-icon" href="/apple.png">'
        '<link rel="icon" href="/96.png" sizes="96x96">'
    )
    assert parser.ranked() == ["/96.png", "/apple.png", "/16.png"]


def test_website_is_saved_and_icon_follows(
    auth_client, media, monkeypatch, settings, django_capture_on_commit_callbacks
):
    settings.PROJECT_ICONS_ENABLED = True
    monkeypatch.setattr(icons, "fetch_icon", lambda website: icons.rasterize(_png(32)))

    with django_capture_on_commit_callbacks(execute=True):
        created = auth_client.post("/api/v1/projects/", {"name": "MyTasker", "website": "mytasker.io"}, format="json")

    assert created.status_code == 201
    project = Project.objects.get(pk=created.data["id"])
    assert project.website == "https://mytasker.io"
    assert project.icon_file.endswith(".png")
    assert (media / "project-icons" / project.icon_file).exists()
    listed = auth_client.get(f"/api/v1/projects/{project.pk}/").data
    assert listed["icon_url"] == f"/media/project-icons/{project.icon_file}"


def test_changing_the_website_drops_the_old_icon(auth_client, media):
    created = auth_client.post("/api/v1/projects/", {"name": "Old", "website": "old.example"}, format="json").data
    project = Project.objects.get(pk=created["id"])
    Project.objects.filter(pk=project.pk).update(icon_file="abc.png")

    updated = auth_client.patch(f"/api/v1/projects/{project.pk}/", {"website": "new.example"}, format="json")

    assert updated.status_code == 200
    assert updated.data["website"] == "https://new.example"
    assert updated.data["icon_url"] is None
    bad = auth_client.patch(f"/api/v1/projects/{project.pk}/", {"website": "ftp://x.example"}, format="json")
    assert bad.status_code == 400


def test_failed_refresh_keeps_the_icon_when_asked(user, media, monkeypatch):
    project = Project.objects.create(owner=user, name="Kept", website="https://kept.example", icon_file="keep.png")
    monkeypatch.setattr(icons, "fetch_icon", lambda website: None)

    assert icons.refresh_project_icon(project.pk, keep_on_failure=True) == "keep.png"
    assert icons.refresh_project_icon(project.pk) == ""
    project.refresh_from_db()
    assert project.icon_file == ""
    assert project.icon_checked_at is not None


def test_catalog_cards_are_parsed():
    parser = icons._CatalogLinks()
    parser.feed(
        '<a href="https://masting.ai/" class="fab-dot"><span class="fab-dot-ic"><img src="/media/m.png"></span>'
        '<span class="fab-tip">Masting</span></a>'
        '<a href="/about">About</a>'
        '<a href="https://x.io/" class="fab-dot"><span class="fab-tip">No logo</span></a>'
    )
    assert parser.entries == [{"site": "https://masting.ai/", "logo": "/media/m.png", "name": "Masting"}]


@pytest.mark.parametrize(
    ("project", "card", "same"),
    [
        ("Masting AI", "Masting", True),
        ("Mamont", "Mamont Financial Technology", True),
        ("Drogo Pay", "DrogoPay", True),
        ("Zoi Talks", "ZOI Talks", True),
        ("Drog AI", "Drogobet", False),
        ("GNR", "GENORYN", False),
    ],
)
def test_catalog_names_match_projects(project, card, same):
    assert icons.same_project(project, card) is same


def test_a_chosen_logo_wins_over_the_favicon(user, media, monkeypatch):
    project = Project.objects.create(
        owner=user, name="Logo", website="https://logo.example", icon_source="https://cdn.example/l.png"
    )
    monkeypatch.setattr(icons, "fetch_image", lambda url: icons.rasterize(_png(64)))
    monkeypatch.setattr(icons, "fetch_icon", lambda website: pytest.fail("favicon must not be fetched"))

    assert icons.refresh_project_icon(project.pk).endswith(".png")


CARDS = [
    {"name": "Masting", "site": "https://masting.ai/", "logo": "https://drogoz.network/media/m.png"},
    {"name": "DrogoPay", "site": "https://drogopay.com/", "logo": "https://drogoz.network/media/p.png"},
]


@pytest.fixture
def catalog(monkeypatch, media):
    fetched = []
    monkeypatch.setattr(icons, "cached_catalog", lambda: CARDS)
    monkeypatch.setattr(icons, "fetch_image", lambda url: fetched.append(url) or icons.rasterize(_png(64)))
    monkeypatch.setattr(icons, "fetch_icon", lambda website: fetched.append(website) or icons.rasterize(_png(32)))
    return fetched


def _project(client, name, **extra):
    return client.post("/api/v1/projects/", {"name": name, **extra}, format="json").data


def test_find_logo_by_name_in_the_catalog_fills_the_site(auth_client, catalog):
    project = _project(auth_client, "Masting AI")

    found = auth_client.post(f"/api/v1/projects/{project['id']}/find-logo/", {}, format="json")

    assert found.status_code == 200
    assert found.data["found_in"] == "catalog"
    assert found.data["website"] == "https://masting.ai/"
    assert found.data["icon_url"].startswith("/media/project-icons/")
    assert catalog == ["https://drogoz.network/media/m.png"]


def test_typing_drogoz_network_searches_the_catalog(auth_client, catalog):
    project = _project(auth_client, "Drogo Pay")

    found = auth_client.post(
        f"/api/v1/projects/{project['id']}/find-logo/", {"website": "drogoz.network"}, format="json"
    )

    assert found.data["found_in"] == "catalog"
    assert found.data["website"] == "https://drogopay.com/"


def test_an_own_site_uses_its_favicon(auth_client, catalog):
    project = _project(auth_client, "Masting AI")

    found = auth_client.post(
        f"/api/v1/projects/{project['id']}/find-logo/", {"website": "masting.dev"}, format="json"
    )

    assert found.data["found_in"] == "website"
    assert found.data["website"] == "https://masting.dev"
    assert catalog == ["https://masting.dev"]


def test_nothing_found_keeps_the_generated_avatar(auth_client, monkeypatch, media):
    monkeypatch.setattr(icons, "cached_catalog", lambda: [])
    monkeypatch.setattr(icons, "fetch_icon", lambda website: None)
    project = _project(auth_client, "Pokerzor")

    found = auth_client.post(
        f"/api/v1/projects/{project['id']}/find-logo/", {"website": "pokerzor.io"}, format="json"
    )

    assert found.data["found_in"] == ""
    assert found.data["icon_url"] is None


def test_find_logo_needs_manage_rights(auth_client, client_for, stranger, catalog):
    project = _project(auth_client, "Masting AI")

    assert client_for(stranger).post(f"/api/v1/projects/{project['id']}/find-logo/").status_code == 404


def test_a_shared_host_is_not_the_same_site(auth_client, catalog, monkeypatch):
    monkeypatch.setattr(
        icons,
        "cached_catalog",
        lambda: [{"name": "Mamont", "site": "https://github.com/deepdrogo/mamont-tech", "logo": "https://d.n/m.png"}],
    )
    project = _project(auth_client, "Other thing")

    found = auth_client.post(f"/api/v1/projects/{project['id']}/find-logo/", {"website": "github.com"}, format="json")

    assert found.data["found_in"] == "website"
