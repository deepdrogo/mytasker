from __future__ import annotations

from datetime import timedelta
from unittest import mock

import pytest
from django.core.cache import cache
from django.test import override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from apps.security import blocklist, guard
from apps.security.ip import _trusted_networks, ban_network, client_ip
from apps.security.models import BlockedIP, SecurityBotState, SecurityEvent, SignupRecord

BROWSER = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36"
ATTACKER = "45.61.158.21"
SITE = "http://localhost:5173"

SHIELD = override_settings(
    SECURITY_SHIELD_ENABLED=True,
    SECURITY_REQUIRE_ORIGIN=True,
    SECURITY_TRUSTED_IPS=["127.0.0.0/8", "::1", "82.29.181.108"],
    SITE_URL=SITE,
    CSRF_TRUSTED_ORIGINS=[SITE],
)


def _refresh():
    blocklist._local.update(checked=0.0, loaded=0.0, version=None, entries=())


@pytest.fixture(autouse=True)
def clean_state():
    cache.clear()
    _trusted_networks.cache_clear()
    _refresh()
    yield
    cache.clear()
    _trusted_networks.cache_clear()
    _refresh()


def client(ip=ATTACKER, ua=BROWSER, origin=SITE, user=None) -> APIClient:
    api = APIClient(REMOTE_ADDR="127.0.0.1", HTTP_X_REAL_IP=ip, HTTP_USER_AGENT=ua)
    if origin:
        api.credentials(HTTP_ORIGIN=origin)
    if user is not None:
        api.force_authenticate(user=user)
    return api


# ------------------------------------------------------------------------------------------- client ip


def test_client_ip_ignores_forged_forwarded_for(rf):
    request = rf.get("/", REMOTE_ADDR="127.0.0.1", HTTP_X_REAL_IP="203.0.113.9", HTTP_X_FORWARDED_FOR="1.1.1.1")
    assert client_ip(request) == "203.0.113.9"
    direct = rf.get("/", REMOTE_ADDR="198.51.100.4", HTTP_X_REAL_IP="1.1.1.1")
    assert client_ip(direct) == "198.51.100.4"  # X-Real-IP only counts when nginx (loopback) set it


def test_ipv6_bans_cover_the_whole_64():
    assert ban_network("2a09:bac5:1d8f:188c::272:12b") == "2a09:bac5:1d8f:188c::/64"
    assert ban_network("::ffff:1.2.3.4") == "1.2.3.4"


# ------------------------------------------------------------------------------------------- blocklist


@pytest.mark.django_db
@SHIELD
def test_blocked_ip_is_refused():
    blocklist.block(ATTACKER, reason="test")
    _refresh()
    response = client().get("/api/v1/auth/config/")
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "blocked"
    assert client(ip="198.51.100.7").get("/api/v1/auth/config/").status_code == 200


@pytest.mark.django_db
def test_ban_escalates_and_never_shortens():
    first = blocklist.block(ATTACKER, reason="1")
    assert first.offenses == 1 and first.expires_at - timezone.now() < timedelta(hours=1, minutes=1)
    BlockedIP.objects.filter(pk=first.pk).update(expires_at=timezone.now() - timedelta(seconds=1))
    second = blocklist.block(ATTACKER, reason="2")
    assert second.offenses == 2 and second.expires_at - timezone.now() > timedelta(hours=23)
    BlockedIP.objects.filter(pk=first.pk).update(expires_at=timezone.now() - timedelta(seconds=1))
    blocklist.block(ATTACKER, reason="3")
    BlockedIP.objects.filter(pk=first.pk).update(expires_at=timezone.now() - timedelta(seconds=1))
    fourth = blocklist.block(ATTACKER, reason="4")
    assert fourth.offenses == 4 and fourth.expires_at is None


@pytest.mark.django_db
@SHIELD
def test_trusted_addresses_are_never_banned():
    assert blocklist.block("82.29.181.108", reason="nope") is None
    assert client(ip="82.29.181.108", ua="curl/8.5.0").get("/api/v1/auth/config/").status_code == 200


# ------------------------------------------------------------------------------------------- detectors


