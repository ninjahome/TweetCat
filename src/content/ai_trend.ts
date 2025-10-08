import {queryFilterFromBG} from "../object/tweet_kol";
import {t} from "../common/i18n";
import {showDialog, showToastMsg} from "../timeline/render_common";
import {addGrokResponse, createGrokConversation} from "../timeline/twitter_api";
import {defaultAllCategoryID} from "../common/consts";
import {logATA} from "../common/debug_flags";
import {sleep} from "../common/utils";

const basePrompts = {
    chinese: `
请分析以下 X 平台账号在最近 24 小时的发帖内容，找出最热的三个话题，并严格以 JSON 格式输出。

账号列表：
%s

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
       - "post": 推文内容片段 (string)，建议截取前 10–15 个词，禁止总结或改写。
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
        {"account": "@Alice", "post": "This is the beginning of Alice's tweet ..."}
      ],
      "participation": "5/20"
    }
  ]
}
`,

    english: `
Please analyze the posting activity of the following X platform accounts in the past 24 hours, identify the top three trending topics, and STRICTLY output one single JSON object only.

Account list:
%s

[ABSOLUTE OUTPUT RULES]
- The reply must be ONLY a valid JSON object. It must start with "{" and end with "}".
- Do NOT include any explanations, comments, headers, markdown, code fences, safety notes, or any text outside the JSON.
- Use ASCII double quotes (") for all strings. No trailing commas. No newlines inside string values.
- The top-level JSON MUST have exactly one key: "topics", whose value is an array with exactly 3 topic objects.

[FIELD REQUIREMENTS]
Each topic object must include ALL of the following fields:
- "name_words": An array of strings. Each word of the topic title must be a separate element, properly capitalized. Example: ["US", "Government", "Shutdown"].
- "description_words": An array of strings. Each word of the description must be a separate element in natural English. Example: ["The", "United", "States", "government", "shutdown", "entered", "its", "second", "week", "." ].
- "score": Integer 0–100 (normalized heat × 100, rounded).
- "main_factor": EXACTLY one of: "Total Interactions", "ER", "Views", "Account Mention Ratio".
- "accounts": Array of 1–2 objects, each with:
    - "account": Account name from the input list (string).
    - "post_words": An array of strings, where each element is one word (or token) from the tweet content. 
                    Example: ["Breaking", "news", ":", "US", "Government", "Shutdown", "continues", "."]
                    Do NOT merge words together. Each word must remain a separate array element.
- "participation": String "X/Y" where X = number of accounts in the topic, Y = total accounts.

[SCORING]
Heat Score = 0.4 × Total Interactions + 0.25 × ER + 0.2 × Views + 0.15 × Account Mention Ratio.
- Total Interactions: log10(interactions + 1), normalized to [0,1], summed across accounts.
- ER: log10(ER + 0.0001), normalized to [0,1].
- Views: log10(views + 1), normalized to [0,1], summed across accounts.
- Account Mention Ratio: ratio in [0,1].
- Output the top 3 topics sorted by heat score descending. If tie: (a) higher Total Interactions, (b) higher Views, (c) alphabetical "name".

[MERGING & SPECIAL CASES]
- Merge highly similar topics to avoid duplicates.
- If some accounts have no active posts, proceed with available data.
- If an account has very few posts but extremely high engagement, reflect its influence in the description.

[OUTPUT FORMAT EXAMPLE — FOR SHAPE ONLY]
{
  "topics": [
    {
      "name_words": ["US", "Government", "Shutdown"],
      "description_words": ["The", "United", "States", "government", "shutdown", "entered", "its", "second", "week", "."],
      "score": 87,
      "main_factor": "Total Interactions",
      "accounts": [
        {
          "account": "@Alice", 
          "post_words": ["Breaking", "news", ":", "US", "Government", "Shutdown", "continues", "."]
        }
      ],
      "participation": "5/20"
    }
  ]
}
`
};

const grokCache: Record<number, { kolNames: string; text: string; timestamp: number }> = {};

