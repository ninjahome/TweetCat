interface KOL {
    name: string;
    bio: string;
}

interface ClassificationResult {
    kol: string;
    category: string;
}

interface DeepSeekResponse {
    choices: Array<{
        message: {
            content: string;
        };
    }>;
}

/**
 * 使用 DeepSeek API 对 KOL 列表进行分类
 * @param userCategories 用户自定义分类（示例：{ "科技达人": "专注科技创新的意见领袖", ... }）
 * @param kolList 需要分类的 KOL 列表
 * @param apiKey DeepSeek API 密钥
 */
async function classifyKols(
    userCategories: Record<string, string>,
    kolList: KOL[],
    apiKey: string
): Promise<ClassificationResult[]> {
    // 构造系统提示词
    const systemPrompt = `
你是一个专业分类助手，请严格按以下规则处理：
1. 直接返回分类名称，格式为 "KOL名称: 分类名称"
2. 如果无法确定分类，使用 "未知"
3. 不要添加任何解释
  `.trim();

    // 构建用户消息内容
    let userContent = "【分类定义】\n";
    userContent += Object.entries(userCategories)
        .map(([name, desc], index) => `${index + 1}. ${name}: ${desc}`)
        .join("\n");

    userContent += "\n\n【待分类KOL】\n";
    userContent += kolList
        .map(kol => `- KOL名称: ${kol.name}\n  自我介绍: ${kol.bio.slice(0, 200)}`) // 截断长文本
        .join("\n");

    try {
        const response = await fetch("https://api.deepseek.com/chat/completions", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model: "deepseek-reasoner",
                messages: [
                    {role: "system", content: systemPrompt},
                    {role: "user", content: userContent}
                ],
                temperature: 0.3
            })
        });

        if (!response.ok) {
            throw new Error(`API request failed with status ${response.status}`);
        }

        const data: DeepSeekResponse = await response.json();
        return parseClassificationResponse(data.choices[0].message.content);
    } catch (error) {
        console.error("Classification failed:", error);
        throw new Error("Failed to classify KOLs");
    }
}

// 解析 API 返回的文本结果
function parseClassificationResponse(responseText: string): ClassificationResult[] {
    return responseText
        .split("\n")
        .filter(line => line.trim() && line.includes(":"))
        .map(line => {
            const [kolPart, categoryPart] = line.split(":").map(s => s.trim());
            if (!kolPart || !categoryPart) {
                throw new Error(`Invalid response format: ${line}`);
            }
            return {kol: kolPart, category: categoryPart};
        });
}

// 使用示例
const exampleCategories = {
    "科技先锋": "专注科技创新和数字化转型",
    "生活美学": "分享生活方式和美学理念",
    "投资达人": "分析金融市场和投资策略",
    "健康专家": "传播健康知识和健身方法"
};

const exampleKols = [
    {name: "HumbleFlow", bio: "Anti-Bolshevik | I spend my time thinking, learning, and building.\n" +
            "\n" +
            "Subscribe to my newsletter"},
    {name: "DW 中文- 德国之声", bio: "德国之声中文官方推特：德国国际广播电台中文资讯服务，来自德国，介绍德国，聚焦华语区时政、经济、社会新闻，为您提供多媒体信息服务、背景报道、观点评论。欢迎积极参与互动!"},
    {name: "Rainmaker1973", bio: "Engineer. Selecting and curating pictures and videos trying to add context, source and explanation to science, tech, art and weather topics"},
    {name: "newscientist", bio: "The best place to find out what’s new in science – and why it matters."},
    {name: "Bitcoin_Mei", bio: "HODL BTC ETH | 合作tg"},
    {name: "AwbczBTC", bio: "(申子辰)（会些玄学） 专注价值内容创作，Binance广场创作者，BTCETH日内分析。山寨中长线分析。\n" +
            "(Web3) 纸飞机Tg "}
];


async function batchClassifySimple(
    userCategories: Record<string, string>, // 用户自定义分类
    kolList: KOL[],                         // 全部待分类的KOL列表
    apiKey: string,                         // API密钥
    batchSize = 10                          // 每批处理数量，默认10
): Promise<ClassificationResult[]> {
    const results: ClassificationResult[] = [];

    // 按 batchSize 分批循环处理
    for (let i = 0; i < kolList.length; i += batchSize) {
        const batch = kolList.slice(i, i + batchSize);

        try {
            // 调用分类函数处理当前批次
            const batchResults = await classifyKols(userCategories, batch, apiKey);
            results.push(...batchResults);
        } catch (error) {
            // 可选：简单错误处理（如记录日志）
            console.error(`处理第 ${i / batchSize + 1} 批失败:`, error);
            throw error; // 直接抛出错误终止流程
        }
    }

    return results;
}


export async function testApi() {

    try {
        const results = await batchClassifySimple(
            exampleCategories,
            exampleKols,
            "",
            10 // 每批10个
        );
        console.log("全部分类结果:", results);
    } catch (error) {
        console.error("分类失败:", error);
    }
}