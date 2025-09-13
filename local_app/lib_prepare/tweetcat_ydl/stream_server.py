import os
import json
import socketserver
import traceback

import yt_dlp

from .utils import NDJSONWriter, now_ts, map_error_code, DownloadCancelled
from .downloader import run_download

STREAM_HOST = os.environ.get("YDL_STREAM_HOST", "127.0.0.1")
STREAM_PORT = int(os.environ.get("YDL_STREAM_PORT", "54321"))

class DownloadStreamHandler(socketserver.StreamRequestHandler):
    daemon_threads = True

    def handle(self):
        writer = NDJSONWriter(self.wfile)
        try:
            raw = self.rfile.readline()
            if not raw:
                return
            cmd = json.loads(raw.decode("utf-8").strip())
        except Exception as e:
            self._send_error(writer, "BAD_REQUEST", f"invalid json line: {e}")
            return

        if cmd.get("cmd") != "download":
            self._send_error(writer, "UNSUPPORTED_CMD", f"cmd={cmd.get('cmd')}")
            return

        try:
            run_download(writer, cmd)
        except yt_dlp.utils.DownloadError as e:
            code = map_error_code(str(e))
            self._send_error(writer, code, str(e))

        except DownloadCancelled:
            return

        except Exception as e:
            self._send_error(writer, "UNKNOWN", f"{e}\n{traceback.format_exc()}")

    def _send_error(self, writer: NDJSONWriter, code: str, message: str):
        try:
            writer.send({
                "event": "error",
                "state": "failed",
                "ts": now_ts(),
                "error": {"code": code, "message": message}
            })
        except Exception:
            pass

class ThreadingTCPServer(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True

def serve_stream():
    with ThreadingTCPServer((STREAM_HOST, STREAM_PORT), DownloadStreamHandler) as server:
        print(f"[ydl_stream] listening on {STREAM_HOST}:{STREAM_PORT}", flush=True)
        server.serve_forever()
