import { ClientTransaction } from "x-client-transaction-id";

let cachedDoc: Document | null = null;
let lastFetched = 0;

async function getXDoc() {
    const now = Date.now();
    if (!cachedDoc || now - lastFetched > 60_000) { // 缓存 60s
        const res = await fetch("https://x.com/", { credentials: "omit" });
        const html = await res.text();
        cachedDoc = new DOMParser().parseFromString(html, "text/html");
        lastFetched = now;
    }
    return cachedDoc;
}


export async function getTransactionIdFor(method: "GET"|"POST", path: string) {
    const doc = await getXDoc();
    const tx = await ClientTransaction.create(doc);
    return tx.generateTransactionId(method, path);
}
