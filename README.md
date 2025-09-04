# TweetCat
twitter Category
nvm use 22.9.0 
zip -r dist.zip dist/

yt-dlp --cookies /tmp/ytcookies_nxal70pXgWg.txt \
-f "bv*[height=1080][ext=mp4][vcodec^=avc1]+ba[ext=m4a]/b[height=1080][ext=mp4]" \
--merge-output-format mp4 \
-o "~/Downloads/%(title)s.%(ext)s" \
"https://www.youtube.com/watch?v=nxal70pXgWg"
