import threading
from .control_server import serve_control
from .stream_server import serve_stream

def main():
    t1 = threading.Thread(target=serve_control, name="control", daemon=True)
    t2 = threading.Thread(target=serve_stream, name="stream", daemon=True)

    t1.start()
    t2.start()

    print("[tweetcat_ydl] servers started (control + stream)", flush=True)

    # 主线程阻塞，直到子线程退出（一般不会退出）
    t1.join()
    t2.join()
