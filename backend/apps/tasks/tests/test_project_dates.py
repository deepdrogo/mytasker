"""Tasks without dates of their own follow the project's calendar span."""

from datetime import date

import pytest

from apps.tasks.models import Task
from common.tz import local_date

pytestmark = pytest.mark.django_db

PROJECTS = "/api/v1/projects/"
TASKS = "/api/v1/tasks/"


def _local_span(task: Task):
    task.refresh_from_db()
    return local_date(task.start_at, task.owner), local_date(task.due_at, task.owner)


def _schedule(client, project_id, start, end):
    version = client.get(f"{PROJECTS}{project_id}/").data["version"]
    res = client.patch(
        f"{PROJECTS}{project_id}/", {"start_date": start, "deadline": end, "version": version}, format="json"
    )
    assert res.status_code == 200, res.content
    return res


@pytest.fixture
def project_with_tasks(auth_client, user):
    user.timezone = "Asia/Tbilisi"
    user.save(update_fields=["timezone"])
    pid = auth_client.post(PROJECTS, {"name": "Launch"}, format="json").data["id"]
    undated = auth_client.post(TASKS, {"title": "Undated", "project_id": pid}, format="json").data["id"]
    own = auth_client.post(
        TASKS, {"title": "Own", "project_id": pid, "due_at": "2026-12-01T19:59:00Z"}, format="json"
    ).data["id"]
    return pid, Task.objects.get(pk=undated), Task.objects.get(pk=own)


def test_drawing_the_project_dates_its_undated_tasks(auth_client, project_with_tasks):
    pid, undated, own = project_with_tasks
    _schedule(auth_client, pid, "2026-10-02", "2026-10-10")

    assert _local_span(undated) == (date(2026, 10, 2), date(2026, 10, 10))
    assert undated.dates_from_project is True
    assert undated.due_has_time is False
    # A date set on the task itself is never overwritten.
    assert _local_span(own) == (None, date(2026, 12, 1))
    assert own.dates_from_project is False

    body = auth_client.get(f"{TASKS}{undated.pk}/").data
    assert body["dates_from_project"] is True
    assert body["start_at"] and body["due_at"]


def test_moving_stretching_and_removing_the_bar_follows_through(auth_client, project_with_tasks):
    pid, undated, _ = project_with_tasks
    _schedule(auth_client, pid, "2026-10-02", "2026-10-10")
    _schedule(auth_client, pid, "2026-10-05", "2026-10-20")
    assert _local_span(undated) == (date(2026, 10, 5), date(2026, 10, 20))

    # Open-ended bar: a start and no deadline.
    _schedule(auth_client, pid, "2026-10-05", None)
    assert _local_span(undated) == (date(2026, 10, 5), None)

    _schedule(auth_client, pid, None, None)
    assert _local_span(undated) == (None, None)
    assert undated.dates_from_project is False


def test_new_and_moved_tasks_pick_up_the_project_span(auth_client, project_with_tasks):
    pid, _, _ = project_with_tasks
    _schedule(auth_client, pid, "2026-10-02", "2026-10-10")

    created = auth_client.post(TASKS, {"title": "Later", "project_id": pid}, format="json").data
    assert created["dates_from_project"] is True
    assert _local_span(Task.objects.get(pk=created["id"])) == (date(2026, 10, 2), date(2026, 10, 10))

    loose = auth_client.post(TASKS, {"title": "Loose", "kind": "business"}, format="json").data["id"]
    moved = auth_client.post(f"{TASKS}{loose}/move/", {"project_id": pid}, format="json")
    assert moved.data["dates_from_project"] is True

    back = auth_client.post(f"{TASKS}{loose}/move/", {"kind": "business"}, format="json")
    assert back.data["dates_from_project"] is False
    assert back.data["start_at"] is None and back.data["due_at"] is None


