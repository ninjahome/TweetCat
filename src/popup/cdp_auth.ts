import { initialize, signInWithOAuth } from "@coinbase/cdp-core";

const PROJECT_ID = "602a8505-5645-45e5-81aa-a0a642ed9a0d";

document.addEventListener("DOMContentLoaded", initDashBoard as EventListener);
async function initDashBoard(): Promise<void> {

    init().catch(err => {
        console.error(err);
        document.body.innerText = "初始化失败";
    });
}

async function init() {
    await initialize({
        projectId: PROJECT_ID,
        ethereum: {
            createOnLogin: "smart",
        },
    });

    bind();
}

function bind() {
    const status = document.getElementById("status") as HTMLElement;
    document.getElementById("btn-google")?.addEventListener("click", () => {
        status.innerText = "正在跳转到 Google 登录...";
        signInWithOAuth("google").then();
    });

    document.getElementById("btn-apple")?.addEventListener("click", () => {
        status.innerText = "正在跳转到 Apple 登录...";
        signInWithOAuth("apple").then();
    });

    document.getElementById("btn-x")?.addEventListener("click", () => {
        status.innerText = "正在跳转到 X 登录...";
        signInWithOAuth("x").then();
    });
}