@pytest.mark.django_db
@SHIELD
def test_curl_on_api_is_refused_and_second_hit_bans():
    api = client(ua="curl/8.5.0")
    assert api.get("/api/v1/auth/config/").status_code == 403
    assert not blocklist.find(ATTACKER)
    assert api.get("/api/v1/projects/").status_code == 403
    _refresh()
    assert blocklist.find(ATTACKER) == ATTACKER
    assert SecurityEvent.objects.filter(kind=SecurityEvent.Kind.AUTO_BAN, ip=ATTACKER).exists()


@pytest.mark.django_db
@SHIELD
def test_bare_mozilla_on_register_bans_at_once():
    client(ua="Mozilla/5.0").post("/api/v1/auth/register/", {"email": "x@example.com"}, format="json")
    _refresh()
    assert blocklist.find(ATTACKER)


@pytest.mark.django_db
@SHIELD
def test_scanner_trap_bans_and_answers_404():
    response = client().get("/api/v1/_trap/", HTTP_X_TRAP_URI="/.env")
    assert response.status_code == 404
    _refresh()
    assert blocklist.find(ATTACKER)
    event = SecurityEvent.objects.get(kind=SecurityEvent.Kind.TRAP)
    assert event.path == "/.env"


@pytest.mark.django_db
@SHIELD
def test_injection_payload_is_refused():
    assert client().get("/api/v1/search/?q=1'+UNION+SELECT+password+FROM+users--").status_code == 403
    assert client(ip="198.51.100.8").get("/api/v1/projects/?x=../../etc/passwd").status_code == 403
    assert SecurityEvent.objects.filter(kind=SecurityEvent.Kind.INJECTION).count() == 2


@pytest.mark.django_db
@SHIELD
def test_scripted_write_without_origin_is_refused(user):
    response = client(origin=None, user=user).post("/api/v1/projects/", {"name": "x"}, format="json")
    assert response.status_code == 403
    assert SecurityEvent.objects.filter(kind=SecurityEvent.Kind.ORIGIN).exists()
    ok = client(user=user).post("/api/v1/projects/", {"name": "x"}, format="json")
    assert ok.status_code == 201


@pytest.mark.django_db
@SHIELD
def test_webhook_needs_no_browser_origin():
    response = client(origin=None, ua="").post("/api/v1/telegram/webhook/", {}, format="json")
    assert response.status_code == 403  # wrong secret, but not refused by the shield
    assert not SecurityEvent.objects.filter(kind__in=["origin", "bad_ua"]).exists()


@pytest.mark.django_db
@SHIELD
def test_walking_object_ids_gets_banned(user):
    api = client(user=user)
    for pid in range(1000, 1030):
        api.get(f"/api/v1/projects/{pid}/")
    _refresh()
    assert blocklist.find(ATTACKER)


@pytest.mark.django_db
@SHIELD
def test_reloading_one_missing_page_is_not_enumeration(user):
    api = client(user=user)
    for _ in range(40):
        api.get("/api/v1/projects/999999/")
    _refresh()
    assert not blocklist.find(ATTACKER)


@pytest.mark.django_db
@SHIELD
def test_linked_assistant_email_guessing_is_banned(user):
    api = client(user=user)
    for n in range(10):
        api.post("/api/v1/auth/assistants/linked/", {"email": f"guess{n}@example.com"}, format="json")
    _refresh()
    assert blocklist.find(ATTACKER)


@pytest.mark.django_db
@SHIELD
def test_failed_logins_add_up_to_a_ban(make_user):
    make_user("victim@example.com")
    api = client()
    for _ in range(9):
        api.post("/api/v1/auth/login/", {"email": "victim@example.com", "password": "wrong-password"}, format="json")
    _refresh()
    assert blocklist.find(ATTACKER)
    assert SecurityEvent.objects.filter(kind=SecurityEvent.Kind.LOGIN_FAILED).exists()


# ------------------------------------------------------------------------------------------- sign-up


REGISTER = {"email": "new@example.com", "password": "Very-Strong-Pass-91", "timezone": "UTC"}


