"""UI preferences use the workspace, including across desktop loopback ports."""
import json
from .paths import CONFIG_DIR
from .storage import write_json

PATH = CONFIG_DIR / "preferences.json"


def read() -> dict:
    try:
        data = json.loads(PATH.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        data = {}
    scheme = data.get("colorScheme", "system") if isinstance(data, dict) else "system"
    return {"colorScheme": scheme if scheme in ("system", "light", "dark") else "system"}


def save(scheme: str) -> dict:
    data = {"colorScheme": scheme}
    write_json(PATH, data)
    return data
