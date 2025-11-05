export {};

declare global {
    interface Window {
        __currentPlaying?: HTMLVideoElement | null;
        disposeTweetAutoplayObserver?: () => void;
    }
    const chrome: {
        runtime?: {
            sendMessage?: (message: any) => void;
        }
    } | undefined;
}