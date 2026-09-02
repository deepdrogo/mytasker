"""Shared pytest fixtures."""

from __future__ import annotations

import pytest
from django.utils import timezone
from rest_framework.test import APIClient


@pytest.fixture
def api() -> APIClient:
    return APIClient()


@pytest.fixture
def make_user(db):
    from apps.accounts.models import User

    counter = {"n": 0}

    def _make(email: str | None = None, password: str = "TestPass!2345", **extra):
        counter["n"] += 1
        email = email or f"user{counter['n']}@example.com"
        extra.setdefault("email_verified_at", timezone.now())
        extra.setdefault("full_name", email.split("@")[0].title())
        user = User.objects.create_user(email=email, password=password, **extra)
        user.raw_password = password  # test convenience
        return user

    return _make


@pytest.fixture
def user(make_user):
    return make_user("owner@example.com")


@pytest.fixture
def other_user(make_user):
    return make_user("member@example.com")


@pytest.fixture
def stranger(make_user):
    return make_user("stranger@example.com")


@pytest.fixture
def auth_client(api, user):
    api.force_authenticate(user=user)
    return api


@pytest.fixture
def client_for(api):
    def _for(u):
        client = APIClient()
        client.force_authenticate(user=u)
        return client

    return _for


@pytest.fixture
def make_project(db):
    from apps.projects.models import Project

    def _make(owner, name="Project", mode=Project.Mode.PRIVATE, **extra):
        return Project.objects.create(owner=owner, name=name, mode=mode, **extra)

    return _make


@pytest.fixture
def add_member(db):
    from apps.projects.models import ProjectMembership

    def _add(project, user, role=ProjectMembership.Role.MEMBER, accepted=True):
        return ProjectMembership.objects.create(
            project=project,
            user=user,
            role=role,
            accepted_at=timezone.now() if accepted else None,
        )

    return _add
