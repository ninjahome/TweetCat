import browser from "webextension-polyfill";
import { getBearerToken } from "../common/utils";

type FollowClaimPayload = {
    kolName?: string;
    url?: string;
    ua?: string;
    lang?: string;
};

function maskSecret(value: string | undefined, visiblePrefix = 3, visibleSuffix = 3): string | undefined {
    if (!value) return value;
    if (value.length <= visiblePrefix + visibleSuffix + 3) return "***";
    return `${value.slice(0, visiblePrefix)}***${value.slice(-visibleSuffix)}`;
}

async function getXSessionCookies(): Promise<any[]> {
    const cookieNames = new Set(["auth_token", "ct0"]);
    const urls = ["https://x.com/", "https://twitter.com/"];

    const all: any[] = [];
    for (const url of urls) {
        try {
            all.push(...(await browser.cookies.getAll({ url })));
        } catch (e) {
            console.warn("[Follow&Claim] failed to read cookies for url:", url, e);
        }
    }

    const filtered = all.filter((c) => cookieNames.has(c.name));
    const dedup = new Map<string, any>();
    for (const c of filtered) {
        dedup.set(`${c.domain}|${c.path}|${c.name}`, c);
    }
    return Array.from(dedup.values());
}

import { sendFollowClaim } from "./local_app";

// ... (keep existing imports if any, but replacing the whole block logic)

export async function handleProfileFollowClaim(payload: FollowClaimPayload) {
    const cookies = await getXSessionCookies();
    const bearer = await getBearerToken();
    const ct0 = cookies.find((c: any) => c.name === "ct0")?.value;

    const headers = {
        authorization: bearer,
        "x-csrf-token": ct0,
    };

    console.log("[Follow&Claim] local app input snapshot", {
        payload,
        headers: {
            authorization: maskSecret(bearer, 10, 6),
            "x-csrf-token": maskSecret(ct0),
        },
        cookiesCookies: cookies.map((c: any) => ({
            name: c.name,
            value: maskSecret(c.value),
        })),
        notes: "Sending real data to Native App...",
    });

    const traceId = `trace-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    const resp = await sendFollowClaim(traceId, payload, headers, cookies);

    console.log("[Follow&Claim] Native response:", resp);

    return { success: resp.ok, data: resp.data };
}

