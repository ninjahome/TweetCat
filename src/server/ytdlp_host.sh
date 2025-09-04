#!/bin/bash
# Native Messaging Host: yt-dlp bridge (robust + auto background download)
# Protocol: 4-byte little-endian length + JSON

LOG_FILE="/tmp/ytdlp_host.log"

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" >>"$LOG_FILE"
}

# --- bin resolvers (bash) ---
resolve_yt_dlp() {
  if [ -n "${YT_DLP_BIN:-}" ] && [ -x "$YT_DLP_BIN" ]; then echo "$YT_DLP_BIN"; return 0; fi
  local candidates=( "./bin/yt-dlp_macos" "/opt/homebrew/bin/yt-dlp" "/usr/local/bin/yt-dlp" )
  for c in "${candidates[@]}"; do
    [ -x "$c" ] && { echo "$c"; return 0; }
  done
  command -v yt-dlp 2>/dev/null || true
}

resolve_ffmpeg() {
  if [ -n "${FFMPEG_BIN:-}" ] && [ -x "$FFMPEG_BIN" ]; then echo "$FFMPEG_BIN"; return 0; fi
  local candidates=( "./bin/ffmpeg" "/opt/homebrew/bin/ffmpeg" "/usr/local/bin/ffmpeg" )
  for c in "${candidates[@]}"; do
    [ -x "$c" ] && { echo "$c"; return 0; }
  done
  command -v ffmpeg 2>/devnull || true
}

# read first 4 bytes (little-endian) as length
read_bytes() {
  local n
  n=$(dd bs=4 count=1 2>/dev/null | od -An -t u4)
  echo $n
}

# read JSON message of given length
read_message() {
  local len=$1
  if [ "$len" -gt 0 ]; then
    dd bs=1 count=$len 2>/dev/null
  fi
}

# write a proper native response (length header + json) via python (little-endian)
respond_json() {
  local resp="$1"
  /usr/bin/python3 - "$resp" <<'PY' 1>/dev/stdout 2>>/tmp/ytdlp_host.log
import sys, struct
payload = sys.argv[1].encode('utf-8')
sys.stdout.buffer.write(struct.pack('<I', len(payload)))
sys.stdout.buffer.write(payload)
sys.stdout.flush()
PY
  log "responded json=$resp"
}

# write cookies in Netscape format to /tmp/ytcookies_<videoId>.txt
write_netscape_cookies() {
  local json="$1"
  local vid="$2"
  local outfile="/tmp/ytcookies_${vid}.txt"

  local tmpjson
  tmpjson=$(mktemp /tmp/ytmsg.XXXXXX.json)
  printf '%s' "$json" > "$tmpjson"

  /usr/bin/python3 - "$tmpjson" "$outfile" 1> /tmp/.ytdlp_cookie_out.$$ 2>>"$LOG_FILE" <<'PY'
import sys, json, time, os

infile = sys.argv[1]
outfile = sys.argv[2]

with open(infile, 'r', encoding='utf-8') as f:
    data = json.load(f)

cookies = data.get('cookies', [])

lines = [
    "# Netscape HTTP Cookie File",
    f"# Generated at {time.strftime('%Y-%m-%d %H:%M:%S')}",
    ""
]

def to_int(v):
    try:
        return int(v)
    except Exception:
        return 0

for c in cookies:
    domain = c.get('domain', '')
    if not domain:
        continue
    include_sub = 'TRUE' if domain.startswith('.') else 'FALSE'
    path = c.get('path') or '/'
    secure = 'TRUE' if c.get('secure') else 'FALSE'
    exp = to_int(c.get('expirationDate') or c.get('expires') or 0)
    name = c.get('name', '')
    value = c.get('value', '')
    if not name:
        continue
    lines.append(f"{domain}\t{include_sub}\t{path}\t{secure}\t{exp}\t{name}\t{value}")

with open(outfile, 'w', encoding='utf-8') as f:
    f.write("\n".join(lines) + "\n")
try:
    os.chmod(outfile, 0o600)
except Exception:
    pass

print(outfile)
PY

  local rc=$?
  rm -f "$tmpjson"

  if [ $rc -ne 0 ]; then
    log "[cookies] python failed rc=$rc"
    rm -f /tmp/.ytdlp_cookie_out.$$ 2>/dev/null
    return 1
  fi

  local produced
  produced=$(cat /tmp/.ytdlp_cookie_out.$$ 2>/dev/null)
  rm -f /tmp/.ytdlp_cookie_out.$$ 2>/dev/null

  if [ -z "$produced" ] || [ ! -f "$produced" ]; then
    log "[cookies] empty output or file not found: $produced"
    return 2
  fi

  log "[cookies] wrote Netscape file: $produced"
  echo "$produced"
  return 0
}

