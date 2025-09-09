export type VideoMeta = {
    videoID:string
    title: string;
    duration: number;   // 秒数
    thumbs: Array<{ url: string; width: number; height: number }>;
};