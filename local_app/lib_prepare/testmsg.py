# testmsg.py
import sys, json, struct

msg = {"action": "probe", "url": "https://example.com", "videoId": "abc123", "cookies": []}
data = json.dumps(msg).encode("utf-8")

# 写入 4 字节长度 + 数据
sys.stdout.buffer.write(struct.pack("<I", len(data)))
sys.stdout.buffer.write(data)
