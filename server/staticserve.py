"""静态资源服务：Vite dist + SPA fallback + 无 dist 引导页"""
import mimetypes
import os

from fastapi.responses import FileResponse, HTMLResponse
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.staticfiles import StaticFiles

from .paths import DIST_DIR

# Windows 注册表常缺的类型，显式补齐
mimetypes.add_type("font/woff2", ".woff2")
mimetypes.add_type("font/ttf", ".ttf")
mimetypes.add_type("application/javascript", ".mjs")


class SPAStaticFiles(StaticFiles):
    """404 时回退到 index.html（SPA 兜底）；assets 与 html 走不同缓存策略"""

    def __init__(self, directory: str):
        super().__init__(directory=directory, html=False)
        self._index_path = os.path.join(directory, "index.html")

    async def get_response(self, path: str, scope):
        if path in ("", "index.html"):
            path = "index.html"
        try:
            response = await super().get_response(path, scope)
        except StarletteHTTPException as exc:
            if exc.status_code == 404 and os.path.exists(self._index_path):
                return FileResponse(
                    self._index_path,
                    headers={"Cache-Control": "no-cache"},
                )
            raise
        if path.startswith("assets/"):
            response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
        return response


GUIDE_HTML = """<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<title>App 打包控制台</title>
<style>
  body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
         background: #0f1729; color: #cbd5e1; font-family: "Segoe UI", "Microsoft YaHei", sans-serif; }
  .box { max-width: 520px; padding: 40px; text-align: center; }
  h1 { font-size: 20px; color: #fff; margin: 0 0 12px; letter-spacing: .02em; }
  code { background: rgba(148, 163, 184, .15); padding: 2px 8px; border-radius: 6px;
         color: #7dd3fc; font-family: Consolas, monospace; }
  .step { text-align: left; margin: 18px 0 0; line-height: 2;
          background: rgba(148, 163, 184, .08); padding: 14px 18px; border-radius: 10px; font-size: 14px; }
</style>
</head>
<body>
<div class="box">
  <h1>App 打包控制台</h1>
  <p>前端尚未构建。请双击 <code>build-frontend.bat</code>，或在 <code>web/</code> 目录执行以下命令。</p>
  <div class="step">
    <b>1.</b> 安装依赖：<code>npm ci</code><br>
    <b>2.</b> 构建产物：<code>npm run build</code><br>
    <b>3.</b> 刷新本页面
    <hr style="border-color: rgba(148,163,184,.2); margin: 10px 0">
    或开发模式：<code>npm run dev</code> 后访问 <code>http://localhost:5173</code>
  </div>
</div>
</body>
</html>
"""


def has_dist() -> bool:
    return (DIST_DIR / "index.html").exists()


def dist_mount() -> SPAStaticFiles | None:
    if has_dist():
        return SPAStaticFiles(directory=os.fspath(DIST_DIR))
    return None


def guide_response() -> HTMLResponse:
    return HTMLResponse(GUIDE_HTML)
