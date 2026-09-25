import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from .api.routes import router
from .core.errors import AppError
from .core.auth import validate_auth_config
from .models.database import ensure_schema

logging.basicConfig(
    level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s"
)
logger = logging.getLogger(__name__)

_STATUS = {
    "NOT_FOUND": 404,
    "INVALID_INPUT": 422,
    "INVALID_STATE": 409,
    "PARSE_ERROR": 422,
    "LLM_INIT_FAILED": 500,
    "LLM_ERROR": 502,
    "LLM_TIMEOUT": 504,
    "ASR_AUTH_FAILED": 500,
    "ASR_FAILED": 502,
    "ASR_EMPTY": 422,
    "TTS_FAILED": 502,
    "TTS_NOT_CONFIGURED": 503,
    "UNAUTHORIZED": 401,
}


@asynccontextmanager
async def lifespan(app: FastAPI):
    validate_auth_config()
    ensure_schema()
    yield


app = FastAPI(title="销售新人陪练 Agent", lifespan=lifespan)


@app.exception_handler(AppError)
async def _app_error(request: Request, exc: AppError):
    return JSONResponse(
        status_code=_STATUS.get(exc.code, 500),
        content={"error": {"code": exc.code, "message": exc.message}},
    )


@app.exception_handler(RequestValidationError)
async def _validation_error(request: Request, exc):
    return JSONResponse(
        status_code=422,
        content={"error": {"code": "INVALID_INPUT", "message": "输入参数不合法"}},
    )


@app.exception_handler(Exception)
async def _generic_error(request: Request, exc: Exception):
    logger.exception("未处理异常")
    return JSONResponse(
        status_code=500,
        content={"error": {"code": "INTERNAL_ERROR", "message": "服务内部错误"}},
    )


app.include_router(router, prefix="/api/v1")
app.mount("/", StaticFiles(directory=Path(__file__).parent / "static", html=True), name="static")
