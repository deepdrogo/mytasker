from __future__ import annotations

import pytest
from django.utils import timezone

from apps.notifications.models import Notification
from apps.tasks.models import Task
from apps.telegram import services
from apps.telegram.client import TelegramError
from apps.telegram.models import TelegramConnection, TelegramDelivery, TelegramUpdateLog
from common.exceptions import NotFound

pytestmark = pytest.mark.django_db(transaction=True)


class FakeClient:
    def __init__(self, fail_times: int = 0, permanent: bool = False):
        self.sent = []
        self.fail_times = fail_times
        self.permanent = permanent
        self.configured = True
        self.edited = []
        self.answered = []

    def send_message(self, chat_id, text, *, parse_mode="HTML", reply_markup=None, disable_notification=False):
        if self.fail_times > 0:
            self.fail_times -= 1
            raise TelegramError("boom", status_code=403 if self.permanent else 500, permanent=self.permanent)
        self.sent.append({"chat_id": chat_id, "text": text, "reply_markup": reply_markup})
        return {"message_id": len(self.sent)}

    def edit_message_text(self, chat_id, message_id, text, *, parse_mode="HTML", reply_markup=None):
        self.edited.append({"chat_id": chat_id, "message_id": message_id, "text": text})
        return {}

    def answer_callback_query(self, callback_query_id, text="", show_alert=False):
        self.answered.append(text)

    def set_my_commands(self, commands):
        return True


@pytest.fixture
def fake_client(monkeypatch):
    fake = FakeClient()
    monkeypatch.setattr("apps.telegram.services.client", fake)
    monkeypatch.setattr("apps.telegram.tasks.client", fake)
    return fake


@pytest.fixture
def linked(user, fake_client):
    TelegramConnection.objects.create(user=user, chat_id=555, linked_at=timezone.now(), is_active=True)
    return user


def test_linking_flow(auth_client, user, fake_client, settings):
    settings.TELEGRAM_BOT_USERNAME = "MyTaskerBot"
    settings.TELEGRAM_WEBHOOK_SECRET = "s3cret"
    res = auth_client.post("/api/v1/telegram/link/")
    assert res.status_code == 201
    token = res.data["token"]
    assert res.data["deep_link"].endswith(f"?start={token}")
    assert token not in str(TelegramConnection.objects.get(user=user).__dict__)

    # Webhook without the secret header is refused; with it, the /start links the chat.
    update = {
        "update_id": 1,
        "message": {
            "message_id": 1,
            "chat": {"id": 777},
            "from": {"id": 42, "username": "nino"},
            "text": f"/start {token}",
        },
    }
    assert auth_client.post("/api/v1/telegram/webhook/", update, format="json").status_code == 403
    ok = auth_client.post(
        "/api/v1/telegram/webhook/", update, format="json", HTTP_X_TELEGRAM_BOT_API_SECRET_TOKEN="s3cret"
    )
    assert ok.status_code == 200
    connection = TelegramConnection.objects.get(user=user)
    assert connection.is_linked and connection.chat_id == 777 and connection.username == "nino"
    assert fake_client.sent and "Linked as" in fake_client.sent[0]["text"]
    # Redelivered update_id is ignored.
    dup = auth_client.post(
        "/api/v1/telegram/webhook/", update, format="json", HTTP_X_TELEGRAM_BOT_API_SECRET_TOKEN="s3cret"
    )
    assert dup.data.get("duplicate") is True
    assert TelegramUpdateLog.objects.count() == 1
    # Reusing the token fails.
    with pytest.raises(NotFound):
        services.complete_linking(token, chat_id=1, telegram_user_id=1, username="", first_name="")


def test_delivery_is_idempotent(linked, fake_client):
    d1 = services.queue_message(linked, text="hello", idempotency_key="k1")
    d2 = services.queue_message(linked, text="hello again", idempotency_key="k1")
    assert d1.pk == d2.pk
    assert TelegramDelivery.objects.count() == 1
    assert len(fake_client.sent) == 1  # eager Celery sent exactly once
    # Re-running the send for a delivered row is a no-op.
    assert services.perform_send(d1.pk) == "delivered"
    assert len(fake_client.sent) == 1


