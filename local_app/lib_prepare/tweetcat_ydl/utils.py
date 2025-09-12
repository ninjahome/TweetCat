import json
import time
from typing import Any, Dict, Optional

class NDJSONWriter:
    """把事件以 NDJSON 写到 socket 的缓冲区里"""
    def __init__(self, wfile):
        self.wfile = wfile

    def send(self, obj: Dict[str, Any]) -> None:
        line = json.dumps(obj, ensure_ascii=False, separators=(",", ":")) + "\n"
        self.wfile.write(line.encode("utf-8"))
        self.wfile.flush()

def now_ts() -> float:
    return time.time()

def as_int(x) -> Optional[int]:
    try:
        return None if x is None else int(x)
    except Exception:
        return None

def as_float(x) -> Optional[float]:
    try:
        return None if x is None else float(x)
    except Exception:
        return None

def map_error_code(msg: str) -> str:
    m = (msg or "").lower()
    if "http error 401" in m:
        return "HTTP_401"
    if "http error 403" in m or "forbidden" in m:
        return "HTTP_403"
    if "geo" in m and "restrict" in m:
        return "GEO_BLOCKED"
    if "ffmpeg" in m:
        return "FFMPEG_ERROR"
    return "DOWNLOAD_ERROR"

def ok(cmd: str, data: Dict[str, Any]) -> Dict[str, Any]:
    return {"ok": True, "cmd": cmd, "data": data}

def fail(cmd: str, code: str, message: str, hint: str = "") -> Dict[str, Any]:
    e = {"code": code, "message": message}
    if hint:
        e["hint"] = hint
    return {"ok": False, "cmd": cmd, "error": e}
