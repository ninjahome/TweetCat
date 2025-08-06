export const __targetUrlToFilter = 'https://x.com/home';

export const defaultCategoryName = "Main"
export const maxElmFindTryTimes = 5;
export const defaultCatID = 1;
export const defaultAllCategoryID = -1;
export const maxMissedTweetOnce = 180;
export const itemColorGroup = ['#f6cd01', '#866afb', '#fe466c', '#06cbad', '#4592ef']
export const MaxCategorySize = 12;

function addOpacityToHex(hex: string, opacity: number): string {
    const clampedOpacity = Math.min(1, Math.max(0, opacity));
    const alpha = Math.round(clampedOpacity * 255).toString(16).padStart(2, '0');
    return `${hex}${alpha}`;
}

export function choseColorByID(id: number, opacity: number = 1): string {
    const baseColor = itemColorGroup[id % itemColorGroup.length];
    return addOpacityToHex(baseColor, opacity);
}

export const __DBK_AD_Block_Key = "__DBK_AD_Block_Key";

export enum MsgType {
    OpenPlugin = 'OpenPlugin',
    NaviUrlChanged = 'NaviUrlChanged',

    CategoryQueryAll = 'CategoryQueryAll',
    CategoryChanged = 'CategoryChanged',
    CategoryQueryById = 'CategoryQueryById',

    KolQueryAll = 'KolQueryAll',
    KolQueryByCategoryId = 'KolQueryByCategoryId',
    KolQueryByName = 'KolQueryByName',
    KolUpdate = 'KolUpdate',
    KolRemove = 'KolRemove',

    AdsBlockChanged = 'AdsBlockChanged',

    TweetCacheToDB = 'TweetCacheToDB',
    TweetReadByKolId = 'TweetReadByKolId',
    TweetsBootStrap = 'TweetsBootStrap',
    TweetReadByCategoryId = 'TweetReadByCategoryId',
    KolCursorLoadAll = 'KolCursorLoadAll',
    KolCursorWriteBack = 'KolCursorWriteBack',
}

export const __DBK_Bearer_Token = "__DBK_Bearer_Token__";
export const DEFAULT_BEARER = "Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA";
export const __DBK_query_id_map = "__DBK_query_id_map__";
export const UserTweets = "UserTweets"// 获取指定用户的推文
export const UserByScreenName = "UserByScreenName" // 根据 username 获取 userId
export const HomeLatestTimeline = "HomeLatestTimeline"// 首页的最新推文流
export const TweetDetail = "TweetDetail"         // 单条推文详情（用于评论）
export const UsersByRestIds = "UsersByRestIds"     // 根据一批 userId 查询用户信息
export const SearchTimeline = "SearchTimeline" // 搜索结果（你可能以后用）
export const watchedOps = [
    UserByScreenName,
    UserTweets,
    HomeLatestTimeline,
    TweetDetail,
    UsersByRestIds,
    SearchTimeline,
];

export const defaultQueryKeyMap: Record<string, string> = {
    UserByScreenName: "x3RLKWW1Tl7JgU7YtGxuzw",
    UserTweets: "MdhoJlJzYWas9JNmFz7H3A",
    HomeLatestTimeline: "nMyTQqsJiUGBKLGNSQamAA",
    TweetDetail: "b9Yw90FMr_zUb8DvA8r2ug",
    UsersByRestIds: "kCBEQ-OvWNVtotaYmqG0aw",
    SearchTimeline: "fL2MBiqXPk5pSrOS5ACLdA",
}
