export type YTFormatLite = {
    itag: number;
    qualityLabel?: string;
    mimeType: string;
    bitrate?: number;
    isAudioOnly?: boolean;
    isVideoOnly?: boolean;
    isProgressive?: boolean;
    contentLength?: number;
    url?: string;
    headers?: Record<string, string>;
    signatureCipher?: string;
    needsSignature?: boolean;
};

export type YTParsedLite = {
    videoId: string;
    title?: string;
    durationSec?: number;
    formats: YTFormatLite[];
    dashManifestUrl?: string;
    hlsManifestUrl?: string;
};