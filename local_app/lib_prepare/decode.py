# decode.py
import sys, struct, json

hdr = sys.stdin.buffer.read(4)
n = struct.unpack("<I", hdr)[0]
body = sys.stdin.buffer.read(n)
print(json.dumps(json.loads(body.decode("utf-8")), indent=2, ensure_ascii=False))