def test_delivery_retries_then_succeeds(linked, fake_client):
    fake_client.fail_times = 1
    from celery.exceptions import Retry

    with pytest.raises((TelegramError, Retry)):
        services.queue_message(linked, text="flaky", idempotency_key="k2")  # eager task propagates the retry
    delivery = TelegramDelivery.objects.get(idempotency_key="k2")
    assert delivery.status == "retrying" and delivery.attempts == 1
    assert services.perform_send(delivery.pk) == "delivered"
    delivery.refresh_from_db()
    assert delivery.attempts == 2 and delivery.telegram_message_id == 1


def test_blocked_bot_deactivates_connection(linked, fake_client):
    fake_client.fail_times = 1
    fake_client.permanent = True
    services.queue_message(linked, text="x", idempotency_key="k3")
    assert TelegramDelivery.objects.get(idempotency_key="k3").status == "failed"
    assert TelegramConnection.objects.get(user=linked).is_active is False


def test_commands_add_done_timer(linked, fake_client, user):
    from apps.telegram.commands import handle_callback, handle_text

    reply, markup = handle_text(user, "/add Call Nino tomorrow 15:00 !high #business")
    assert "Added" in reply
    task = Task.objects.get(title="Call Nino")
    assert task.kind == "business" and task.priority == "high" and task.due_has_time
    assert task.completion_source == ""

    reply, _ = handle_text(user, "/list")
    assert f"#{task.pk}" in reply

    text, markup, toast = handle_callback(user, f"done:{task.pk}")
    assert toast == "Done"
    task.refresh_from_db()
    assert task.status == "done" and task.completion_source == "telegram"

    reply, _ = handle_text(user, "/timer business")
    assert "started" in reply
    reply, _ = handle_text(user, "/timer stop")
    assert "Stopped" in reply
    reply, _ = handle_text(user, "/summary")
    assert "Evening review" in reply


def test_reminder_dispatch_creates_notification_and_telegram(linked, fake_client, user):
    from datetime import timedelta

    from apps.tasks.models import Reminder
    from apps.telegram.tasks import dispatch_due_reminders

    task = Task.objects.create(owner=user, created_by=user, title="Pay rent", kind="personal")
    Reminder.objects.create(user=user, task=task, remind_at=timezone.now() - timedelta(minutes=1), message="Pay rent")
    assert dispatch_due_reminders() == 1
    assert dispatch_due_reminders() == 0  # idempotent
    assert Notification.objects.filter(user=user, category="reminder").count() == 1
    assert any("Pay rent" in s["text"] for s in fake_client.sent)
    assert fake_client.sent[-1]["reply_markup"] is not None  # inline Done/snooze buttons


def test_notification_fan_out_for_team_and_guest(client_for, user, other_user, fake_client):
    owner, member = client_for(user), client_for(other_user)
    project = owner.post("/api/v1/projects/", {"name": "Team", "mode": "group"}, format="json").data
    invite = owner.post(
        f"/api/v1/projects/{project['id']}/members/", {"email": other_user.email, "role": "member"}, format="json"
    )
    assert invite.status_code == 201, invite.content
    token = invite.data["invite_url"].split("token=")[1]
    join = member.post("/api/v1/projects/join/", {"token": token}, format="json")
    assert join.status_code == 200, join.content
    # Owner is notified that a member joined.
    assert Notification.objects.filter(user=user, event_name="project.member_joined").exists()

    task = owner.post(
        "/api/v1/tasks/", {"title": "Shared", "kind": "business", "project_id": project["id"]}, format="json"
    ).data
    member.post(f"/api/v1/tasks/{task['id']}/complete/")
    note = Notification.objects.filter(user=user, event_name="task.completed").first()
    assert note is not None and "completed" in note.title
    # The actor never notifies themselves.
    assert not Notification.objects.filter(user=other_user, event_name="task.completed").exists()

    unread = owner.get("/api/v1/notifications/unread/").data["unread"]
    assert unread >= 2
    owner.post("/api/v1/notifications/read/", {}, format="json")
    assert owner.get("/api/v1/notifications/unread/").data["unread"] == 0

    # Preferences: switching to custom with everything off silences new events.
    owner.patch(
        "/api/v1/notifications/preferences/",
        {"mode": "custom", "on_task_created": False, "on_comment_created": False},
        format="json",
    )
    member.post("/api/v1/comments/", {"body": "hi", "task_id": task["id"]}, format="json")
    assert not Notification.objects.filter(user=user, event_name="comment.created").exists()
