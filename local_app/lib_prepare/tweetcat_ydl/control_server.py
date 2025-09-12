# tweetcat_ydl/control_server.py

import os
import sys
import json
import socketserver
import traceback
from typing import Any, Dict, Tuple

import yt_dlp

CONTROL_HOST = os.environ.get("YDL_CONTROL_HOST", "127.0.0.1")
CONTROL_PORT = int(os.environ.get("YDL_CONTROL_PORT", "54320"))

class ControlHandler(socketserver.StreamRequestHandler):
    daemon_threads = True

    def handle(self):
        # 按行协议：每行一个 JSON 请求，回一行 JSON 响应
        while True:
            raw = self.rfile.readline()
            if not raw:
                return
            try:
                req = json.loads(raw.decode("utf-8").strip())
                payload, passthrough = self._dispatch(req)
            except Exception as e:
                payload = {"ok": False, "error": f"BAD_REQUEST: {e}"}
                passthrough = True  # 直接回错误对象

            # passthrough=True 表示“直接把 payload 写回”，不再包裹其他层
            line = json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n"
            self.wfile.write(line.encode("utf-8"))
            self.wfile.flush()

    # 返回 (payload, passthrough)
    # passthrough=True -> 直接把 payload 写回（用于 videometa 原样返回 info 对象）
    def _dispatch(self, req: Dict[str, Any]) -> Tuple[Dict[str, Any], bool]:
        cmd = (req.get("cmd") or "").lower()

        if cmd == "version":
            return self._handle_version(), True

        if cmd == "videometa":
            return self._handle_videometa(req), True

        # 不支持的命令
        return {"ok": False, "error": f"UNSUPPORTED_CMD: {cmd}"}, True

    def _handle_version(self) -> Dict[str, Any]:
        try:
            version = getattr(yt_dlp.version, "__version__", "unknown")
        except Exception:
            version = "unknown"
        return {"ok": True, "version": version}

    def _handle_videometa(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """
        一次性获取 yt_dlp 的完整 info JSON：
        入参：
          {
            "cmd": "videometa",
            "url": "...",            # 必填
            "cookies": "...",        # 可选（Netscape 文件路径）
            "proxy": "http://..."    # 可选
          }
        返回：
          - 成功：yt_dlp 的原始 info 对象（dict）
          - 失败：{"ok": false, "error": "..."}
        """
        url = data.get("url")
        cookies = data.get("cookies") or data.get("cookies_path")  # 兼容 cookies_path
        proxy = data.get("proxy")

        if not url:
            return {"ok": False, "error": "missing url"}

        ydl_opts = {
            "dump_single_json": True,
            "nocheckcertificate": True,
            "noplaylist": True,
            "quiet": True,
            "no_warnings": True,
        }
        if cookies:
            ydl_opts["cookiefile"] = cookies
        if proxy:
            ydl_opts["proxy"] = proxy

        try:
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(url, download=False)
                # 直接返回原始 info（与一次性取全量一致）
                return info
        except Exception as e:
            traceback.print_exc(file=sys.stderr)
            return {"ok": False, "error": str(e)}


class ThreadingTCPServer(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True

def serve_control():
    with ThreadingTCPServer((CONTROL_HOST, CONTROL_PORT), ControlHandler) as server:
        print(f"[ydl_control] listening on {CONTROL_HOST}:{CONTROL_PORT}", flush=True)
        server.serve_forever()
