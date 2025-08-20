import browser from "webextension-polyfill";

const STATE_KEY = "__tc_token_bucket_state__";
const DEFAULT_TOKEN_CAP = 12;

export interface BucketState {
    tokens: number;             // 当前令牌，允许小数也行；这里用整数
    capacity: number;           // 桶上限
}

const defaults: BucketState = {
    tokens: DEFAULT_TOKEN_CAP,
    capacity: DEFAULT_TOKEN_CAP,
};

async function load(): Promise<BucketState> {
    const raw = await browser.storage.local.get(STATE_KEY);
    return {...defaults, ...(raw[STATE_KEY] || {})};
}

async function save(s: BucketState) {
    await browser.storage.local.set({[STATE_KEY]: s});
}

export async function useTokenByUser() {

}

export async function useTokenByTimer(no: number = 5) {

}