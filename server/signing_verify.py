"""Read-only verification of the actual keystore and private-key passwords."""
import os
import shutil
import subprocess
from pathlib import Path

from .local_tools import executable_name
from .paths import SCRIPTS_DIR
from .signing import resolve_signing, signing_error, signing_passwords


def verify_signing(cfg: dict) -> dict:
    cfg = resolve_signing(cfg)
    signing = cfg.get("signing") or {}
    if not str(signing.get("keystorePath") or "").strip():
        raise ValueError("请先选择签名文件")
    if error := signing_error(cfg):
        raise ValueError(error)
    paths = cfg.get("paths") or {}
    java_home = str(paths.get("javaHome") or os.environ.get("JAVA_HOME") or "").strip()
    java = str(Path(java_home).expanduser() / "bin" / executable_name("java")) if java_home else shutil.which("java")
    if not java or not Path(java).is_file():
        raise ValueError("找不到 Java，请在「路径配置」选择 JDK 11 或更高版本")
    store, key = signing_passwords(cfg)
    environment = {**os.environ, "PACK_TOOL_VERIFY_STORE_PASSWORD": store, "PACK_TOOL_VERIFY_KEY_PASSWORD": key}
    command = [java, str(SCRIPTS_DIR / "VerifySigning.java"), str(signing["keystorePath"]).strip(), str(signing["keyAlias"]).strip()]
    try:
        process = subprocess.run(command, env=environment, input="", capture_output=True,
                                 timeout=45, creationflags=0x08000000 if os.name == "nt" else 0)
    except subprocess.TimeoutExpired:
        raise ValueError("签名验证超时，请检查所选 JDK 后重试") from None
    except OSError:
        raise ValueError("无法启动签名验证，请检查所选 JDK") from None
    # Never return or log raw Java output: a third-party provider may echo secrets.
    results = {line for line in process.stdout.decode("utf-8", errors="replace").splitlines()
               if line.startswith("PACKTOOL_SIGNING:")}
    if process.returncode == 0 and results == {"PACKTOOL_SIGNING:ok"}:
        return {"ok": True, "message": "验证通过：签名文件、别名、密钥库密码和密钥密码匹配。"}
    messages = {
        "PACKTOOL_SIGNING:store-password": "无法打开签名文件，请检查密钥库密码和文件格式。",
        "PACKTOOL_SIGNING:key-password": "密钥库密码已通过，但密钥密码不正确，无法解锁私钥。",
        "PACKTOOL_SIGNING:alias": "密钥库密码已通过，但找不到所填的密钥别名。",
        "PACKTOOL_SIGNING:private-key": "所填别名没有可用于签名的私钥，请选择私钥条目的别名。",
    }
    for result, message in messages.items():
        if results == {result} and process.returncode == 0:
            return {"ok": False, "message": message}
    raise ValueError("无法完成验证，请确认文件为 JKS 或 PKCS12 格式，并选择完整的 JDK 11 或更高版本")
