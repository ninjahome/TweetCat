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
        grokConversation();
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

async function grokConversation() {

    const AIBtn = document.querySelector(".ai-trend-by-grok") as HTMLElement;
    const catID = Number(AIBtn.dataset.currentID) || defaultAllCategoryID;

    const kolMaps = await queryFilterFromBG(catID);
    if (kolMaps.size === 0) {
        showDialog(t('warning'), t('no_kol_in_category'));
        return;
    }

    const kolNames = Array.from(kolMaps.values()) // 拿到所有 TweetKol 对象
        .map(kol => `@${kol.kolName}`)            // 每个名字加上@
        .join(", ");                               // 用逗号拼接

    console.log(kolNames);

    const gwo = document.getElementById("global-wait-overlay") as HTMLElement;
    const detail = document.getElementById("global-wait-detail") as HTMLElement;

    gwo.style.display = "block";
    detail.innerText = t("wait_start_grok");

    const killer = setTimeout(() => {
        gwo.style.display = "none";
        showToastMsg(t("failed_grok_result"));
    }, 50_000);

    try {
        const conversationID = await createGrokConversation();
        console.log("convId:", conversationID);

        const language = t('ai_output_language');
        const prompt = `
请分析以下X账号在最近24小时内讨论的最热三个话题，并严格输出为 JSON 数据。

账号列表：
${kolNames}

【话题热度定义规则】
- 总互动（40%）：点赞、转推、回复、收藏总数，log10 标准化后归一化到 [0,1]。
- ER（25%）：总互动 / 浏览量，经 log10 标准化 + 归一化。
- 浏览量（20%）：log10 标准化 + 归一化。
- 提及账号比例（15%）：提及该话题的账号数 / 总账号数。

热度分数 = 0.4 × 互动 + 0.25 × ER + 0.2 × 浏览量 + 0.15 × 提及比例。  
按分数降序排列，输出前三个话题。

【输出要求】
- 严格输出 JSON 对象，不要任何解释或额外文字。
- JSON 顶层为 "topics"，其值是一个数组，包含三个对象。
- 每个对象字段如下：
  - "name": 话题名称 (string)
  - "description": 简要描述 (<= 50字)
  - "score": 热度分数 (0-100，四舍五入整数)
  - "main_factor": 主要驱动因素 (string)
  - "accounts": 数组，每个元素包含：
      - "account": 账号名 (string)
      - "post": 示例帖子ID或内容 (string)
  - "participation": "X/Y" 格式，X为提及该话题账号数，Y为总账号数

【示例输出】
{
  "topics": [
    {
      "name": "Topic1",
      "description": "简要描述...",
      "score": 87,
      "main_factor": "总互动",
      "accounts": [
        {"account": "@Alice", "post": "post123"},
        {"account": "@Bob", "post": "post456"}
      ],
      "participation": "5/20"
    },
    {
      "name": "Topic2",
      "description": "简要描述...",
      "score": 75,
      "main_factor": "ER",
      "accounts": [
        {"account": "@Charlie", "post": "post789"}
      ],
      "participation": "3/20"
    },
    {
      "name": "Topic3",
      "description": "简要描述...",
      "score": 65,
      "main_factor": "浏览量",
      "accounts": [],
      "participation": "2/20"
    }
  ]
}
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
