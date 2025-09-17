import {localGet, localSet} from "../common/local_storage";
import {logBGT} from "../common/debug_flags";

const STATE_KEY = "__tc_token_bucket_state__";
const DEFAULT_TOKEN_CAP = 4;
const COOL_DOWN_MS_ON_429 = 4 * 60_000;

export interface BucketState {
    tokens: number;             // 当前令牌，允许小数也行；这里用整数
    capacity: number;           // 桶上限
    cooldownUntil: number;
}

const defaults: BucketState = {
    tokens: DEFAULT_TOKEN_CAP,
    capacity: DEFAULT_TOKEN_CAP * 2,
    cooldownUntil: 0,
};

export async function resetApiBucketSetting() {
    await save(defaults);
}

async function load(): Promise<BucketState> {
    return await localGet(STATE_KEY) ?? defaults
}

async function save(s: BucketState) {
    await localSet(STATE_KEY, s);
}

export async function refillApiAccessToken(no: number = DEFAULT_TOKEN_CAP) {
    const bs = await load();
    bs.tokens = Math.min(bs.capacity, bs.tokens + no);
    await save(bs);
    printBucketState(bs, 'after refilled by timer')
}

export async function useTokenByUser() {
    const bs = await load();
    bs.tokens -= 1;
    await save(bs);
    printBucketState(bs, 'after used by user')
}

export async function useTokenByTimer(no: number = 5): Promise<boolean> {
    const bs = await load();

    if (Date.now() < bs.cooldownUntil) return false;
    if (bs.tokens < no) return false;

    bs.tokens -= no;
    await save(bs);
    printBucketState(bs, 'after used by timer')
    return true;
}

export async function penalize429() {
    const bs = await load();
    bs.cooldownUntil = Date.now() + COOL_DOWN_MS_ON_429;
    await save(bs);
    printBucketState(bs, 'after penalized')
}

export function printBucketState(state: BucketState, tag: string = ''): void {
    const now = Date.now();
    const cooling = now < state.cooldownUntil;
    const leftSec = Math.max(0, Math.ceil((state.cooldownUntil - now) / 1000));
    const pct = state.capacity ? Math.round((state.tokens / state.capacity) * 100) : 0;

    logBGT(
        `------>>> [Bucket] ${tag} tokens=${state.tokens}/${state.capacity} (${pct}%)` +
        (state.tokens < 0 ? ' (negative backlog)' : '')
    );
    logBGT(
        cooling
            ? `------>>> [Bucket] cooldown ACTIVE: ${leftSec}s left (until ${new Date(state.cooldownUntil).toLocaleTimeString()})`
            : '------>>> [Bucket] cooldown: none'
    );
}
