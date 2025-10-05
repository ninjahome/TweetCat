import {sendMsgToService} from "../common/utils";
import {choseColorByID, defaultAllCategoryID, MsgType} from "../common/consts";
import {EntryObj} from "../timeline/tweet_entry";
import {switchCategory} from "./tweetcat_timeline";
import {Category, queryCategoriesFromBG} from "../object/category";
import {logTPR} from "../common/debug_flags";
import {getSessCatID} from "../timeline/tweet_pager";
import {parseContentHtml} from "./main_entrance";
import {t} from "../common/i18n";
import {showToastMsg} from "../timeline/render_common";
import {addGrokResponse, createGrokConversation} from "../timeline/twitter_api";

const defaultCatPointColor = '#B9CAD3';

export function setSelectedCategory(catID: number = defaultAllCategoryID) {
    document.querySelectorAll<HTMLElement>(".category-filter-item").forEach(elm => {
            const emlCatID = Number(elm.dataset.categoryID);
            if (emlCatID === catID) {
                elm.classList.add("active");
                elm.style.setProperty("--cat-point-color", choseColorByID(emlCatID));
            } else {
                elm.classList.remove("active");
                elm.style.setProperty("--cat-point-color", defaultCatPointColor);
            }
        }
    );
}

export async function addMoreCategory() {
    await sendMsgToService("#onboarding/main-home", MsgType.OpenPlugin);
}

const onNewestNotificationClick = async (ev: Event) => {
    const notificationContainer = ev.currentTarget as HTMLElement;
    notificationContainer.style.display = "none";
    await switchCategory(defaultAllCategoryID);
    setSelectedCategory(defaultAllCategoryID);
};

export async function showNewestTweets(tweets: EntryObj[]) {
    const notificationContainer = document.querySelector(".new-tweet-notification") as HTMLElement;
    if (!notificationContainer) {
        console.warn("notificationContainer not found");
        return;
    }

    notificationContainer.removeEventListener("click", onNewestNotificationClick);
    notificationContainer.addEventListener("click", onNewestNotificationClick);

    notificationContainer.style.display = "block";
    const numberDiv = notificationContainer.querySelector(".tweet-no") as HTMLElement;
    numberDiv.innerText = '' + tweets.length;
}

export function resetNewestTweet() {
    const notificationContainer = document.querySelector(".new-tweet-notification") as HTMLElement;
    if (!notificationContainer) {
        console.warn("notificationContainer not found");
        return;
    }
    const numberDiv = notificationContainer.querySelector(".tweet-no") as HTMLElement;
    numberDiv.innerText = '';
    notificationContainer.style.display = "none";
}

export async function resetCategories() {
    await switchCategory(defaultAllCategoryID);
    setSelectedCategory(defaultAllCategoryID);
}

export async function changeFilterType(catId: number) {
    await switchCategory(catId);
    setSelectedCategory(catId);
    showAITrendBtn(catId);
}

export async function setupFilterItemsOnWeb3Area(tpl: HTMLTemplateElement, main: HTMLElement) {
    const filterContainerDiv = tpl.content.getElementById("category-filter-container")?.cloneNode(true) as HTMLElement;
    if (!filterContainerDiv) {
        console.error(`------>>> failed to filter buttons container `);
        return;
    }

    filterContainerDiv.removeAttribute('id');

    const container = main.querySelector(".tweet-main .tweet-cat-filter-area") as HTMLElement
    if (!container) {
        console.warn("🚨------>>> failed to find tweet cat filter area");
        return
    }
    container.appendChild(filterContainerDiv);

    const categories = await queryCategoriesFromBG();
    populateCategoryArea(tpl, categories, filterContainerDiv);

    const AIBtn = document.querySelector(".btn-ai-trend-of-category") as HTMLElement;
    AIBtn.addEventListener('click', grokConversation)
}

function populateCategoryArea(tpl: HTMLTemplateElement, categories: Category[], container: HTMLElement) {
    const filterBtn = tpl.content.getElementById("category-filter-item")?.cloneNode(true) as HTMLElement;
    const moreBtn = tpl.content.getElementById("category-filter-more")?.cloneNode(true) as HTMLElement;
    const allCatBtnDiv = tpl.content.getElementById("category-filter-clear")?.cloneNode(true) as HTMLElement;

    const allCatBtn = allCatBtnDiv.querySelector(".category-filter-clear-btn") as HTMLButtonElement
    allCatBtn.innerText = t('all');
    allCatBtn.addEventListener("click", resetCategories);
    allCatBtnDiv.dataset.categoryID = '' + defaultAllCategoryID;
    container.appendChild(allCatBtnDiv);

    categories.forEach((category) => {
        const cloneItem = filterBtn.cloneNode(true) as HTMLElement;
        cloneItem.id = "category-filter-item-" + category.id;
        cloneItem.dataset.categoryID = '' + category.id
        const btn = cloneItem.querySelector(".category-filter-btn") as HTMLElement
        btn.innerText = category.catName;
        btn.addEventListener('click', async () => {
            await changeFilterType(category.id ?? defaultAllCategoryID);
        });
        container.appendChild(cloneItem);
    });

    moreBtn.querySelector(".category-filter-more-btn")!.addEventListener('click', addMoreCategory);
    container.appendChild(moreBtn);
    logTPR("✅ ------>>> add filter container success")
    setSelectedCategory(getSessCatID());
}

