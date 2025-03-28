const currentUrl = window.location.href;
// 构建 URL 对象
const url = new URL(currentUrl);
// 从 searchParams 中解析参数
const foo = url.searchParams.get("catID");      // bar
console.log("------>>>", foo);