from rest_framework.pagination import CursorPagination, PageNumberPagination


class StandardPagination(PageNumberPagination):
    page_size = 50
    page_size_query_param = "page_size"
    max_page_size = 200


class SmallPagination(PageNumberPagination):
    page_size = 20
    page_size_query_param = "page_size"
    max_page_size = 100


class ActivityCursorPagination(CursorPagination):
    page_size = 50
    max_page_size = 200
    page_size_query_param = "page_size"
    ordering = "-id"
