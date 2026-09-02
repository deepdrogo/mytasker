from __future__ import annotations

from common.models import Source

_MOBILE_HINTS = ("Mobile", "Android", "iPhone", "iPad")


class RequestSourceMiddleware:
    """
    Attach `request.client_source` (web / mobile_web) so services can record the completion source.
    The frontend may override with the `X-Client-Source` header (e.g. "mobile_web").
    """

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        header = request.headers.get("X-Client-Source", "").strip()
        if header in {Source.WEB, Source.MOBILE_WEB}:
            request.client_source = header
        else:
            ua = request.headers.get("User-Agent", "")
            request.client_source = Source.MOBILE_WEB if any(h in ua for h in _MOBILE_HINTS) else Source.WEB
        return self.get_response(request)
