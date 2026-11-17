"""系统文件/文件夹选择对话框（PowerShell System.Windows.Forms）"""
import subprocess
import tempfile
from pathlib import Path

CREATE_NO_WINDOW = 0x08000000

# 纯 ASCII 脚本（中文经 -Title/-Filter 参数传入，避免脚本编码问题）
_PS_SCRIPT = r"""param([string]$Kind, [string]$Title, [string]$Filter)
Add-Type -AssemblyName System.Windows.Forms
$form = New-Object System.Windows.Forms.Form
$form.TopMost = $true
$form.WindowState = [System.Windows.Forms.FormWindowState]::Minimized
$form.ShowInTaskbar = $false
$result = $null
$dlg = $null
if ($Kind -eq 'file') {
    $dlg = New-Object System.Windows.Forms.OpenFileDialog
    if (-not [string]::IsNullOrEmpty($Title)) { $dlg.Title = $Title }
    if (-not [string]::IsNullOrEmpty($Filter)) { $dlg.Filter = $Filter }
} else {
    $dlg = New-Object System.Windows.Forms.FolderBrowserDialog
    if (-not [string]::IsNullOrEmpty($Title)) { $dlg.Description = $Title }
}
if ($dlg.ShowDialog($form) -eq [System.Windows.Forms.DialogResult]::OK) {
    if ($Kind -eq 'file') { $result = $dlg.FileName } else { $result = $dlg.SelectedPath }
}
if ($result -ne $null -and $result -ne '') { [Console]::Out.Write($result) }
"""


def _decode(data: bytes) -> str:
    for enc in ("utf-8", "gbk"):
        try:
            return data.decode(enc)
        except UnicodeDecodeError:
            continue
    return data.decode("utf-8", errors="replace")


def browse(kind: str = "dir", title: str = "", file_filter: str = "") -> dict:
    """弹系统对话框。kind: dir / file。返回 {ok, path} / {ok:False, cancelled:True} / {ok:False, error}"""
    if kind not in ("dir", "file"):
        return {"ok": False, "error": "type 只能是 dir 或 file"}
    tmp = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".ps1", prefix="pt_browse_",
            encoding="utf-8", delete=False,
        ) as f:
            f.write(_PS_SCRIPT)
            tmp = f.name
        result = subprocess.run(
            [
                "powershell", "-NoProfile", "-STA", "-ExecutionPolicy", "Bypass",
                "-File", tmp,
                "-Kind", kind, "-Title", title, "-Filter", file_filter,
            ],
            capture_output=True, timeout=180, creationflags=CREATE_NO_WINDOW,
        )
        out = _decode(result.stdout).strip()
        if result.returncode == 0 and out:
            return {"ok": True, "path": out}
        if result.returncode == 0 and not out:
            return {"ok": False, "cancelled": True, "path": ""}
        return {"ok": False, "error": _decode(result.stderr).strip() or f"对话框异常 (退出码 {result.returncode})"}
    except subprocess.TimeoutExpired:
        return {"ok": False, "error": "选择超时（对话框可能被系统拦截）"}
    except Exception as e:
        return {"ok": False, "error": f"打开对话框失败: {e}"}
    finally:
        if tmp:
            try:
                Path(tmp).unlink(missing_ok=True)
            except OSError:
                pass