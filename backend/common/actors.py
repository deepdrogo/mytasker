"""
Actor model: who performed an action, and through which channel.

Every service-layer mutation receives an Actor so activity, audit, notifications and
analytics can attribute it consistently (account user, team member, guest, AI, Telegram, system).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any

from common.models import Source

if TYPE_CHECKING:
    from apps.accounts.models import User
    from apps.sharing.models import ShareGuestSession


class ActorKind:
    USER = "user"
    GUEST = "guest"
    AI = "ai"
    TELEGRAM = "telegram"
    SYSTEM = "system"


@dataclass(frozen=True)
class Actor:
    kind: str
    user: User | None = None
    guest_session: ShareGuestSession | None = None
    source: str = Source.WEB
    display_name_override: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)

    # ---- factories -------------------------------------------------------
    @classmethod
    def from_user(cls, user: User, source: str = Source.WEB) -> Actor:
        return cls(kind=ActorKind.USER, user=user, source=source)

    @classmethod
    def from_request(cls, request) -> Actor:
        source = getattr(request, "client_source", Source.WEB)
        return cls(kind=ActorKind.USER, user=request.user, source=source)

    @classmethod
    def ai(cls, user: User, source: str = Source.AI_WEB) -> Actor:
        return cls(kind=ActorKind.AI, user=user, source=source)

    @classmethod
    def telegram(cls, user: User) -> Actor:
        return cls(kind=ActorKind.TELEGRAM, user=user, source=Source.TELEGRAM)

    @classmethod
    def guest(cls, session: ShareGuestSession) -> Actor:
        return cls(kind=ActorKind.GUEST, guest_session=session, source=Source.SHARE_LINK)

    @classmethod
    def system(cls) -> Actor:
        return cls(kind=ActorKind.SYSTEM, source=Source.SYSTEM)

    # ---- derived -----------------------------------------------------------
    @property
    def user_id(self) -> int | None:
        return self.user.pk if self.user is not None else None

    @property
    def display_name(self) -> str:
        if self.display_name_override:
            return self.display_name_override
        if self.kind == ActorKind.GUEST:
            name = (self.guest_session.guest_name if self.guest_session else "") or ""
            return name.strip() or "Guest"
        if self.kind == ActorKind.SYSTEM:
            return "MyTasker"
        if self.user is not None:
            return self.user.display_name
        return "Unknown"

    @property
    def is_guest(self) -> bool:
        return self.kind == ActorKind.GUEST

    @property
    def is_ai(self) -> bool:
        return self.kind == ActorKind.AI

    def as_activity_fields(self) -> dict[str, Any]:
        return {
            "actor_kind": self.kind,
            "actor_user": self.user,
            "actor_guest": self.guest_session,
            "actor_display": self.display_name,
            "source": self.source,
        }
