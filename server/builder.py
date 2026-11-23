"""构建编排：线程安全的 BuildManager，支持真实取消（taskkill 进程树）与历史落库"""
import datetime
import os
import re
import subprocess
import threading

from . import config as config_mod
from .adb import find_adb
from . import history as history_mod
from . import packages as packages_mod
from .local_tools import android_sdk_environment
from .paths import BUILD_LOG, LOGS_DIR, SCRIPTS_DIR, fspath
from .project_builds import PROJECT_LABELS, ProjectBuild, prepare_project_build
from .signing import signing_environment, signing_error
from .wechat import PLATFORM as WECHAT_PLATFORM, MiniProgramBuild, prepare_wechat_build

CREATE_NO_WINDOW = 0x08000000

_TARGET_LABELS = {
    ("apk", "debug"): "Android APK (debug)",
    ("apk", "release"): "Android APK (release)",
    ("web", "pc"): "网站-PC Web",
    ("web", "h5"): "手机H5",
    ("wgt", "h5"): "WGT 热更新包",
}


class BuildManager:
    """所有状态读改都在 self._lock 内完成（start/cancel/worker 三方互斥）"""

    def __init__(self):
        self._lock = threading.Lock()
        self._idle = threading.Event()
        self._idle.set()
        self._running = False
        self._cancel = False
        self._proc: subprocess.Popen | None = None
        self._current = None
        self._current_build_id: int | None = None

    # ---------- 查询 ----------
    def status(self) -> dict:
        with self._lock:
            return {"running": self._running, "cancelRequested": self._cancel}

    def current(self) -> dict | None:
        with self._lock:
            return dict(self._current) if self._current else None

    # ---------- 启动 ----------
    def start(
        self, platform: str, web_type: str, build_type: str, *, action: str, profile: str, cfg: dict,
    ) -> tuple[bool, str]:
        with self._lock:
            if self._running:
                return False, "已有打包任务在运行中"
            # 先原子占位，避免"响应已发、线程未起"的防空窗
            self._running = True
            self._cancel = False
            self._idle.clear()

        try:
            plan = None
            env = None
            if platform == WECHAT_PLATFORM:
                plan = prepare_wechat_build(cfg, action, profile)
                cmd, target_desc, env = plan.command, plan.description, plan.env
            elif cfg["projectType"] in PROJECT_LABELS:
                plan = prepare_project_build(cfg, platform, build_type)
                cmd, target_desc = plan.command, plan.description
                env = plan.env
            elif platform == "web":
                script = SCRIPTS_DIR / "build_web.ps1"
                if not script.exists():
                    raise FileNotFoundError(f"找不到发行脚本: {script}")
                cmd = [
                    "powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
                    fspath(script), "-Config",
                ]
                target_desc = _TARGET_LABELS[("web", web_type)]
            elif platform == "wgt":
                script = SCRIPTS_DIR / "build_wgt.ps1"
                if not script.exists():
                    raise FileNotFoundError(f"找不到 wgt 打包脚本: {script}")
                cmd = [
                    "powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
                    fspath(script), "-Config",
                ]
                target_desc = _TARGET_LABELS[("wgt", "h5")]
            else:
                script = SCRIPTS_DIR / "build_apk.ps1"
                if not script.exists():
                    raise FileNotFoundError(f"找不到打包脚本: {script}")
                cmd = [
                    "powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
                    fspath(script), "-Config",
                ]
                target_desc = _TARGET_LABELS[("apk", build_type)]

            cfg["build"]["platform"] = platform
            cfg["build"]["webType"] = web_type
            cfg["build"]["buildType"] = build_type
            if plan is None:
                app_id = str(cfg["app"].get("appid") or "").strip()
                if platform in ("apk", "wgt") and not re.fullmatch(r"[A-Za-z0-9_-]+", app_id):
                    raise ValueError("请填写 manifest.json 中的 AppID，格式为字母、数字、下划线或连字符")
                cfg["app"]["appid"] = app_id
                if platform == "apk" and (error := signing_error(cfg)):
                    raise ValueError(error)
                if platform == "apk":
                    env = {**os.environ, **android_sdk_environment(cfg["paths"]), **signing_environment(cfg)}
                if platform == "apk" and cfg["install"].get("enabled"):
                    adb_path = find_adb(str(cfg["paths"].get("adb") or "").strip())
                    if adb_path:
                        cfg["paths"]["adb"] = adb_path
                cmd.append(fspath(config_mod.write_run_config(cfg)))
                if platform == "web":
                    cmd += ["-WebType", web_type]
                elif platform == "apk":
                    cmd += ["-BuildType", build_type]

            # 清空旧日志并写头行
            LOGS_DIR.mkdir(parents=True, exist_ok=True)
            ts = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            with open(BUILD_LOG, "w", encoding="utf-8") as f:
                f.write(f"[INFO] {ts} 启动打包任务: {target_desc}\n")

            # APK 打包前先同步依赖包（结果写入 build.log，步骤 0 由前端从日志解析展示）
            if platform == "apk" and plan is None:
                self._sync_dependencies(ts)

            with self._lock:
                self._current = {
                    "platform": platform, "webType": web_type,
                    "buildType": build_type, "desc": target_desc,
                }
                self._current_build_id = history_mod.create_build(
                    {
                        "started_at": ts,
                        "platform": platform,
                        "web_type": web_type,
                        "build_type": build_type,
                        "target_desc": target_desc,
                    },
                    {**cfg, "wechat": {key: value for key, value in cfg["wechat"].items() if key != "privateKeyPath"}},
                )
            threading.Thread(target=self._worker, args=(cmd, plan, env), daemon=True).start()
            return True, f"打包任务已启动 ({target_desc})"
        except Exception as e:
            with self._lock:
                self._running = False
                self._cancel = False
                self._proc = None
                self._current = None
                self._current_build_id = None
                self._idle.set()
            return False, f"启动打包失败: {e}"

    # ---------- 依赖包同步（构建前） ----------
    def _sync_dependencies(self, ts: str) -> None:
        """把启用的依赖包对齐到 simpleDemo/libs 并写入构建日志；失败则中止打包。"""
        hhmm = ts[11:19]  # 2026-09-15 09:12:33 -> 09:12:33

        def write(line: str) -> None:
            with open(BUILD_LOG, "a", encoding="utf-8") as f:
                f.write(line + "\n")

        write(f"[{hhmm}] [STEP] 0|packages|依赖包同步|running")
        ok, results, summary = packages_mod.sync_packages(log=write)
        if ok:
            write(f"[{hhmm}] [STEP] 0|packages|依赖包同步|ok")
            write(f"[{hhmm}] [OK]   依赖包同步完成：新增/更新 {summary['copy']}，移除 {summary['remove']}，跳过 {summary['skip']}")
        else:
            write(f"[{hhmm}] [STEP] 0|packages|依赖包同步|fail")
            errs = [r for r in results if r["action"] == "error"]
            detail = "；".join(f"{r['label']}: {r['message']}" for r in errs[:3])
            raise RuntimeError(f"依赖包同步失败（{summary['error']} 个包出错），已中止打包: {detail}")

    # ---------- 工作线程 ----------
    def _worker(self, cmd: list[str], plan: ProjectBuild | MiniProgramBuild | None, env: dict[str, str] | None) -> None:
        build_id = None
        stage = "0|project|构建项目"
        if isinstance(plan, MiniProgramBuild):
            stage = f"0|project|{plan.description}"
        try:
            if isinstance(plan, ProjectBuild):
                plan.prepare()
            # 'a' 追加：头行已在 start 写好，child 通过继承句柄继续写
            with open(BUILD_LOG, "a", encoding="utf-8") as f:
                if plan:
                    f.write(f"[STEP] {stage}|running\n")
                    f.write(f"[INFO] {plan.executable} {' '.join(plan.args)}\n")
                    f.flush()
                with self._lock:
                    build_id = self._current_build_id
                    if not self._cancel:
                        self._proc = subprocess.Popen(
                            cmd, stdout=f, stderr=subprocess.STDOUT,
                            creationflags=CREATE_NO_WINDOW if os.name == "nt" else 0,
                            cwd=plan.working_dir if plan else None,
                            env=env,
                        )
                    proc = self._proc
                if proc:
                    proc.wait()
            with self._lock:
                cancelled = self._cancel
            if cancelled:
                with open(BUILD_LOG, "a", encoding="utf-8") as f:
                    f.write("\n[WARN] 构建已被用户停止\nBUILD-CANCELLED\n")
            elif plan:
                if proc.returncode:
                    raise RuntimeError(f"构建命令退出码：{proc.returncode}")
                with open(BUILD_LOG, "a", encoding="utf-8") as f:
                    f.write(f"\n[STEP] {stage}|ok\n")
                    stage = "1|artifact|收集产物"
                    f.write(f"[STEP] {stage}|running\n")
                    f.flush()
                    artifact = plan.collect()
                    f.write(f"[STEP] {stage}|ok\n")
                    if artifact:
                        f.write(f"[OK] 构建产物: {artifact}\n")
                    if isinstance(plan, MiniProgramBuild):
                        f.write(f"[WECHAT-BUILD] {plan.profile}\n")
                        if plan.receipt:
                            f.write(f"[WECHAT-PREVIEW] {plan.profile}/{plan.receipt}\n")
                    f.write("BUILD-OK\n")
            self._settle_history(build_id)
        except Exception as e:
            with open(BUILD_LOG, "a", encoding="utf-8") as f:
                if plan:
                    f.write(f"\n[STEP] {stage}|fail\n[ERR] 构建执行异常: {e}\nBUILD-FAILED\n")
                else:
                    f.write(f"\n[ERR] 构建执行异常: {e}\nBUILD-CANCELLED\n")
            self._settle_history(build_id)
        finally:
            with self._lock:
                self._proc = None
                self._running = False
                self._cancel = False
                self._current = None
                self._current_build_id = None
                self._idle.set()

    def _settle_history(self, build_id: int | None) -> None:
        """归档日志 + 判定状态 + 落库 + 清理超限记录"""
        if not build_id:
            return
        try:
            raw = BUILD_LOG.read_bytes()
            try:
                log_text = raw.decode("utf-8")
            except UnicodeDecodeError:
                log_text = raw.decode("gbk", errors="replace")
            status = history_mod.resolve_status(log_text)
            artifact = history_mod.resolve_artifact(log_text)
            log_rel = history_mod.archive_log(build_id)
            history_mod.finish_build(build_id, status, artifact, log_rel)
            history_mod.cleanup()
        except Exception:
            # 历史落库失败不影响打包主流程
            pass

    # ---------- 取消 ----------
    def cancel(self) -> tuple[bool, str]:
        with self._lock:
            if not self._running:
                return False, "当前没有正在运行的打包任务"
            self._cancel = True
            pid = self._proc.pid if self._proc else None
        if pid:
            # 锁外执行 kill：taskkill /T 杀整个进程树（powershell→cmd→java）
            try:
                subprocess.run(
                    ["taskkill", "/PID", str(pid), "/T", "/F"],
                    capture_output=True, timeout=15, creationflags=CREATE_NO_WINDOW,
                )
            except Exception:
                pass
        return True, "已发送停止信号，正在结束构建进程"

    def stop_and_wait(self, timeout: float) -> None:
        self.cancel()
        self._idle.wait(timeout)


build_manager = BuildManager()
