import sys
import yt_dlp
from tweetcat_ydl.server import main as server_main
import ssl, certifi
ssl._create_default_https_context = lambda: ssl.create_default_context(cafile=certifi.where())

if __name__ == "__main__":
    if "--version" in sys.argv:
        print("tweetcat_ydl_server 1.0.0")
        print("yt_dlp version:", yt_dlp.version.__version__)
        sys.exit(0)

    server_main()
