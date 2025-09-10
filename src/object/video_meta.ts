export enum YouTubePageType {
    Watch = "watch",
    Shorts = "shorts",
}

export type VideoMeta = {
    videoID:string;
    videoTyp:YouTubePageType;
    title: string;
    duration: number;   // 秒数
    thumbs: Array<{ url: string; width: number; height: number }>;
};