@pytest.mark.django_db
@SHIELD
def test_signup_records_ip_and_honeypot_bans():
    response = client().post("/api/v1/auth/register/", REGISTER, format="json")
    assert response.status_code == 201, response.content
    record = SignupRecord.objects.get(user__email="new@example.com")
    assert record.ip == ATTACKER

    bot = client(ip="198.51.100.20")
    response = bot.post("/api/v1/auth/register/", {**REGISTER, "email": "bot@example.com", "mt_hp": "x"}, format="json")
    assert response.status_code == 400
    _refresh()
    assert blocklist.find("198.51.100.20")


@pytest.mark.django_db
@SHIELD
@override_settings(SECURITY_SIGNUP_LIMITS={"attempts_per_hour": 50, "accounts_per_day": 2, "min_gap_seconds": 0,
                                           "global_per_hour": 100})
def test_one_network_cannot_mass_register():
    for n in range(2):
        api = client(ip="2a09:bac5:1d8f:188c::1")
        response = api.post("/api/v1/auth/register/", {**REGISTER, "email": f"a{n}@example.com"}, format="json")
        assert response.status_code == 201, response.content
    other_host_same_64 = client(ip="2a09:bac5:1d8f:188c::99")
    response = other_host_same_64.post("/api/v1/auth/register/", {**REGISTER, "email": "a9@example.com"}, format="json")
    assert response.status_code == 429


@pytest.mark.django_db
@SHIELD
def test_disposable_mail_is_refused():
    response = client().post("/api/v1/auth/register/", {**REGISTER, "email": "x@mailinator.com"}, format="json")
    assert response.status_code == 400


@pytest.mark.django_db
@SHIELD
def test_register_enforces_csrf():
    api = APIClient(enforce_csrf_checks=True, REMOTE_ADDR="127.0.0.1", HTTP_X_REAL_IP=ATTACKER,
                    HTTP_USER_AGENT=BROWSER, HTTP_ORIGIN=SITE)
    assert api.post("/api/v1/auth/register/", REGISTER, format="json").status_code == 403
    token = api.get("/api/v1/auth/csrf/").json()["csrf_token"]
    response = api.post("/api/v1/auth/register/", REGISTER, format="json", HTTP_X_CSRFTOKEN=token)
    assert response.status_code == 201


# ------------------------------------------------------------------------------------------------ SSRF


def test_websites_must_be_real_domains():
    from apps.projects.icons import UnsafeWebsite, normalize_website

    for probe in ("http://82.29.181.108", "http://[2a02:4780:41:181a::1]/", "http://72.61.20.125.sslip.io/",
                  "http://2a02-4780-41-181a--1.sslip.io/", "srv1184184.hstgr.cloud"):
        with pytest.raises(UnsafeWebsite):
            normalize_website(probe)
    assert normalize_website("example.com") == "https://example.com"


@override_settings(SSRF_DENY_NETWORKS=["82.29.181.0/24"], SECURITY_TRUSTED_IPS=[])
def test_fetch_is_pinned_to_the_validated_address():
    from apps.projects import icons

    with mock.patch("socket.getaddrinfo", return_value=[(2, 1, 6, "", ("93.184.215.14", 443))]):
        assert icons._assert_public("https://example.com/x") == "93.184.215.14"
    with mock.patch("socket.getaddrinfo", return_value=[(2, 1, 6, "", ("82.29.181.108", 443))]):
        with pytest.raises(icons.IconError):
            icons._assert_public("https://evil.example/")
    target, headers, extensions = icons._pinned("https://example.com/favicon.ico", "93.184.215.14")
    assert target == "https://93.184.215.14/favicon.ico"
    assert headers == {"Host": "example.com"} and extensions == {"sni_hostname": "example.com"}


@pytest.mark.django_db
@SHIELD
def test_ip_website_is_flagged_as_ssrf(user, make_project):
    project = make_project(user)
    response = client(user=user).post(f"/api/v1/projects/{project.pk}/find-logo/", {"website": "http://10.0.0.1"},
                                      format="json")
    assert response.status_code == 400
    assert SecurityEvent.objects.filter(kind=SecurityEvent.Kind.SSRF, ip=ATTACKER).exists()


# -------------------------------------------------------------------------------------- leaks / fixes