export async function reloadCategoryContainer(categories: Category[]) {
    const container = document.querySelector(".category-filter-container") as HTMLElement
    if (!container) {
        console.warn("🚨------>>> failed to find tweet cat filter area");
        return
    }
    container.innerHTML = '';
    const tpl = await parseContentHtml("html/content.html");
    populateCategoryArea(tpl, categories, container);
    const savedCatID = getSessCatID();
    const target = categories.find(item => item.id === savedCatID);
    if (!target) {
        await switchCategory(defaultAllCategoryID);
        setSelectedCategory(defaultAllCategoryID);
    }
}

/** 进度条注册表（按文件名管理一个 DOM 项目和它的控制器） */
const progressRegistry = new Map<
    string,
    { el: HTMLElement; total: number }
>();


export function onVideoDownloadStart(total: number, filename: string, controller: AbortController, hostDiv?: HTMLElement) {
    let rec = progressRegistry.get(filename);
    if (!!rec || total === 0) return;

    if (!hostDiv) {
        hostDiv = document.querySelector(".download-progress-list") as HTMLElement;
    }
    const processBar = document.querySelector(".download-progress-item")?.cloneNode(true) as HTMLElement;
    if (!processBar) return;

    processBar.style.display = 'block';

    (processBar.querySelector(".dpi-name") as HTMLSpanElement).innerText = filename;
    const cancelBtn = processBar.querySelector(".dpi-cancel") as HTMLButtonElement;
    cancelBtn.innerText = t('cancel');
    cancelBtn.addEventListener('click', () => {
        try {
            controller.abort();
        } finally {
            finalize(filename)
        }
    });

    rec = {el: processBar, total};
    progressRegistry.set(filename, rec);

    hostDiv.appendChild(processBar);
}

/** 简单字节格式化 */
function formatBytes(n: number): string {
    const units = ["B", "KB", "MB", "GB", "TB"];
    let i = 0, v = n;
    while (v >= 1024 && i < units.length - 1) {
        v /= 1024;
        i++;
    }
    return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export function onVideoDownloadProgress(filename: string, loaded: number) {
    const rec = progressRegistry.get(filename)
    if (!rec) return;

    const total = rec.total
    // 2) 更新显示
    const progressEl = rec.el.querySelector(".dpi-progress") as HTMLProgressElement | null;
    const percentEl = rec.el.querySelector(".dpi-percent") as HTMLElement | null;
    const sizeEl = rec.el.querySelector(".dpi-size") as HTMLElement | null;

    const pct = Math.max(0, Math.min(100, Math.floor((loaded / total) * 100)));
    if (progressEl) {
        progressEl.max = 100;
        progressEl.value = pct;
    }
    if (percentEl) percentEl.textContent = `${pct}%`;
    if (sizeEl) sizeEl.textContent = `${formatBytes(loaded)} / ${formatBytes(total)}`;
}

function finalize(filename: string) {
    const rec = progressRegistry.get(filename)
    if (!rec) return;
    rec.el.remove();
    progressRegistry.delete(filename);
}

export function onVideoDownloadError(filename: string, error: Error) {
    finalize(filename);
    alert("download error:" + error.message);
}

export function onVideoDownloadAbort(filename: string) {
    finalize(filename);
}

export function onVideoDownloadSuccess(filename: string) {
    finalize(filename);
}


function showAITrendBtn(catId: number) {
    const AIBtn = document.querySelector(".ai-trend-by-grok") as HTMLElement;
    if (!AIBtn) {
        console.warn("AIBtn not found");
        return;
    }

    if (catId === defaultAllCategoryID) AIBtn.style.display = 'none';
    else AIBtn.style.display = 'block';
}

async function grokConversation() {
    const gwo = document.getElementById("global-wait-overlay") as HTMLElement;
    const detail = document.getElementById("global-wait-detail") as HTMLElement;

    gwo.style.display = "block";
    detail.innerText = t("wait_start_grok");

    const killer = setTimeout(() => {
        gwo.style.display = "none";
        showToastMsg(t("failed_grok_result"));
    }, 30_000);

    try {
        const conversationID = await createGrokConversation();
        console.log("convId:", conversationID);
        const prompt = `
        你是推特的内容搜索引擎，你作为 grok ，和 x 平台是同一家公司旗下的产品，你是可以拿到 x 平台的数据进行学习和加工的，
        现在需要你做的是：
        @0xAA_Science, @0xSunNFT, @0x_Allending, @BTCdayu, @BillGates, @Joylou1209, @NFTfafafa, @Phyrex_Ni, @WutalkWu,
         @_FORAB, @ai_9684xtpa, @bitfish1, @evilcos, @hexiecs, @huahuayjy, @lanhubiji, @realDonaldTrump, @tmel0211, @tweetCatOrg。
        以上这些推特账号在最近24小时内讨论最多最热的三个话题是什么？按照总互动 40% + ER 30% + Views 20% + Mentions 10%的权重来定义最热
        `

        // const prompt ="24小时内，web3领域最新的最热的话题，列出 3 个";

        const { text, meta } = await addGrokResponse(conversationID, prompt, {
            keepOnlyFinal: true,                         // 只要最终答案片段
            stripXaiTags: true,                          // 去掉 <xai:...> 标签
            onToken: (t) => {                            // 流式追加
                detail.textContent += t;
            },
            onEvent: (e) => {},
        });

        console.log("final:", text);
        console.log("meta:", meta);
        clearTimeout(killer);
        // 你可以在此把 detail 替换成最终文本，或直接展示
        gwo.style.display = "none";
    } catch (e) {
        clearTimeout(killer);
        gwo.style.display = "none";
        console.error(e);
        showToastMsg(t("failed_grok_result"));
    }
}
