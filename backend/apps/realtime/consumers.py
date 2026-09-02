"""
Single authenticated WebSocket endpoint: ws/app/

Groups joined on connect:
  - user.<id>        personal channel: notifications, timer sync, own task/prompt changes, AI status
  - project.<id>     one per project the user can view (group / group_plus membership)

Private (Group Plus) payloads are never published to project.* groups; the publisher sends them
only to the owner's personal channel. See apps/realtime/publisher.py.
"""

from __future__ import annotations

import logging

from channels.db import database_sync_to_async
from channels.generic.websocket import AsyncJsonWebsocketConsumer

logger = logging.getLogger("mytasker.ws")


def user_group(user_id: int) -> str:
    return f"user.{user_id}"


def project_group(project_id: int) -> str:
    return f"project.{project_id}"


class AppConsumer(AsyncJsonWebsocketConsumer):
    groups: list[str] = []

    async def connect(self) -> None:
        user = self.scope.get("user")
        if user is None or not user.is_authenticated:
            await self.close(code=4401)
            return
        self.user_id = user.pk
        self.joined: list[str] = [user_group(self.user_id)]
        project_ids = await self._visible_project_ids(self.user_id)
        self.joined.extend(project_group(pid) for pid in project_ids)
        for group in self.joined:
            await self.channel_layer.group_add(group, self.channel_name)
        await self.accept()
        await self.send_json({"type": "connected", "user_id": self.user_id, "projects": project_ids})

    async def disconnect(self, code) -> None:  # noqa: D401
        for group in getattr(self, "joined", []):
            await self.channel_layer.group_discard(group, self.channel_name)

    async def receive_json(self, content, **kwargs) -> None:
        action = content.get("type")
        if action == "ping":
            await self.send_json({"type": "pong", "t": content.get("t")})
        elif action == "resync":
            project_ids = await self._visible_project_ids(self.user_id)
            for group in [g for g in self.joined if g.startswith("project.")]:
                await self.channel_layer.group_discard(group, self.channel_name)
            self.joined = [user_group(self.user_id)] + [project_group(pid) for pid in project_ids]
            for group in self.joined:
                await self.channel_layer.group_add(group, self.channel_name)
            await self.send_json({"type": "resynced", "projects": project_ids})

    # Channel layer handler: {"type": "broadcast", "payload": {...}}
    async def broadcast(self, message) -> None:
        await self.send_json(message["payload"])

    @staticmethod
    @database_sync_to_async
    def _visible_project_ids(user_id: int) -> list[int]:
        from django.db.models import Q

        from apps.projects.models import Project

        return list(
            Project.objects.filter(
                Q(owner_id=user_id) | Q(memberships__user_id=user_id, memberships__accepted_at__isnull=False)
            )
            .distinct()
            .values_list("id", flat=True)
        )