@pytest.mark.django_db
def test_pending_invite_does_not_reveal_the_account(auth_client, user, other_user, make_project):
    from apps.projects.models import Project

    project = make_project(user, mode=Project.Mode.GROUP)
    response = auth_client.post(f"/api/v1/projects/{project.pk}/members/", {"email": other_user.email}, format="json")
    assert response.status_code == 201
    assert response.json()["user"] is None


@pytest.mark.django_db
def test_telegram_deliveries_list_works(auth_client):
    assert auth_client.get("/api/v1/telegram/deliveries/").status_code == 200


# ----------------------------------------------------------------------------------------------- purge


@pytest.mark.django_db
def test_purge_deletes_everything_and_bans(make_user, make_project):
    from apps.accounts.models import User
    from apps.projects.models import Project
    from apps.security.purge import PurgeRefused, purge_user

    hostile = make_user("nlab@example.com")
    make_project(hostile, name="nlab")
    SignupRecord.objects.create(user=hostile, ip=ATTACKER)
    result = purge_user(hostile.pk, actor="test")
    assert not User.objects.filter(pk=hostile.pk).exists()
    assert not Project.all_objects.filter(name="nlab").exists()
    assert result["banned"] == [ATTACKER]
    assert BlockedIP.objects.get(network=ATTACKER).expires_at - timezone.now() > timedelta(days=29)

    admin = make_user("boss@example.com", is_staff=True)
    with pytest.raises(PurgeRefused):
        purge_user(admin.pk)


# ------------------------------------------------------------------------------------------------- bot


@pytest.mark.django_db
def test_bot_binds_owner_by_username_then_only_by_id():
    from apps.security.bot import SecurityBot

    bot = SecurityBot(token="t", owner_username="drogoz")
    bot.client = mock.Mock()
    stranger = {"id": 666, "username": "evil"}
    owner = {"id": 42, "username": "drogoz"}
    private = lambda uid: {"id": uid, "type": "private"}  # noqa: E731

    bot.handle({"update_id": 1, "message": {"from": stranger, "chat": private(666), "text": "/status"}})
    assert SecurityBotState.load().owner_user_id is None
    assert SecurityEvent.objects.filter(kind=SecurityEvent.Kind.BOT_INTRUDER).count() == 1

    bot.handle({"update_id": 2, "message": {"from": owner, "chat": private(42), "text": "/start"}})
    state = SecurityBotState.load()
    assert state.owner_user_id == 42 and state.owner_chat_id == 42

    squatter = {"id": 777, "username": "drogoz"}  # someone grabs the username later
    bot.client.reset_mock()
    bot.handle({"update_id": 3, "message": {"from": squatter, "chat": private(777), "text": "/blocked"}})
    sent_to = [call.args[0] for call in bot.client.send_message.call_args_list]
    assert 777 not in sent_to


@pytest.mark.django_db
def test_bot_commands_block_and_unblock():
    from apps.security.bot import SecurityBot

    SecurityBotState.objects.update_or_create(pk=1, defaults={"owner_user_id": 42, "owner_chat_id": 42})
    bot = SecurityBot(token="t", owner_username="drogoz")
    bot.client = mock.Mock()
    msg = lambda text: {"update_id": 9, "message": {"from": {"id": 42}, "chat": {"id": 42, "type": "private"},  # noqa: E731
                                                     "text": text}}
    bot.handle(msg(f"/block {ATTACKER} 48 test"))
    row = BlockedIP.objects.get(network=ATTACKER)
    assert row.is_active and row.source == BlockedIP.Source.BOT
    bot.handle(msg(f"/unblock {ATTACKER}"))
    row.refresh_from_db()
    assert not row.is_active
    bot.handle(msg("/block 82.29.181.0/8"))  # far too wide
    assert not BlockedIP.objects.filter(network__startswith="82.").exists()


def test_guard_score_window():
    cache.clear()
    assert guard.add_points("203.0.113.1", 30) == 30
    assert guard.add_points("203.0.113.1", 30) == 60
    guard.reset_score("203.0.113.1")
    assert guard.score("203.0.113.1") == 0
