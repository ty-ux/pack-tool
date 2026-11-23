"""Protect local credentials with Windows DPAPI under the current user account."""
import base64
import ctypes
import os
from ctypes import wintypes


class _Blob(ctypes.Structure):
    _fields_ = [("size", wintypes.DWORD), ("data", ctypes.POINTER(ctypes.c_ubyte))]


def _crypt(value: bytes, *, decrypt: bool) -> bytes:
    if os.name != "nt":
        raise ValueError("当前系统暂不支持本机密码加密保存，请使用环境变量方式")
    buffer = ctypes.create_string_buffer(value)
    source = _Blob(len(value), ctypes.cast(buffer, ctypes.POINTER(ctypes.c_ubyte)))
    result = _Blob()
    crypt32 = ctypes.WinDLL("crypt32", use_last_error=True)
    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    operation = crypt32.CryptUnprotectData if decrypt else crypt32.CryptProtectData
    operation.argtypes = [ctypes.POINTER(_Blob), ctypes.c_void_p, ctypes.c_void_p,
                          ctypes.c_void_p, ctypes.c_void_p, wintypes.DWORD, ctypes.POINTER(_Blob)]
    operation.restype = wintypes.BOOL
    kernel32.LocalFree.argtypes = [ctypes.c_void_p]
    kernel32.LocalFree.restype = ctypes.c_void_p
    # CRYPTPROTECT_UI_FORBIDDEN, with the default current-user protection scope.
    if not operation(ctypes.byref(source), None, None, None, None, 1, ctypes.byref(result)):
        action = "读取" if decrypt else "保存"
        raise ValueError(f"无法{action}本机签名密码，请在当前 Windows 账户下重新填写密码")
    try:
        return ctypes.string_at(result.data, result.size)
    finally:
        if result.data:
            ctypes.memset(result.data, 0, result.size)
            kernel32.LocalFree(result.data)


def protect(password: str) -> str:
    return "dpapi:" + base64.b64encode(_crypt(password.encode("utf-8"), decrypt=False)).decode("ascii")


def unprotect(value: str) -> str:
    try:
        if not value.startswith("dpapi:"):
            raise ValueError
        return _crypt(base64.b64decode(value[6:], validate=True), decrypt=True).decode("utf-8")
    except (ValueError, UnicodeError) as error:
        raise ValueError("无法读取已保存的签名密码，请在当前 Windows 账户下重新填写") from error