export async function grokConversation() {

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

    logATA(kolNames);

    // ====== 缓存检查 ======
    const now = Date.now();
    const cacheEntry = grokCache[catID];
    if (
        cacheEntry &&
        kolNames === cacheEntry.kolNames &&
        now - cacheEntry.timestamp <= 60 * 60 * 1000
    ) {
        logATA("命中缓存:", cacheEntry);
        showResult(cacheEntry.text);
        return;
    }

    const gwo = document.getElementById("global-wait-overlay") as HTMLElement;
    const detail = document.getElementById("global-wait-detail") as HTMLElement;

    gwo.style.display = "block";
    detail.innerText = t("wait_start_grok");

    const killer = setTimeout(() => {
        gwo.style.display = "none";
        showToastMsg(t("grok_timeout"));
    }, 70_000);

    try {
        const conversationID = await createGrokConversation();
        logATA("convId:", conversationID);
        detail.innerText += ":" + conversationID;

        const promptKey = t('ai_base_prompt_ln')
        let basePrompt: string
        if (promptKey === 'chinese') {
            basePrompt = basePrompts.chinese;
        } else {
            basePrompt = basePrompts.english;
        }
        await sleep(800);
        const prompt = basePrompt.replace("%s", kolNames);
        const {text, meta} = await addGrokResponse(conversationID, prompt, {
            keepOnlyFinal: true,                         // 只要最终答案片段
            stripXaiTags: true,                          // 去掉 <xai:...> 标签
            onToken: (t) => {                     // 流式追加
                detail.textContent += t;
            },
        });

        logATA("meta:", meta);

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
    console.log("最终text结果:", text, " \n转换为结构体：", data);

    const aiTrendTemplate = document.getElementById("ai-trend-result")!;
    const aiTrendResult = aiTrendTemplate.cloneNode(true) as HTMLElement;
    aiTrendResult.style.display = 'flex';
    aiTrendResult.id = aiTrendDivID;

    const topicCard = aiTrendTemplate.querySelector(".topic-card") as HTMLElement;
    const actions = aiTrendTemplate.querySelector(".ai-trend-actions") as HTMLElement;

    const backgroundDiv = aiTrendResult.querySelector(".topic-card-background");
    backgroundDiv.innerHTML = '';

    data.topics.forEach((topic: any) => {
        const clone = topicCard.cloneNode(true) as HTMLElement;

        let topicName = topic.name;
        if (!topicName && topic.name_words) topicName = (topic.name_words || []).join(" ");
        let topicDesc = topic.description;
        if (!topicDesc && topic.description_words) topicDesc = (topic.description_words || []).join(" ");

        (clone.querySelector(".topic-name") as HTMLElement).innerText = topicName;
        (clone.querySelector(".topic-desc") as HTMLElement).innerText = topicDesc;
        (clone.querySelector(".topic-score") as HTMLElement).innerText = topic.score;
        (clone.querySelector(".topic-score-score") as HTMLElement).innerText = t('sccore');
        (clone.querySelector(".topic-main-factor") as HTMLElement).innerText = topic.main_factor;
        (clone.querySelector(".topic-participation") as HTMLElement).innerText = topic.participation;

        const accountDiv = clone.querySelector(".topic-accounts") as HTMLElement;
        const accountItem = accountDiv.querySelector(".account") as HTMLElement;
        accountDiv.innerHTML = '';

        topic.accounts.forEach((acc: any) => {
            const accountClone = accountItem.cloneNode(true) as HTMLElement;
            const accountName = accountClone.querySelector(".account-name") as HTMLAnchorElement;
            accountName.textContent = acc.account;
            const handle = acc.account.startsWith("@") ? acc.account.slice(1) : acc.account;
            accountName.href = `https://twitter.com/${handle}`;

            let postContent = acc.post;
            if (!postContent && acc.post_words) postContent = (acc.post_words || []).join(" ");

            const accountPost = accountClone.querySelector(".account-post") as HTMLAnchorElement;
            accountPost.textContent = postContent;
            accountDiv.appendChild(accountClone);
        });

        backgroundDiv.appendChild(clone);
    });

    const actionsClone = actions.cloneNode(true) as HTMLElement;
    const confirmBtn = actionsClone.querySelector(".ai-trend-confirm-btn") as HTMLButtonElement;
    confirmBtn.innerText = t('confirm')//"确定";
    confirmBtn.addEventListener('click', () => {
        aiTrendResult.remove();
    });

    backgroundDiv.appendChild(actionsClone);

    document.body.prepend(aiTrendResult);
}
