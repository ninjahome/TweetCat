export {};

declare global {
    interface Window {
        __currentPlaying?: HTMLVideoElement | null;
    }
}