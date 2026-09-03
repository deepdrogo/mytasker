from __future__ import annotations

from rest_framework import status
from rest_framework.decorators import api_view, permission_classes, throttle_classes
from rest_framework.response import Response

from apps.ai import services
from apps.ai.access import IsAIUser, ai_allowed
from apps.ai.models import AIAction
from apps.ai.provider import LLMError, LLMNotConfigured, is_configured
from common.actors import Actor
from common.exceptions import DomainError
from common.throttling import AICommandThrottle, AIHeavyThrottle


class AIUnavailable(DomainError):
    code = "ai_unavailable"
    status_code = status.HTTP_503_SERVICE_UNAVAILABLE


def _guard(fn):
    try:
        return fn()
    except LLMNotConfigured as exc:
        raise AIUnavailable(str(exc) or "AI is not configured.", code="ai_not_configured") from exc
    except LLMError as exc:
        raise AIUnavailable(str(exc)) from exc


def _action(action: AIAction) -> dict:
    return {
        "id": action.pk,
        "status": action.status,
        "input_text": action.input_text,
        "reply_text": action.reply_text,
        "tool_calls": action.tool_calls,
        "result": action.result,
        "requires_confirmation": action.requires_confirmation,
        "error": action.error,
        "source": action.source,
        "created_at": action.created_at,
        "duration_ms": action.duration_ms,
    }


@api_view(["GET"])
def status_view(request):
    """Reachable by any signed-in user so the SPA can explain *why* AI is hidden."""
    allowed = ai_allowed(request.user)
    return Response({"configured": is_configured(), "allowed": allowed, "enabled": allowed and is_configured()})


@api_view(["POST"])
@permission_classes([IsAIUser])
@throttle_classes([AICommandThrottle])
def command(request):
    text = str(request.data.get("text", ""))
    history = request.data.get("history") if isinstance(request.data.get("history"), list) else None
    result = _guard(lambda: services.run_command(Actor.from_request(request), text, source="web", history=history))
    return Response(result)


@api_view(["POST"])
@permission_classes([IsAIUser])
def confirm(request, pk: int):
    result = _guard(lambda: services.confirm_action(request.user, int(pk)))
    return Response(result)


@api_view(["POST"])
@permission_classes([IsAIUser])
def reject(request, pk: int):
    action = services.reject_action(request.user, int(pk))
    return Response(_action(action))


@api_view(["GET"])
@permission_classes([IsAIUser])
def history(request):
    rows = AIAction.objects.filter(user=request.user)[:30]
    return Response([_action(a) for a in rows])


@api_view(["POST"])
@permission_classes([IsAIUser])
@throttle_classes([AIHeavyThrottle])
def improve_task(request, pk: int):
    return Response(_guard(lambda: services.improve_task(request.user, int(pk))))


@api_view(["POST"])
@permission_classes([IsAIUser])
@throttle_classes([AIHeavyThrottle])
def polish_tasks(request):
    task_ids = request.data.get("task_ids")
    if not isinstance(task_ids, list):
        from common.exceptions import ValidationFailed

        raise ValidationFailed("task_ids must be a list.")
    return Response(_guard(lambda: services.polish_tasks(request.user, task_ids)))


@api_view(["POST"])
@permission_classes([IsAIUser])
@throttle_classes([AIHeavyThrottle])
def break_down(request, pk: int):
    return Response(_guard(lambda: services.break_down(request.user, int(pk))))


@api_view(["POST"])
@permission_classes([IsAIUser])
def apply_breakdown(request, pk: int):
    subtasks = request.data.get("subtasks")
    if not isinstance(subtasks, list):
        from common.exceptions import ValidationFailed

        raise ValidationFailed("subtasks must be a list.")
    created = services.apply_breakdown(request.user, int(pk), subtasks)
    return Response({"created": created}, status=status.HTTP_201_CREATED)


@api_view(["POST"])
@permission_classes([IsAIUser])
@throttle_classes([AIHeavyThrottle])
def plan_day(request):
    return Response(_guard(lambda: services.plan_day(request.user)))


@api_view(["POST"])
@permission_classes([IsAIUser])
@throttle_classes([AIHeavyThrottle])
def improve_prompt(request, pk: int):
    goal = str(request.data.get("goal", ""))
    return Response(_guard(lambda: services.improve_prompt(request.user, int(pk), goal=goal)))


@api_view(["POST"])
@permission_classes([IsAIUser])
@throttle_classes([AIHeavyThrottle])
def improve_idea(request, pk: int):
    return Response(_guard(lambda: services.improve_idea(request.user, int(pk))))
