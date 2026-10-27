"""Error codes, the error response shape, and exception handlers (docs/API_ERRORS.md).

Every error response is {"error": {"code", "message", "field"}}. The message is safe to
show the user; full details of unexpected errors are only logged on the server.
"""

import logging
from enum import StrEnum

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from sqlalchemy.exc import DBAPIError
from starlette.exceptions import HTTPException as StarletteHTTPException

logger = logging.getLogger(__name__)

# SQLSTATE raised by the triggers that protect built-in rows (see the first migration).
BUILT_IN_SQLSTATE = "RT001"
UNIQUE_VIOLATION = "23505"
FOREIGN_KEY_VIOLATION = "23503"


class ErrorCode(StrEnum):
    BUILT_IN_PROTECTED = "BUILT_IN_PROTECTED"
    NOT_FOUND = "NOT_FOUND"
    VALIDATION_FAILED = "VALIDATION_FAILED"
    DUPLICATE = "DUPLICATE"
    CROSS_ACCOUNT_LINK = "CROSS_ACCOUNT_LINK"
    VERSION_LOCKED = "VERSION_LOCKED"
    POSTING_FETCH_FAILED = "POSTING_FETCH_FAILED"
    AI_UNAVAILABLE = "AI_UNAVAILABLE"
    INTERNAL_ERROR = "INTERNAL_ERROR"


STATUS = {
    ErrorCode.BUILT_IN_PROTECTED: 409,
    ErrorCode.NOT_FOUND: 404,
    ErrorCode.VALIDATION_FAILED: 422,
    ErrorCode.DUPLICATE: 409,
    ErrorCode.CROSS_ACCOUNT_LINK: 422,
    ErrorCode.VERSION_LOCKED: 409,
    ErrorCode.POSTING_FETCH_FAILED: 502,
    ErrorCode.AI_UNAVAILABLE: 503,
    ErrorCode.INTERNAL_ERROR: 500,
}

DEFAULT_MESSAGES = {
    ErrorCode.BUILT_IN_PROTECTED: "Built-in items can't be deleted or renamed.",
    ErrorCode.NOT_FOUND: "That item doesn't exist.",
    ErrorCode.VALIDATION_FAILED: "Some of the input isn't valid.",
    ErrorCode.DUPLICATE: "That already exists.",
    ErrorCode.CROSS_ACCOUNT_LINK: "Those items can't be linked.",
    ErrorCode.VERSION_LOCKED: (
        "This version was already sent, so it can't be changed. Make a copy to edit it."
    ),
    ErrorCode.POSTING_FETCH_FAILED: (
        "Couldn't read the job posting. Paste the description in instead."
    ),
    ErrorCode.AI_UNAVAILABLE: "Claude isn't available right now. Try again in a moment.",
    ErrorCode.INTERNAL_ERROR: "Something went wrong. Nothing was changed.",
}


class AppError(Exception):
    """Raise from any endpoint to return an error response with a fixed code."""

    def __init__(self, code: ErrorCode, message: str | None = None, field: str | None = None):
        self.code = code
        self.message = message or DEFAULT_MESSAGES[code]
        self.field = field
        super().__init__(self.message)


def error_response(code: ErrorCode, message: str | None = None, field: str | None = None):
    return JSONResponse(
        status_code=STATUS[code],
        content={
            "error": {"code": code, "message": message or DEFAULT_MESSAGES[code], "field": field}
        },
    )


def code_for_db_error(exc: DBAPIError) -> ErrorCode:
    sqlstate = getattr(exc.orig, "sqlstate", None)
    if sqlstate == UNIQUE_VIOLATION:
        return ErrorCode.DUPLICATE
    if sqlstate == FOREIGN_KEY_VIOLATION:
        return ErrorCode.NOT_FOUND
    if sqlstate == BUILT_IN_SQLSTATE:
        return ErrorCode.BUILT_IN_PROTECTED
    return ErrorCode.INTERNAL_ERROR


async def handle_app_error(request: Request, exc: AppError):
    if exc.code in (ErrorCode.INTERNAL_ERROR, ErrorCode.AI_UNAVAILABLE):
        logger.error("%s on %s %s: %s", exc.code, request.method, request.url.path, exc.message,
                     exc_info=exc.__cause__ or exc)
    return error_response(exc.code, exc.message, exc.field)


async def handle_validation_error(request: Request, exc: RequestValidationError):
    first = exc.errors()[0] if exc.errors() else None
    if first is None:
        return error_response(ErrorCode.VALIDATION_FAILED)
    # loc looks like ("body", "title") or ("query", "limit"); the last name is the field.
    names = [part for part in first["loc"] if isinstance(part, str)]
    field = names[-1] if len(names) > 1 else None
    message = f"Invalid {field.replace('_', ' ')}: {first['msg']}." if field else f"{first['msg']}."
    return error_response(ErrorCode.VALIDATION_FAILED, message, field)


async def handle_http_error(request: Request, exc: StarletteHTTPException):
    # Unknown routes and other framework errors still use the shared shape.
    if exc.status_code == 404:
        return error_response(ErrorCode.NOT_FOUND, "That page or item doesn't exist.")
    if exc.status_code < 500:
        response = error_response(ErrorCode.VALIDATION_FAILED, f"{exc.detail}.")
        response.status_code = exc.status_code
        return response
    return await handle_unexpected_error(request, exc)


async def handle_db_error(request: Request, exc: DBAPIError):
    code = code_for_db_error(exc)
    if code == ErrorCode.INTERNAL_ERROR:
        return await handle_unexpected_error(request, exc)
    return error_response(code)


async def handle_unexpected_error(request: Request, exc: Exception):
    logger.error("Unexpected error on %s %s", request.method, request.url.path, exc_info=exc)
    return error_response(ErrorCode.INTERNAL_ERROR)


def register_error_handlers(app: FastAPI) -> None:
    app.add_exception_handler(AppError, handle_app_error)
    app.add_exception_handler(RequestValidationError, handle_validation_error)
    app.add_exception_handler(StarletteHTTPException, handle_http_error)
    app.add_exception_handler(DBAPIError, handle_db_error)
    app.add_exception_handler(Exception, handle_unexpected_error)