# 基于 cookies 文件与 URL，产出下拉列表（label/value）
build_format_dropdown() {
  local cookie_file="$1"
  local url="$2"

  /usr/bin/python3 - "$cookie_file" "$url" <<'PY'
import sys, json, subprocess, shutil, os

cookie_file, url = sys.argv[1], sys.argv[2]

# ---- resolve yt-dlp (must exist & executable) ----
candidates = []
if os.environ.get("YT_DLP_BIN"):
    candidates.append(os.environ["YT_DLP_BIN"])
candidates += [
    "./bin/yt-dlp_macos",
    "/opt/homebrew/bin/yt-dlp",
    "/usr/local/bin/yt-dlp",
    "yt-dlp",
]

def resolve(binname):
    if "/" in binname:
        return binname if (os.path.isfile(binname) and os.access(binname, os.X_OK)) else None
    return shutil.which(binname)

ytbin = None
tried = []
for c in candidates:
    tried.append(c)
    r = resolve(c)
    if r:
        ytbin = r
        break

def emit_error(kind, detail=None, stderr=None):
    print(json.dumps({
        "ok": False,
        "error": kind,
        "detail": detail,
        "stderr": (stderr or "")[:4000],
    }))
    sys.exit(0)

if not ytbin:
    emit_error("yt_dlp_not_found", {"tried": tried})

# ---- run yt-dlp -J synchronously with timeout ----
try:
    proc = subprocess.run(
        [ytbin, "-J", "--cookies", cookie_file, url],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        timeout=20
    )
except subprocess.TimeoutExpired as e:
    emit_error("yt_dlp_timeout", {"timeout_sec": 20}, stderr=str(e))
except FileNotFoundError as e:
    emit_error("yt_dlp_not_found", {"bin": ytbin}, stderr=str(e))
except Exception as e:
    emit_error("yt_dlp_exec_error", {"bin": ytbin, "type": type(e).__name__}, stderr=str(e))

if proc.returncode != 0:
    emit_error("yt_dlp_nonzero_exit", {"code": proc.returncode, "bin": ytbin}, stderr=proc.stderr)

try:
    data = json.loads(proc.stdout)
except Exception as e:
    emit_error("parse_json_failed", {"reason": str(e)})

formats = data.get("formats", [])

# ---------- filters & helpers ----------
ALLOWED_VIDEO_EXT = {"mp4", "webm"}
MIN_HEIGHT = 144
def is_storyboard(f):
    ext = (f.get("ext") or "").lower()
    fn  = (f.get("format_note") or "").lower()
    return (ext == "mhtml") or ("storyboard" in fn) or ("images" in fn)
def is_m3u8_progressive(f):
    proto = (f.get("protocol") or "").lower()
    return proto.startswith("m3u8")
def valid_video_only(f):
    if is_storyboard(f): return False
    if (f.get("acodec") != "none"): return False
    h = f.get("height")
    if h is None or h < MIN_HEIGHT: return False
    if (f.get("vcodec") or "") == "none": return False
    ext = (f.get("ext") or "").lower()
    return ext in ALLOWED_VIDEO_EXT
def valid_progressive(f):
    if is_storyboard(f): return False
    if is_m3u8_progressive(f): return False
    if (f.get("acodec") in (None, "none")): return False
    if (f.get("vcodec") in (None, "none")): return False
    h = f.get("height")
    if h is None or h < MIN_HEIGHT: return False
    ext = (f.get("ext") or "").lower()
    return ext in ALLOWED_VIDEO_EXT
def valid_audio_only(f):
    return (f.get("vcodec") == "none")
def codec_tag(vc):
    vc = vc or ""
    if vc.startswith("avc1"): return "AVC"
    if vc.startswith("vp9"):  return "VP9"
    if vc.startswith("av01"): return "AV1"
    return vc or "?"

video_only = []
audio_only = []
progressive = []

for f in formats:
    fid = f.get("format_id")
    if not fid:
        continue
    if valid_video_only(f):
        video_only.append({"id": fid, "height": int(f.get("height") or 0), "vcodec": f.get("vcodec") or ""})
    elif valid_audio_only(f):
        audio_only.append({"id": fid, "acodec": f.get("acodec") or "", "abr": f.get("abr") or 0})
    elif valid_progressive(f):
        progressive.append({
            "id": fid,
            "height": int(f.get("height") or 0),
            "ext": (f.get("ext") or ""),
            "vcodec": (f.get("vcodec") or ""),
            "acodec": (f.get("acodec") or "")
        })

preferred_audio = next((a for a in audio_only if a["id"] == "140"), None)

items = []
if preferred_audio:
    for v in video_only:
        items.append({
            "label": f'{v["height"]}p {codec_tag(v["vcodec"])} (merge)',
            "value": f'{v["id"]}+140',
            "height": v["height"],
            "kind": "merge"
        })

for p in progressive:
    items.append({
        "label": f'{p["height"]}p {p.get("ext","").upper()} (progressive)',
        "value": p["id"],
        "height": p["height"],
        "kind": "single"
    })

items.sort(key=lambda x: (x.get("height") or 0, x.get("kind")=="single"), reverse=True)
seen = set()
uniq = []
for it in items:
    if it["value"] in seen:
        continue
    seen.add(it["value"])
    uniq.append(it)

print(json.dumps({"ok": True, "items": uniq}))
PY
}

