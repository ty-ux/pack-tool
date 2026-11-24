"""FastAPI 应用装配 + 启动入口"""
import socket
import threading
import time
import webbrowser
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from . import __version__
from .diagnostics import OperationLogMiddleware, configure_logging
from .paths import DIST_DIR
from .routers.api import router as api_router
from .staticserve import dist_mount, guide_response

PORT = 8765
HOST = "127.0.0.1"


def create_app(*, allow_dev_proxy: bool = True) -> FastAPI:
    @asynccontextmanager
    async def lifespan(app):
        from .data_safety import ensure_data_version
        logger = configure_logging()
        logger.info("lifecycle.start")
        try:
            ensure_data_version()
            logger.info("lifecycle.ready")
            yield
        except Exception:
            logger.exception("lifecycle.failed")
            raise
        finally:
            logger.info("lifecycle.stop")

    app = FastAPI(
        title="App 打包控制台",
        version=__version__,
        description="PackTool 本地打包服务",
        docs_url=None, redoc_url=None,
        lifespan=lifespan,
    )

    # dev 模式（vite 5173 直连）CORS；生产同源走 proxy 或同源，无需放行
    if allow_dev_proxy:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
            allow_methods=["*"],
            allow_headers=["*"],
        )

    app.include_router(api_router)
    app.add_middleware(OperationLogMiddleware)

    mount = dist_mount()
    if mount:
        app.mount("/", mount, name="spa")
    else:
        @app.get("/")
        async def guide():
            return guide_response()

    return app


app = create_app()


def _port_available(host: str, port: int) -> bool:
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        try:
            s.bind((host, port))
        finally:
            s.close()
        return True
    except OSError:
        return False


def run() -> None:
    if not _port_available(HOST, PORT):
        print(f"[ERR] 端口 {PORT} 已被占用，请先关闭已运行的服务进程")
        print(f"      若已运行，直接访问 http://{HOST}:{PORT}/")
        return

    # 等服务真正开始监听（能够建立 TCP 连接）后再开浏览器，避免竞态导致 ERR_CONNECTION_REFUSED
    def _open_when_ready() -> None:
        deadline = time.time() + 30
        while time.time() < deadline:
            try:
                with socket.create_connection((HOST, PORT), timeout=0.3):
                    webbrowser.open(f"http://{HOST}:{PORT}/")
                    return
            except OSError:
                time.sleep(0.3)

    threading.Thread(target=_open_when_ready, daemon=True).start()

    import uvicorn
    print(f"App 打包控制台已启动: http://{HOST}:{PORT}/")
    print("按 Ctrl+C 停止服务")
    try:
        uvicorn.run(app, host=HOST, port=PORT, log_level="warning")
    except KeyboardInterrupt:
        print("\n服务已停止")


if __name__ == "__main__":
    run()
