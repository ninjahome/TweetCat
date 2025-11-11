export const __targetUrlToFilter = 'https://x.com/home';

export const defaultCategoryName = "Main"
export const maxElmFindTryTimes = 5;
export const defaultCatID = 1;
export const defaultAllCategoryID = -1;
export const noXTabError = "no_x_tab"
export const itemColorGroup = ['#f6cd01', '#866afb', '#fe466c', '#06cbad', '#4592ef']

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
    OpenCategoryManagement = 'OpenCategoryManagement',
    NaviUrlChanged = 'NaviUrlChanged',
    StartTweetsFetch = 'StartTweetsFetch',
    StartKolIdCheck = 'StartKolIdCheck',

    CategoryQueryAll = 'CategoryQueryAll',
    CategoryChanged = 'CategoryChanged',
    CategoryQueryById = 'CategoryQueryById',

    FollowingQueryAll = 'FollowingQueryAll',
    FollowingSync = 'FollowingSync',
    FollowingAssignCategory = 'FollowingAssignCategory',
    FollowingBulkUnfollow = 'FollowingBulkUnfollow',
    FollowingFetchOne = 'FollowingFetchOne',

    KolQueryAll = 'KolQueryAll',
    KolQueryByID = 'KolQueryByID',
    KolQueryByCategoryId = 'KolQueryByCategoryId',
    KolQueryByName = 'KolQueryByName',
    KolUpdate = 'KolUpdate',
    KolRemove = 'KolRemove',

    AdsBlockChanged = 'AdsBlockChanged',
    AdsBlockSuccess = 'AdsBlockSuccess',

    TweetCacheToDB = 'TweetCacheToDB',
    TweetReadByKolId = 'TweetReadByKolId',
    TweetsBootStrap = 'TweetsBootStrap',
    TweetReadByCategoryId = 'TweetReadByCategoryId',
    TweetRemoveByKolID = 'TweetRemoveByKolID',
    TweetBookmarkToggle = 'TweetBookmarkToggle',

    KolCursorLoadAll = 'KolCursorLoadAll',
    KolCursorSaveAll = 'KolCursorSaveAll',
    KolCursorSaveOne = 'KolCursorSaveOne',
    KolCursorQueryOne = 'KolCursorQueryOne',
    KolCursorForFirstOpen = 'KolCursorForFirstOpen',

    TimerKolInQueueAtOnce = 'TimerKolInQueueAtOnce',

    IJUserTweetsCaptured = 'UserTweetsCaptured',
    IJHomeLatestCaptured = 'IJHomeLatestCaptured',
    IJLocationChange = 'IJLocationChange',
    IJTweetDetailCaptured = 'IJTweetDetailCaptured',
    IJUserByScreenNameCaptured = "IJUserByScreenNameCaptured",

    TokenUsedByUser = 'TokenUsedByUser',
    TokenFreeze = 'TokenFreeze',

    RouterTCMount = 'RouterTCMount',
    RouterTcUnmount = 'RouterTcUnmount',
    RouterTCBeforeNav = 'RouterTCBeforeNav',

    YTVideoMetaGot = "YTVideoMetaGot",
    IJYTVideoParamGot = 'IJYTVideoParamGot',
    CheckIfLocalAppInstalled = 'CheckIfLocalAppInstalled',
    StartLocalApp = 'StartLocalApp',

    WalletInfoQuery = "WalletInfoQuery",
    OpenOrFocusUrl = "OpenOrFocusUrl",
    SW_ACTION_GET_SNAPSHOT="SW_ACTION_GET_SNAPSHOT"
}

export const __DBK_Bearer_Token = "__DBK_Bearer_Token__";
export const DEFAULT_BEARER = "Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA";
export const __DBK_query_id_map = "__DBK_query_id_map__";
export const UserTweets = "UserTweets"// 获取指定用户的推文
export const UserByScreenName = "UserByScreenName" // 根据 username 获取 userId
export const HomeLatestTimeline = "HomeLatestTimeline"// 首页的最新推文流
export const HomeTimeline = "HomeTimeline"// 首页的最新推文流
export const TweetDetail = "TweetDetail"         // 单条推文详情（用于评论）
export const UsersByRestIds = "UsersByRestIds"     // 根据一批 userId 查询用户信息
export const SearchTimeline = "SearchTimeline" // 搜索结果（你可能以后用）
export const CreateBookmark = "CreateBookmark"
export const DeleteBookmark = "DeleteBookmark"
export const Following = "Following"
export const Followers = "Followers"
export const BlueVerifiedFollowers = "BlueVerifiedFollowers"
export const Bookmarks = "Bookmarks"
export const CreateGrokConversation = "CreateGrokConversation"
export const ConversationItem_DeleteConversationMutation = "ConversationItem_DeleteConversationMutation"

export const watchedOps = [
    UserByScreenName,
    UserTweets,
    HomeLatestTimeline,
    TweetDetail,
    UsersByRestIds,
    SearchTimeline,
    CreateBookmark,
    DeleteBookmark,
    Following,
    Followers,
    BlueVerifiedFollowers,
    HomeTimeline,
    Bookmarks,
    CreateGrokConversation,
    ConversationItem_DeleteConversationMutation,
];

export const defaultQueryKeyMap: Record<string, string> = {
    UserByScreenName: "ck5KkZ8t5cOmoLssopN99Q",
    UserTweets: "E8Wq-_jFSaU7hxVcuOPR9g",
    HomeLatestTimeline: "SFxmNKWfN9ySJcXG_tjX8g",
    HomeTimeline: "DXmgQYmIft1oLP6vMkJixw",
    TweetDetail: "iFEr5AcP121Og4wx9Yqo3w",
    UsersByRestIds: "1hjT2eXW1Zcw-2xk8EbvoA",
    SearchTimeline: "4fpceYZ6-YQCx_JSl_Cn_A",
    CreateBookmark: "aoDbu3RHznuiSkQ9aNM67Q",
    DeleteBookmark: "Wlmlj2-xzyS1GN3a6cj-mQ",
    Following: "SaWqzw0TFAWMx1nXWjXoaQ",
    Followers: "i6PPdIMm1MO7CpAqjau7sw",
    BlueVerifiedFollowers: "fxEl9kp1Tgolqkq8_Lo3sg",
    Bookmarks: "pLtjrO4ubNh996M_Cubwsg",
    CreateGrokConversation: "vvC5uy7pWWHXS2aDi1FZeA",
    ConversationItem_DeleteConversationMutation: "TlKHSWVMVeaa-i7dqQqFQA",
}
