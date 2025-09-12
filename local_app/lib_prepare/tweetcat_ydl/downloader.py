from typing import Any, Dict, Optional
import yt_dlp

from .utils import NDJSONWriter, now_ts, as_int, as_float

def run_download(writer: NDJSONWriter, params: Dict[str, Any]) -> None:
    """
    执行一次下载，把完整生命周期事件通过 writer 以 NDJSON 推送：
    start / progress / merging / done / error
    （⚠️ 已移除 meta 事件；元信息请走控制通道 videometa）
    """
    url: str = params.get("url") or ""
    fmt: Optional[str] = params.get("format_value")
    outtmpl: Optional[str] = params.get("output_template")
    cookies: Optional[str] = params.get("cookies_path") or params.get("cookies")
    proxy: Optional[str] = params.get("proxy")

    # 先发一个 start，让前端立即有反馈
    writer.send({
        "event": "start",
        "state": "running",
        "ts": now_ts(),
        "url": url,
        "format_value": fmt,
        "output_template": outtmpl,
    })

    ydl_opts: Dict[str, Any] = dict(
        quiet=True,
        no_warnings=True,
        continuedl=True,         # 断点续传
        noprogress=True,         # 不向 stdout 刷进度
        outtmpl=outtmpl or "%(title)s.%(ext)s",
        merge_output_format="mp4",
        progress_hooks=[_build_progress_hook(writer)],
        postprocessor_hooks=[_build_postprocessor_hook(writer)],
        retries=3,
        fragment_retries=3,
        concurrent_fragment_downloads=3,
    )
    if fmt:
        ydl_opts["format"] = fmt
    if cookies:
        ydl_opts["cookiefile"] = cookies
    if proxy:
        ydl_opts["proxy"] = proxy

    print(f"[ydl][opts] outtmpl={ydl_opts.get('outtmpl')}", flush=True)
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        ydl.download([url])

    # 下载+后处理完成
    writer.send({
        "event": "done",
        "state": "done",
        "ts": now_ts(),
        "ok": True
    })

def _build_progress_hook(writer: NDJSONWriter):
    def hook(d: Dict[str, Any]):
        status = d.get("status")  # "downloading" | "finished"
        downloaded = as_int(d.get("downloaded_bytes"))
        total = as_int(d.get("total_bytes") or d.get("total_bytes_estimate"))
        speed = as_float(d.get("speed"))
        eta = as_int(d.get("eta"))
        filename = d.get("filename")

        if status == "downloading":
            percent = None
            if downloaded is not None and total and total > 0:
                percent = downloaded / total
            writer.send({
                "event": "progress",
                "state": "running",
                "ts": now_ts(),
                "downloaded": downloaded,
                "total": total,
                "percent": percent,
                "speed": speed,   # Bytes/s
                "eta": eta,       # 秒
                "phase": "downloading",
                "filename": filename
            })
        elif status == "finished":
            writer.send({
                "event": "progress",
                "state": "running",
                "ts": now_ts(),
                "phase": "finished",
                "filename": filename
            })
            writer.send({
                "event": "merging",
                "state": "merging",
                "ts": now_ts(),
                "details": "postprocessing (merge/mux) starting"
            })
    return hook

def _build_postprocessor_hook(writer: NDJSONWriter):
    def hook(d: Dict[str, Any]):
        st = d.get("status")
        pp = d.get("postprocessor")
        if st == "started":
            writer.send({
                "event": "merging",
                "state": "merging",
                "ts": now_ts(),
                "details": f"{pp} started"
            })
        elif st == "finished":
            writer.send({
                "event": "merging",
                "state": "merging",
                "ts": now_ts(),
                "details": f"{pp} finished"
            })
    return hook
