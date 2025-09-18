from tweetcat_ydl.downloader import run_download
from tweetcat_ydl.utils import NDJSONWriter
import sys, os

class StdoutWriter(NDJSONWriter):
    def send(self, obj):
        print(obj)

if __name__ == "__main__":
    home = os.path.expanduser("~")
    cookies_path = os.path.join(
        home,
        "Library",
        "Application Support",
        "TweetCat",
        "cookies.txt"
    )

    params = {
        "url": "https://www.youtube.com/watch?v=2_S8-0UfkUA",
        "task_id": "test1",
        "format_value": "worst",          # 用最差画质，下载更快
        "output_template": "test.%(ext)s",
        "cookies_path": cookies_path      # ✅ 使用 HOME 路径
    }
    run_download(StdoutWriter(sys.stdout), params)