def test_editing_a_borrowed_date_makes_it_the_tasks_own(auth_client, project_with_tasks):
    pid, undated, _ = project_with_tasks
    _schedule(auth_client, pid, "2026-10-02", "2026-10-10")
    undated.refresh_from_db()

    # The editor re-sends unchanged dates with every save: that keeps the link.
    same = auth_client.patch(
        f"{TASKS}{undated.pk}/",
        {"title": "Renamed", "start_at": undated.start_at.isoformat(), "due_at": undated.due_at.isoformat()},
        format="json",
    )
    assert same.data["dates_from_project"] is True

    own = auth_client.patch(f"{TASKS}{undated.pk}/", {"due_at": "2026-10-07T19:59:00Z"}, format="json")
    assert own.data["dates_from_project"] is False
    _schedule(auth_client, pid, "2026-11-02", "2026-11-10")
    assert _local_span(undated)[1] == date(2026, 10, 7)

    # Clearing the task's dates hands it back to the project calendar.
    cleared = auth_client.patch(f"{TASKS}{undated.pk}/", {"start_at": None, "due_at": None}, format="json")
    assert cleared.data["dates_from_project"] is True
    assert _local_span(undated) == (date(2026, 11, 2), date(2026, 11, 10))


def test_done_ongoing_and_subtasks_stay_out(auth_client, project_with_tasks):
    pid, undated, _ = project_with_tasks
    auth_client.post(f"{TASKS}{undated.pk}/complete/")
    ongoing = auth_client.post(TASKS, {"title": "Daily", "project_id": pid, "is_ongoing": True}, format="json")
    parent = auth_client.post(TASKS, {"title": "Parent", "project_id": pid, "due_at": "2026-12-01T19:59:00Z"}).data
    child = auth_client.post(f"{TASKS}{parent['id']}/subtasks/", {"title": "Child"}, format="json").data

    _schedule(auth_client, pid, "2026-10-02", "2026-10-10")

    assert _local_span(undated) == (None, None)
    assert _local_span(Task.objects.get(pk=ongoing.data["id"])) == (None, None)
    assert _local_span(Task.objects.get(pk=child["id"])) == (None, None)

    # Reopened work rejoins the project calendar.
    reopened = auth_client.post(f"{TASKS}{undated.pk}/reopen/")
    assert reopened.data["dates_from_project"] is True
    assert _local_span(undated) == (date(2026, 10, 2), date(2026, 10, 10))


def test_marking_a_borrowing_task_long_term_drops_the_dates(auth_client, project_with_tasks):
    pid, undated, _ = project_with_tasks
    _schedule(auth_client, pid, "2026-10-02", "2026-10-10")
    res = auth_client.patch(f"{TASKS}{undated.pk}/", {"is_ongoing": True}, format="json")
    assert res.data["dates_from_project"] is False
    assert res.data["due_at"] is None


def test_borrowed_dates_show_on_the_task_calendar_and_views(auth_client, project_with_tasks):
    pid, undated, _ = project_with_tasks
    _schedule(auth_client, pid, "2026-10-02", "2026-10-10")
    ids = {
        row["id"]
        for row in auth_client.get(f"{TASKS}?span_from=2026-10-05&span_to=2026-10-05&top_level=true").data["results"]
    }
    assert undated.pk in ids
    no_date = {row["id"] for row in auth_client.get(f"{TASKS}?view=no_date").data["results"]}
    assert undated.pk not in no_date


def test_backwards_project_span_is_rejected(auth_client):
    pid = auth_client.post(PROJECTS, {"name": "Oops"}, format="json").data["id"]
    res = auth_client.patch(
        f"{PROJECTS}{pid}/", {"start_date": "2026-10-10", "deadline": "2026-10-02"}, format="json"
    )
    assert res.status_code == 400
    created = auth_client.post(PROJECTS, {"name": "Nope", "start_date": "2026-10-10", "deadline": "2026-10-02"})
    assert created.status_code == 400
