export type Stream = {
    itag: string;
    mimeType: string;
    url: string;
    width?: number;
    height?: number;
    fps?: number;
    bitrate?: number;
    audioQuality?: string;
    approxDurationMs?: string;
};

export function refreshYoutubeUI(streams: Stream[]) {
}
