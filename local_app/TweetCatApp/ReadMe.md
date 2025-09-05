codesign -dv --verbose=4 "YourApp.app/Contents/Resources/Tools/ffmpeg"
codesign -dv --verbose=4 "YourApp.app/Contents/Resources/Tools/ffprobe"
codesign -dv --verbose=4 "YourApp.app/Contents/Resources/Tools/yt-dlp_macos"

lipo -info "YourApp.app/Contents/Resources/Tools/ffmpeg"
lipo -info "YourApp.app/Contents/Resources/Tools/ffprobe"
