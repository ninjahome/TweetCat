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
    AIBtn.addEventListener('click', () => {
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
        return;
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


const grokCache: Record<number, { kolNames: string; text: string; timestamp: number }> = {};

async function grokConversation() {

    const AIBtn = document.querySelector(".ai-trend-by-grok") as HTMLElement;
    const catID = Number(AIBtn.dataset.currentID) || defaultAllCategoryID;

    const kolMaps = await queryFilterFromBG(catID);
    if (kolMaps.size === 0) {
        showDialog(t('warning'), t('no_kol_in_category'));
        return;
    }

    const kolNames = Array.from(kolMaps.values())
        .map((kol) => `@${kol.kolName}`)
        .sort()
        .join(", ");

    console.log(kolNames);

    // ====== 缓存检查 ======
    const now = Date.now();
    const cacheEntry = grokCache[catID];
    if (
        cacheEntry &&
        kolNames === cacheEntry.kolNames &&
        now - cacheEntry.timestamp <= 60 * 60 * 1000
    ) {
        console.log("命中缓存:", cacheEntry);
        showResult(cacheEntry.text);
        return;
    }

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

        const prompt = `
请分析以下 X 平台账号在最近 24 小时的发帖内容，找出最热的三个话题，并严格以 JSON 格式输出。

账号列表：

${kolNames}

【话题热度计算规则】
- **总互动 (40%)**：点赞、转推、回复、收藏总数。为避免单一大号主导，先对每个账号数据做 log10(互动数+1) 标准化并归一化到 [0,1]，再跨账号求和。
- **ER 互动率 (25%)**：总互动数 ÷ 浏览量。取 log10(ER+0.0001)，再归一化到 [0,1]。
- **浏览量 (20%)**：对浏览量 log10(浏览量+1)，归一化到 [0,1]，跨账号求和。
- **提及账号比例 (15%)**：参与该话题的账号数 ÷ 总账号数，直接取值 [0,1]。

热度分数计算公式：
热度分数 = 0.4 × 总互动 + 0.25 × ER + 0.2 × 浏览量 + 0.15 × 提及账号比例

【分析与输出要求】
1. 按热度分数降序，输出前三个话题。  
2. 所有字段必须与提问语言一致：如果问题是中文，则输出中文；如果是英文，则输出英文。  
3. 每个话题对象必须包含以下字段：
   - "name": 话题名称 (string)
   - "description": 简要描述 (≤ 50字，自然语言，不允许拼接无空格的单词)
   - "score": 热度分数 (0–100 的整数，归一化后乘 100)
   - "main_factor": 主要驱动因素 (string，指贡献最大的指标)
   - "accounts": 数组，包含 1–2 个示例账号（仅限输入列表内），每个元素包含：
       - "account": 账号名 (string)
       - "post": 推文的唯一 ID (string)，禁止输出推文内容。
   - "participation": "X/Y" 格式，X 为参与该话题的账号数，Y 为总账号数

【特殊处理规则】
- 若部分账号 24 小时内无活跃帖子，应注明，并基于可用数据分析。  
- 若某个账号发帖量少但互动极高，需在结果中标注其对热度的潜在影响。  
- 若话题内容高度相似，应合并为一个主题，避免重复。  

【输出格式示例】
{
  "topics": [
    {
      "name": "示例话题",
      "description": "简要描述…",
      "score": 87,
      "main_factor": "总互动",
      "accounts": [
        {"account": "@Alice", "post": "post id"}
      ],
      "participation": "5/20"
    }
  ]
}
`
        const {text, meta} = await addGrokResponse(conversationID, prompt, {
            keepOnlyFinal: true,                         // 只要最终答案片段
            stripXaiTags: true,                          // 去掉 <xai:...> 标签
            onToken: (t) => {                     // 流式追加
                detail.textContent += t;
            },
            // onEvent: (e) => {
            // },
        });

        console.log("meta:", meta);

        clearTimeout(killer);
        gwo.style.display = "none";

        showResult(text);

        grokCache[catID] = {
            kolNames,
            text,
            timestamp: Date.now(),
        };
    } catch (e) {
        clearTimeout(killer);
        gwo.style.display = "none";
        console.error(e);
        showToastMsg(t("failed_grok_result"));
    }
}

const aiTrendDivID = 'aiTrendDivID'
function showResult(text: string) {
    const data = JSON.parse(text);
    if (!data.topics || data.topics.length === 0) throw new Error("Invalid Result");

    // 克隆模板
    const aiTrendTemplate = document.getElementById("ai-trend-result")!;
    const aiTrendResult = aiTrendTemplate.cloneNode(true) as HTMLElement;
    aiTrendResult.style.display = 'flex';
    aiTrendResult.id = aiTrendDivID;

    console.log("最终结果:", data);

    // 拿到模板中的 topicCard 和 actions
    const topicCard = aiTrendTemplate.querySelector(".topic-card") as HTMLElement;
    const actions = aiTrendTemplate.querySelector(".ai-trend-actions") as HTMLElement;

    // 清空克隆容器
    aiTrendResult.innerHTML = '';

    // 渲染话题卡片
    data.topics.forEach((topic: any) => {
        const clone = topicCard.cloneNode(true) as HTMLElement;

        (clone.querySelector(".topic-name") as HTMLElement).innerText = topic.name;
        (clone.querySelector(".topic-score") as HTMLElement).innerText = topic.score + " 分";
        (clone.querySelector(".topic-desc") as HTMLElement).innerText = topic.description;
        (clone.querySelector(".topic-main-factor") as HTMLElement).innerText = topic.main_factor;
        (clone.querySelector(".topic-participation") as HTMLElement).innerText = topic.participation;

        const accountDiv = clone.querySelector(".topic-accounts") as HTMLElement;
        const accountItem = accountDiv.querySelector(".account") as HTMLElement;
        accountDiv.innerHTML = '';

        topic.accounts.forEach((acc: any) => {
            const accountClone = accountItem.cloneNode(true) as HTMLElement;
            const accountName = accountClone.querySelector(".account-name") as HTMLAnchorElement;
            accountName.textContent =acc.account;
            const handle = acc.account.startsWith("@") ? acc.account.slice(1) : acc.account;
            accountName.href = `https://twitter.com/${handle}`;

            const accountPost = accountClone.querySelector(".account-post") as HTMLAnchorElement;
            accountPost.textContent = acc.post; // 可以直接显示 ID，或者写成 "查看推文"
            accountPost.href = `https://twitter.com/${handle}/status/${acc.post}`;
            accountDiv.appendChild(accountClone);
        });

        aiTrendResult.appendChild(clone);
    });

    // 把 actions 区域加回去
    const actionsClone = actions.cloneNode(true) as HTMLElement;
    const confirmBtn = actionsClone.querySelector(".ai-trend-confirm-btn") as HTMLButtonElement;
    confirmBtn.innerText = "确定";
    confirmBtn.addEventListener('click', () => {
        aiTrendResult.remove();
    });

    aiTrendResult.appendChild(actionsClone);

    // 显示在 body 最上方
    document.body.prepend(aiTrendResult);
}