# --- NEW: start background download of first item, log-only, no response ---
start_background_download_first() {
  local cookie_file="$1"   # /tmp/ytcookies_xxx.txt
  local url="$2"           # video url
  local formats_json="$3"  # json object string {"ok":..., "items":[...]}

  # 解析第一项的 value/label
  local sel_json fsel label
  sel_json=$(/usr/bin/python3 - "$formats_json" <<'PY' 2>>"$LOG_FILE"
import sys, json
try:
    j = json.loads(sys.argv[1])
    if j.get("ok") and j.get("items"):
        it = j["items"][0]
        print(json.dumps({"value": it.get("value",""), "label": it.get("label","")}, ensure_ascii=False))
    else:
        print("{}")
except Exception:
    print("{}")
PY
)
  fsel=$(/usr/bin/python3 - "$sel_json" <<'PY' 2>>"$LOG_FILE"
import sys, json
try:
    d=json.loads(sys.argv[1]); print(d.get("value",""))
except Exception:
    print("")
PY
)
  label=$(/usr/bin/python3 - "$sel_json" <<'PY' 2>>"$LOG_FILE"
import sys, json
try:
    d=json.loads(sys.argv[1]); print(d.get("label",""))
except Exception:
    print("")
PY
)

  if [ -z "$fsel" ]; then
    log "[download] no selectable item, skip."
    return 0
  fi

  (
    local yt ff
    yt="$(resolve_yt_dlp)"
    ff="$(resolve_ffmpeg)"
    if [ -z "$yt" ]; then
      log "[download] yt-dlp not found; abort."
      exit 0
    fi

    # 组装命令
    local out_tmpl="${HOME}/Downloads/%(title)s.%(ext)s"
    local cmd=( "$yt" --cookies "$cookie_file" -f "$fsel" --merge-output-format mp4 )
    [ -n "$ff" ] && cmd+=( --ffmpeg-location "$ff" )
    cmd+=( --newline -o "$out_tmpl" "$url" )

    log "[download] start label='${label}' format='${fsel}' yt='${yt}' ffmpeg='${ff}' out='${out_tmpl}' url='${url}'"
    "${cmd[@]}" >>"$LOG_FILE" 2>&1
    local rc=$?
    log "[download] done rc=${rc}"
  ) &
}

log "ytdlp_host.sh started"

while true; do
  len=$(read_bytes)
  if [ -z "$len" ]; then
    log "eof"
    exit 0
  fi

  msg=$(read_message $len)
  log "received: $msg"

  action=$(printf '%s' "$msg" | /usr/bin/python3 -c 'import sys,json; print(json.load(sys.stdin).get("action",""))' 2>>"$LOG_FILE")

  if [ "$action" = "probe" ]; then
    vid=$(printf '%s' "$msg" | /usr/bin/python3 -c 'import sys,json; print(json.load(sys.stdin).get("videoId","unknown"))' 2>>"$LOG_FILE")
    cookie_path=$(write_netscape_cookies "$msg" "$vid")
    rc=$?
    if [ $rc -eq 0 ]; then
      url=$(printf '%s' "$msg" | /usr/bin/python3 -c 'import sys,json; print(json.load(sys.stdin).get("url",""))' 2>>"$LOG_FILE")

      # 默认合法对象
      formats_json='{"ok":false,"items":[]}'
      if [ -n "$url" ]; then
        if out=$(build_format_dropdown "$cookie_path" "$url" 2>>"$LOG_FILE"); then
          if printf '%s' "$out" | head -c 1 | grep -q '{'; then
            formats_json="$out"
          else
            log "[formats] invalid output head: $(printf '%s' "$out" | head -c 80)"
          fi
        else
          log "[formats] build_format_dropdown failed"
        fi
      fi

      # --- 触发后台下载第一项（仅写日志，不返回给 background）---
      start_background_download_first "$cookie_path" "$url" "$formats_json"

      # 仍按原协议返回 cookie_file + formats（供前端显示/选择）
      payload=$(/usr/bin/python3 - "$cookie_path" "$formats_json" <<'PY'
import sys, json
cookie = sys.argv[1]
try:
    formats = json.loads(sys.argv[2])
except Exception:
    formats = {"ok": False, "items": []}
print(json.dumps({"ok": True, "cookie_file": cookie, "formats": formats}, ensure_ascii=False))
PY
)
      respond_json "$payload"
    else
      respond_json "$(printf '{"ok":false,"error":"cookie_write_failed","code":%d}' "$rc")"
    fi
    continue
  fi

  # default echo
  respond_json '{"ok":true,"echo":'"$msg"'}'
done
