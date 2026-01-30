import browser from "webextension-polyfill";
import {getBearerToken} from "../common/utils";

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
            all.push(...(await browser.cookies.getAll({url})));
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

export async function handleProfileFollowClaim(payload: FollowClaimPayload) {
    const cookies = await getXSessionCookies();
    const bearer = await getBearerToken();
    const ct0 = cookies.find((c: any) => c.name === "ct0")?.value;

    console.log("[Follow&Claim] local app input snapshot", {
        payload,
        headers: {
            authorization: maskSecret(bearer, 10, 6),
            "x-csrf-token": maskSecret(ct0),
        },
        cookies: cookies.map((c: any) => ({
            name: c.name,
            value: maskSecret(c.value),
            domain: c.domain,
            path: c.path,
            secure: c.secure,
            httpOnly: c.httpOnly,
            sameSite: c.sameSite,
            expirationDate: c.expirationDate,
        })),
        notes: "Cookie values are masked in logs; send full values to native app when wiring native messaging.",
    });

    return {success: true};
}

