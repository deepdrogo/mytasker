from datetime import timedelta

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from apps.sharing.models import ShareLink

pytestmark = pytest.mark.django_db


def _share(client, task_ids, **extra):
    payload = {"task_ids": task_ids, **extra}
    res = client.post("/api/v1/shares/", payload, format="json")
    assert res.status_code == 201, res.content
    token = res.data["url"].rsplit("/s/", 1)[1]
    return res.data, token


def _task(client, title="Shared task", **kw):
    return client.post("/api/v1/tasks/", {"title": title, "kind": "personal", **kw}, format="json").data


def test_token_is_hashed_and_guest_can_complete(auth_client):
    task = _task(auth_client)
    sub = _task(auth_client, "Sub", parent_id=task["id"])
    data, token = _share(auth_client, [task["id"]], ask_guest_name=True)
    assert ShareLink.objects.get(pk=data["id"]).token_hash != token
    assert token not in str(ShareLink.objects.get(pk=data["id"]).__dict__)

    guest = APIClient()
    view = guest.get(f"/api/v1/share/{token}/")
    assert view.status_code == 200
    session = view.data["session_token"]
    assert view.data["tasks"][0]["title"] == "Shared task"
    assert view.data["tasks"][0]["subtasks"][0]["id"] == sub["id"]
    # Guests never see internal fields.
    assert "owner" not in view.data["tasks"][0]
    assert "notes" not in view.data["tasks"][0]

    # Name is required before completing when ask_guest_name=True.
    blocked = guest.post(f"/api/v1/share/{token}/tasks/{task['id']}/complete/", HTTP_X_SHARE_SESSION=session)
    assert blocked.status_code == 400
    guest.post(f"/api/v1/share/{token}/identify/", {"name": "Nino"}, format="json", HTTP_X_SHARE_SESSION=session)
    done = guest.post(f"/api/v1/share/{token}/tasks/{task['id']}/complete/", HTTP_X_SHARE_SESSION=session)
    assert done.status_code == 200, done.content
    assert done.data["tasks"][0]["status"] == "done"
    assert done.data["tasks"][0]["completed_by_name"] == "Nino"

    # Owner sees who completed it and the source.
    owner_view = auth_client.get(f"/api/v1/tasks/{task['id']}/")
    assert owner_view.data["completion_source"] == "share_link"
    assert owner_view.data["completed_by_name"] == "Nino"

    # Reopen is disabled by default.
    assert (
        guest.post(f"/api/v1/share/{token}/tasks/{task['id']}/reopen/", HTTP_X_SHARE_SESSION=session).status_code
        == 403
    )

    # Guests cannot touch tasks outside the share even with a valid session.
    other = _task(auth_client, "Not shared")
    assert (
        guest.post(f"/api/v1/share/{token}/tasks/{other['id']}/complete/", HTTP_X_SHARE_SESSION=session).status_code
        == 404
    )

    feed = auth_client.get("/api/v1/activity/").data["results"]
    assert any(row["name"] == "share.task_completed" and row["actor_display"] == "Nino" for row in feed)


def test_password_protection(auth_client):
    task = _task(auth_client)
    _, token = _share(auth_client, [task["id"]], password="secret1", ask_guest_name=False)
    guest = APIClient()
    view = guest.get(f"/api/v1/share/{token}/")
    assert view.status_code == 200
    assert view.data["requires_password"] is True
    assert view.data["tasks"] == []
    assert "session_token" not in view.data

    assert guest.post(f"/api/v1/share/{token}/unlock/", {"password": "wrong"}, format="json").status_code == 403
    ok = guest.post(f"/api/v1/share/{token}/unlock/", {"password": "secret1"}, format="json")
    assert ok.status_code == 200
    assert ok.data["tasks"][0]["id"] == task["id"]
    session = ok.data["session_token"]
    done = guest.post(f"/api/v1/share/{token}/tasks/{task['id']}/complete/", HTTP_X_SHARE_SESSION=session)
    assert done.status_code == 200


def test_expiry_revoke_and_one_time(auth_client):
    task = _task(auth_client)
    _, expired = _share(auth_client, [task["id"]], expires_at=(timezone.now() + timedelta(seconds=1)).isoformat())
    ShareLink.objects.update(expires_at=timezone.now() - timedelta(seconds=1))
    assert APIClient().get(f"/api/v1/share/{expired}/").status_code == 403

    data, token = _share(auth_client, [task["id"]], one_time=True, ask_guest_name=False)
    first = APIClient()
    view = first.get(f"/api/v1/share/{token}/")
    assert view.status_code == 200
    session = view.data["session_token"]
    # Same guest session keeps working...
    assert first.get(f"/api/v1/share/{token}/", HTTP_X_SHARE_SESSION=session).status_code == 200
    # ...but a fresh visitor is refused.
    assert APIClient().get(f"/api/v1/share/{token}/").status_code == 403

    data2, token2 = _share(auth_client, [task["id"]])
    auth_client.post(f"/api/v1/shares/{data2['id']}/revoke/")
    assert APIClient().get(f"/api/v1/share/{token2}/").status_code == 403
    assert APIClient().get("/api/v1/share/does-not-exist/").status_code == 404


def test_cannot_share_foreign_task(client_for, user, stranger):
    task = _task(client_for(user))
    res = client_for(stranger).post("/api/v1/shares/", {"task_ids": [task["id"]]}, format="json")
    assert res.status_code == 403
