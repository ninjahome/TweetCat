#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
协议：单行 JSON 请求 -> 单行 JSON 响应
通信方式：TCP socket (127.0.0.1:12345)
调试/日志：stderr
"""

import socketserver
import json
import sys
import traceback

try:
    import yt_dlp
except Exception as e:
    print(json.dumps({"ok": False, "error": f"import yt_dlp failed: {e}"}), flush=True)
    sys.exit(0)


def _handle_version():
    try:
        version = getattr(yt_dlp.version, "__version__", "unknown")
    except Exception:
        version = "unknown"
    return {"ok": True, "version": version}


def _handle_json(data):
    url = data.get("url")
    cookies = data.get("cookies")
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
            return info
    except Exception as e:
        traceback.print_exc(file=sys.stderr)
        return {"ok": False, "error": str(e)}


def handle_line(line: str):
    line = (line or "").strip()
    if not line:
        return {"ok": False, "error": "empty line"}
    try:
        data = json.loads(line)
    except Exception:
        return {"ok": False, "error": "invalid json input"}

    cmd = data.get("cmd")
    if cmd == "version":
        return _handle_version()
    elif cmd == "json":
        return _handle_json(data)
    else:
        return {"ok": False, "error": f"unknown cmd: {cmd}"}


import socket, sys, json, traceback, socketserver

class ReusableTCPServer(socketserver.ThreadingTCPServer):
    allow_reuse_address = True  # ← 放在 Server 类上才生效

def _port_is_listened(host="127.0.0.1", port=54321, timeout=0.2):
    s = socket.socket()
    s.settimeout(timeout)
    try:
        s.connect((host, port))
        return True
    except Exception:
        return False
    finally:
        s.close()

class MyTCPHandler(socketserver.StreamRequestHandler):
    def handle(self):
        for raw in self.rfile:
            try:
                line = raw.decode("utf-8", errors="ignore").strip()
                resp = handle_line(line)
                self.wfile.write((json.dumps(resp) + "\n").encode("utf-8"))
                self.wfile.flush()
            except Exception:
                traceback.print_exc(file=sys.stderr)
                self.wfile.write(b'{"ok": false, "error": "unhandled exception"}\n')
                self.wfile.flush()

def main():
    HOST, PORT = "127.0.0.1", 54321  # 代码端口与 Swift 一致:contentReference[oaicite:1]{index=1}
    # 单实例守卫：如果已经有同端口的服务在跑，直接退出(0)，避免 Errno 48
    if _port_is_listened(HOST, PORT):
        # 可选：打印一行到 stderr 方便定位
        print(f"[YDL] another server already running on {HOST}:{PORT}", file=sys.stderr, flush=True)
        sys.exit(0)

    with ReusableTCPServer((HOST, PORT), MyTCPHandler) as server:
        print(f"[YDL] listening on {HOST}:{PORT}", file=sys.stderr, flush=True)
        try:
            server.serve_forever()
        finally:
            server.server_close()

if __name__ == "__main__":  # 你已有这层保护:contentReference[oaicite:2]{index=2}
    main()
