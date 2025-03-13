import browser from "webextension-polyfill";

export async function sendMsgToService(data: any, actTyp: string): Promise<any> {
    try {
        return await browser.runtime.sendMessage({
            action: actTyp,
            data: data,
        });
    } catch (e) {
        const error = e as Error;
        console.log("------>>>send message error", error, data, actTyp);
        if (error.message.includes("Extension context invalidated")) {
            window.location.reload();
        }
        return {success: -1, data: error.message}
    }
}