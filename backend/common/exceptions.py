"""
Consistent API error envelope:

    {"error": {"code": "validation_error", "message": "...", "fields": {"title": ["..."]}}}
"""

from __future__ import annotations

import logging

from django.core.exceptions import PermissionDenied as DjangoPermissionDenied
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import IntegrityError
from django.http import Http404
from rest_framework import exceptions, status
from rest_framework.response import Response
from rest_framework.views import set_rollback

logger = logging.getLogger("mytasker.api")


class DomainError(Exception):
    """Base class for business-rule violations raised by the service layer."""

    code = "domain_error"
    status_code = status.HTTP_400_BAD_REQUEST

    def __init__(self, message: str = "", *, code: str | None = None, fields: dict | None = None):
        super().__init__(message or self.__class__.__name__)
        self.message = message or self.__class__.__name__
        if code:
            self.code = code
        self.fields = fields or {}


class NotFound(DomainError):
    code = "not_found"
    status_code = status.HTTP_404_NOT_FOUND


class Forbidden(DomainError):
    code = "forbidden"
    status_code = status.HTTP_403_FORBIDDEN


class Conflict(DomainError):
    code = "conflict"
    status_code = status.HTTP_409_CONFLICT


class ValidationFailed(DomainError):
    code = "validation_error"
    status_code = status.HTTP_400_BAD_REQUEST


class RateLimited(DomainError):
    code = "rate_limited"
    status_code = status.HTTP_429_TOO_MANY_REQUESTS


class ExternalServiceError(DomainError):
    code = "external_service_error"
    status_code = status.HTTP_502_BAD_GATEWAY


def _envelope(code: str, message: str, fields: dict | None = None, http_status: int = 400) -> Response:
    body = {"error": {"code": code, "message": message, "fields": fields or {}}}
    return Response(body, status=http_status)


def api_exception_handler(exc, context):
    if isinstance(exc, DomainError):
        set_rollback()
        return _envelope(exc.code, exc.message, exc.fields, exc.status_code)

    if isinstance(exc, DjangoValidationError):
        set_rollback()
        fields = exc.message_dict if hasattr(exc, "message_dict") else {"non_field_errors": exc.messages}
        return _envelope("validation_error", "Validation failed.", fields, 400)

    if isinstance(exc, Http404):
        set_rollback()
        return _envelope("not_found", "Not found.", None, 404)

    if isinstance(exc, DjangoPermissionDenied):
        set_rollback()
        return _envelope("forbidden", "You do not have permission to perform this action.", None, 403)

    if isinstance(exc, IntegrityError):
        set_rollback()
        logger.warning("integrity error", exc_info=exc)
        return _envelope("conflict", "The operation conflicts with existing data.", None, 409)

    if isinstance(exc, exceptions.APIException):
        set_rollback()
        detail = exc.detail
        code = getattr(exc, "default_code", "error")
        if isinstance(exc, exceptions.ValidationError):
            fields = detail if isinstance(detail, dict) else {"non_field_errors": detail}
            return _envelope("validation_error", "Validation failed.", _stringify(fields), exc.status_code)
        if isinstance(exc, exceptions.NotAuthenticated):
            return _envelope("not_authenticated", "Authentication required.", None, 401)
        if isinstance(exc, exceptions.AuthenticationFailed):
            return _envelope("authentication_failed", str(detail), None, 401)
        if isinstance(exc, exceptions.PermissionDenied):
            return _envelope("forbidden", str(detail), None, 403)
        if isinstance(exc, exceptions.Throttled):
            return _envelope("rate_limited", str(detail), None, 429)
        if isinstance(exc, exceptions.NotFound):
            return _envelope("not_found", str(detail), None, 404)
        message = detail if isinstance(detail, str) else str(detail)
        return _envelope(str(code), message, None, exc.status_code)

    # Unknown error: never leak tracebacks.
    logger.exception("unhandled api exception", exc_info=exc)
    set_rollback()
    return _envelope("server_error", "Something went wrong.", None, 500)


def _stringify(fields):
    if isinstance(fields, dict):
        return {str(k): _stringify(v) for k, v in fields.items()}
    if isinstance(fields, list):
        return [_stringify(v) for v in fields]
    return str(fields)
