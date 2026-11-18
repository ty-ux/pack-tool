"""adb 工具：定位 adb、设备列表、重启、手动连接"""
import os
import shutil
import subprocess

CREATE_NO_WINDOW = 0x08000000

def find_adb(adb_path: str = "", sdk_path: str | None = None) -> str | None:
    """定位 adb 可执行文件，返回路径或 None"""
    if adb_path and os.path.isfile(adb_path):
        return adb_path
    from .config import load_config

    paths = load_config().get("paths") or {}
    conf_adb = paths.get("adb", "")
    if conf_adb and os.path.isfile(conf_adb):
        return conf_adb
    local_app_data = os.environ.get("LOCALAPPDATA")
    sdk_dirs = (
        paths.get("androidSdk") if sdk_path is None else sdk_path,
        os.environ.get("ANDROID_HOME"),
        os.environ.get("ANDROID_SDK_ROOT"),
        os.path.join(local_app_data, "Android", "Sdk") if local_app_data else None,
    )
    for sdk in sdk_dirs:
        if sdk:
            candidate = os.path.join(sdk, "platform-tools", "adb.exe")
            if os.path.isfile(candidate):
                return candidate
    return shutil.which("adb")


def get_devices(adb_path: str = "") -> list[str]:
    """获取已连接设备列表"""
    adb = find_adb(adb_path)
    if not adb:
        return []
    try:
        result = subprocess.run(
            [adb, "devices", "-l"],
            capture_output=True, text=True, timeout=10,
            creationflags=CREATE_NO_WINDOW,
        )
        devices = []
        for line in result.stdout.strip().splitlines()[1:]:
            line = line.strip()
            if not line:
                continue
            parts = line.split()
            if len(parts) >= 2 and parts[1] == "device":
                devices.append(parts[0])
        return devices
    except Exception:
        return []


def restart_adb(adb_path: str = "") -> tuple[bool, str]:
    """重启 adb 服务（kill-server + start-server）"""
    adb = find_adb(adb_path)
    if not adb:
        return False, "未找到 adb，请检查路径配置"
    try:
        subprocess.run([adb, "kill-server"], capture_output=True, text=True, timeout=10,
                       creationflags=CREATE_NO_WINDOW)
        result = subprocess.run([adb, "start-server"], capture_output=True, text=True, timeout=15,
                                creationflags=CREATE_NO_WINDOW)
        if result.returncode == 0:
            return True, "adb 已重启"
        return False, f"adb start-server 失败: {result.stderr.strip() or result.stdout.strip()}"
    except Exception as e:
        return False, f"重启 adb 异常: {e}"


def adb_connect(host_port: str, adb_path: str = "") -> tuple[bool, str]:
    """手动连接设备 adb connect host:port"""
    adb = find_adb(adb_path)
    if not adb:
        return False, "未找到 adb，请检查路径配置"
    if not host_port or not str(host_port).strip():
        return False, "请填写 ip:port"
    target = str(host_port).strip()
    if ":" not in target:
        target = target + ":5555"
    try:
        result = subprocess.run([adb, "connect", target], capture_output=True, text=True, timeout=15,
                                creationflags=CREATE_NO_WINDOW)
        out = (result.stdout or result.stderr or "").strip()
        if "connected" in out:
            return True, f"连接成功: {out}"
        return False, f"连接失败: {out}"
    except Exception as e:
        return False, f"连接异常: {e}"
