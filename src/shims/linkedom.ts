// 仅提供库里会用到的 parseHTML，返回结构跟 linkedom 类似
export function parseHTML(html: string) {
    const parser = new DOMParser();
    const document = parser.parseFromString(html, "text/html");
    return { window: { document } };
}
