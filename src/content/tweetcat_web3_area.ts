import {sendMsgToService} from "../common/utils";
import {choseColorByID, defaultAllCategoryID, MsgType} from "../common/consts";
import {EntryObj} from "../timeline/tweet_entry";
import {switchCategory} from "./tweetcat_timeline";
import {Category, queryCategoriesFromBG} from "../object/category";
import {logTPR} from "../common/debug_flags";
import {getSessCatID} from "../timeline/tweet_pager";
import {parseContentHtml} from "./main_entrance";
import {t} from "../common/i18n";
import {showDialog, showToastMsg} from "../timeline/render_common";
import {addGrokResponse, createGrokConversation} from "../timeline/twitter_api";
import {queryFilterFromBG} from "../object/tweet_kol";

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
    showAITrendBtn(defaultAllCategoryID);
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
    showAITrendBtn(defaultAllCategoryID);
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
    AIBtn.addEventListener('click', (e) => {
        const currentID = Number(AIBtn.dataset.currentId) || defaultAllCategoryID;
        grokConversation(currentID);
    })
    AIBtn.querySelector("span").innerText = t('ai_trend_btn');
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
    const savedCatID = getSessCatID();
    logTPR("✅ ------>>> add filter container success, category id is:", savedCatID)
    setSelectedCategory(savedCatID);
    showAITrendBtn(savedCatID);
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
        showAITrendBtn(defaultAllCategoryID);
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

    AIBtn.dataset.currentID = catId + '';
    if (catId === defaultAllCategoryID) AIBtn.style.display = 'none';
    else AIBtn.style.display = 'block';
}

async function grokConversation(catID: number) {

    const kolMaps = await queryFilterFromBG(catID);
    if (kolMaps.size === 0) {
        showDialog(t('warning'), t('no_kol_in_category'));
        return;
    }

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

        const language = t('ai_output_language');
        const prompt = `
请分析以下X账号@0xAA_Science, @0xSunNFT, @0x_Allending, @BTCdayu, @BillGates, @Joylou1209, @NFTfafafa, @Phyrex_Ni, 
@WutalkWu, @_FORAB, @ai_9684xtpa, @bitfish1, @elonmusk, @evilcos, @hexiecs, @huahuayjy, @lanhubiji, @realDonaldTrump, 
@tmel0211, @tweetCatOrg 在最近24小时内讨论的最热三个话题。
话题热度的定义基于以下加权指标：总互动（40%）：包括点赞、转推、回复、收藏的总数。
为避免单一高影响力KOL（如Elon Musk）主导，计算时对每个账号的总互动数据进行对数标准化（log10(互动数+1)），
然后归一化到[0,1]范围，跨账号求和。 ER（互动率，25%）：定义为总互动数除以浏览量。为减少极端值影响，
ER也进行对数标准化（log10(ER+0.0001)），然后归一化到[0,1]范围，跨账号求和。 浏览量（20%）：对每个账号的浏览量进行对数标准化（log10(浏览量+1)），
归一化到[0,1]范围，跨账号求和。 提及账号比例（15%）：定义为提及该话题的账号数除以总账号数（即参与讨论的账号占比），直接取比例值[0,1]，
以反映多个KOL同时讨论的直观热度。热度计算步骤：提取每个话题的上述四个指标值。 
对总互动、ER、浏览量进行对数标准化和归一化处理（公式：(log10(x+offset) - min) / (max - min)，其中offset防止零值问题）。 
计算加权和：热度分数 = 0.4×标准化总互动 + 0.25×标准化ER + 0.2×标准化浏览量 + 0.15×提及账号比例。 按热度分数降序排列，
输出前三个话题。输出格式：列出最热三个话题，每个话题包括：话题名称和简要描述（50字以内）。 热度分数（0-100，归一化后乘100）。 
主要驱动因素（哪个指标贡献最大）。 提及该话题的代表性账号及示例帖子（每个话题至少1-2个账号，附帖子ID或简要内容）。 
参与讨论的账号比例（X/Y，X为提及话题的账号数，Y为总账号数）。若数据不足（如部分账号无活跃帖子），
注明并基于可用数据分析。 若需进一步聚焦某账号或话题，提供补充分析选项。
附加要求：确保分析基于最近24小时的X帖子数据，若需实时抓取，优先使用X平台数据。 
若某账号（如高影响力KOL）发帖量极少但互动极高，需在结果中标注其对热度的潜在影响。 若话题重叠或模糊，尝试合并相似主题，以避免重复。
`;

        const {text, meta} = await addGrokResponse(conversationID, prompt, {
            keepOnlyFinal: true,                         // 只要最终答案片段
            stripXaiTags: true,                          // 去掉 <xai:...> 标签
            onToken: (t) => {                     // 流式追加
                detail.textContent += t;
            },
            onEvent: (e) => {
            },
        });

        console.log("final:", text);
        console.log("meta:", meta);
        clearTimeout(killer);
        gwo.style.display = "none";
    } catch (e) {
        clearTimeout(killer);
        gwo.style.display = "none";
        console.error(e);
        showToastMsg(t("failed_grok_result"));
    }
}
