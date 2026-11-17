"""验证 APK/DEX 中是否存在指定类定义（验收标准 3 用）。

用途：DCloud 离线打包的 wgt 热更依赖 net.lingala.zip4j，若打包时漏掉 zip4j jar，
APK 的 dex 里 zip4j 类型只有引用没有类定义，运行 wgt 安装时直接崩溃（NPE）。
本脚本解析 APK 内全部 classes*.dex，检查 zip4j 类：
  - "类型出现" = type_ids 里有该描述符（可能是纯引用，不代表类定义）
  - "类已定义" = class_defs 里真的定义了该类（验这个才靠谱）

用法: python tools/verify_dex.py <apk路径或dex> [包名前缀]
示例: python tools/verify_dex.py output/example.apk
"""
import struct
import sys
import zipfile


def parse_dex(data: bytes) -> tuple[set, set]:
    """返回该 dex 的 (类型描述符集合, 类定义描述符集合)。"""
    # 注意用 \x00 而非 \0：Python 会把 \035 当八进制转义
    if len(data) < 0x70 or data[:8] not in (b"dex\n035\x00", b"dex\n037\x00", b"dex\n039\x00"):
        raise ValueError("不是有效的 dex 文件")

    def u4(off: int) -> int:
        return struct.unpack_from("<I", data, off)[0]

    string_ids_size, string_ids_off = u4(0x38), u4(0x3C)
    type_ids_size, type_ids_off = u4(0x40), u4(0x44)
    # class_defs 在 0x60/0x64（0x58/0x5C 是 method_ids）
    class_defs_size, class_defs_off = u4(0x60), u4(0x64)

    strings: dict[int, str] = {}

    def read_string(idx: int) -> str:
        if idx in strings:
            return strings[idx]
        off = u4(string_ids_off + idx * 4)
        # 跳过 uleb128 长度
        while data[off] & 0x80:
            off += 1
        off += 1
        end = data.index(b"\0", off)
        strings[idx] = data[off:end].decode("utf-8", errors="replace").replace("\0", "")
        return strings[idx]

    types = {read_string(u4(type_ids_off + i * 4)) for i in range(type_ids_size)}
    classes = set()
    for i in range(class_defs_size):
        class_idx = u4(class_defs_off + i * 32)
        classes.add(read_string(u4(type_ids_off + class_idx * 4)))
    return types, classes


def main() -> int:
    if len(sys.argv) < 2:
        print("用法: python tools/verify_dex.py <apk路径或dex> [包名前缀]")
        return 2
    path, prefix = sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else "Lnet/lingala/zip4j/"

    dex_names = []
    if path.lower().endswith(".dex"):
        dex_names = [path]
    elif path.lower().endswith(".apk"):
        with zipfile.ZipFile(path) as zf:
            dex_names = [n for n in zf.namelist() if n.startswith("classes") and n.endswith(".dex")]
    else:
        print(f"不支持的文件类型: {path}")
        return 2
    if not dex_names:
        print(f"找不到 classes*.dex: {path}")
        return 2

    all_types, all_classes = set(), set()
    for name in dex_names:
        if name == path:
            with open(path, "rb") as f:
                data = f.read()
        else:
            with zipfile.ZipFile(path) as zf:
                data = zf.read(name)
        types, classes = parse_dex(data)
        all_types |= types
        all_classes |= classes

    refs = sorted(t for t in all_types if t.startswith(prefix))
    defined = sorted(t for t in all_classes if t.startswith(prefix))
    print(f"dex 文件 {len(dex_names)} 个")
    print(f"{prefix} 类型出现 {len(refs)} 个，其中已定义类 {len(defined)} 个")
    if defined:
        print(f"示例: {defined[0]}")
        print("结果: 通过 —— 类定义已包含在 APK 中，wgt 安装不会缺类")
        return 0
    if refs:
        print(f"示例引用（未定义）: {refs[0]}")
        print("结果: 失败 —— 只有引用没有类定义，运行时会 NPE 崩溃；"
              "请在依赖包管理页勾选 zip4j 并重新打包")
        return 1
    print(f"结果: 未引用 —— APK 中完全没有 {prefix} 相关内容")
    return 1


if __name__ == "__main__":
    sys.exit(main())
