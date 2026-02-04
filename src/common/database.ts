import {defaultCategoryName, defaultCatID} from "./consts";
import {logDB} from "./debug_flags";

let __databaseObj: IDBDatabase | null = null;

const __databaseName = 'tweet-cat-database';
export const __currentDatabaseVersion = 24;

export const __tableCategory = '__table_category__';
export const __tableKolsInCategory = '__table_kol_in_category__';
export const __tableSystemSetting = '__table_system_setting__';
export const __tableCachedTweets = '__table_cached_tweets__'
export const __tableKolCursor = '__table_kol_cursor__';
export const __tableFollowings = '__table_followings__';
export const __tableWallets = '__table_wallets__';
export const __tableWalletSettings = '__table_wallet_settings__';
export const __tableIpfsSettings = '__table_ipfs_settings__';
export const __tableAdsFeedMeta = '__table_ads_feed_meta__';
export const __tableAdsFollowOffers = '__table_ads_follow_offers__';
export const __tableAdsFollowClaimState = '__table_ads_follow_claim_state__';

export const idx_tweets_user_time = 'userId_timestamp_idx'
export const idx_tweets_time_user = 'timestamp_userId_idx';
export const idx_tweets_userid = 'userId_idx'
export const idx_tweets_time = 'timestamp_idx'
export const idx_kol_usr_id = 'idx_kolUserId'


const initialCategories = [
    {catName: defaultCategoryName},
];

export const initialKols = [
    {
        kolName: 'tweetCatOrg',
        catID: defaultCatID,
        displayName: 'TweetCat',
        kolUserId: '1899045104146644992',
        avatarUrl: 'https://pbs.twimg.com/profile_images/1904033834632376320/p20N1O1s_200x200.jpg'
    },
    {
        kolName: 'elonmusk',
        catID: defaultCatID,
        displayName: 'Elon Musk',
        kolUserId: '44196397',
        avatarUrl: 'https://pbs.twimg.com/profile_images/1936002956333080576/kqqe2iWO_200x200.jpg'
    },
    {
        kolName: 'realDonaldTrump',
        catID: defaultCatID,
        displayName: 'Donald J. Trump',
        kolUserId: '25073877',
        avatarUrl: 'https://pbs.twimg.com/profile_images/874276197357596672/kUuht00m_200x200.jpg'
    },
    {
        kolName: 'BillGates',
        catID: defaultCatID,
        displayName: 'Bill Gates',
        kolUserId: '50393960',
        avatarUrl: 'https://pbs.twimg.com/profile_images/1879013694367252480/Gxa-Pspq_200x200.jpg'
    }
];

function initDatabase(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(__databaseName, __currentDatabaseVersion);

        request.onerror = function (event: Event) {
            console.error("------>>>[Database]Database open failed:", (event.target as IDBOpenDBRequest).error);
            reject((event.target as IDBOpenDBRequest).error);
        };

        request.onsuccess = function (event: Event) {
            __databaseObj = (event.target as IDBOpenDBRequest).result;
            logDB("------>>>[Database]Database open success, version=", __databaseObj.version);
            resolve(__databaseObj);
        };

        request.onupgradeneeded = function (event: IDBVersionChangeEvent) {
            __databaseObj = (event.target as IDBOpenDBRequest).result;
            logDB("------>>>[Database]Database need to update:", __databaseObj.version);
            const request = (event.target as IDBOpenDBRequest);
            initCategory(request).then();
            initKolsInCategory(request).then();
            initSystemSetting(request);
            initCachedTweetsTable(request);
            initKolCursorTable(request);
            initFollowingsTable(request).then();
            initWalletTable(request);
            initWalletSettingsTable(request);
            initIpfsSettingsTable(request);
            initAdsFeedMetaTable(request);
            initAdsFollowOffersTable(request);
            initAdsFollowClaimStateTable(request);
        };
    });
}

function requestToPromise<T>(req: IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

async function initCategory(request: IDBOpenDBRequest) {
    const db = request.result;

    if (!db.objectStoreNames.contains(__tableCategory)) {
        // 表不存在，直接创建并初始化
        const store = db.createObjectStore(__tableCategory, {keyPath: 'id', autoIncrement: true});
        for (const category of initialCategories) {
            store.add(category);
        }
        logDB("------>>>[Database]Created category store and inserted initial categories.", initialCategories);
        return;
    }

    // ✅ 使用升级事务中的 transaction
    const txn = request.transaction;
    if (!txn) {
        console.warn("------>>>[Database] Transaction is null");
        return;
    }

    // 🟡 先 count 看是否为空
    const store = txn.objectStore(__tableCategory);
    const count = await requestToPromise(store.count());

    if (count > 0) {
        logDB("------>>>[Database]Category store already has data, skip initialization.");
        return;
    }

    queueMicrotask(() => {
        try {
            db.deleteObjectStore(__tableCategory);
            const newStore = db.createObjectStore(__tableCategory, {keyPath: 'id', autoIncrement: true});
            for (const category of initialCategories) {
                newStore.add(category);
            }
            logDB("------>>>[Database]Recreated category store and re-initialized data.", initialCategories);
        } catch (err) {
            console.error("------>>>[Database]Error recreating store:", err);
        }
    });
}

async function initKolsInCategory(request: IDBOpenDBRequest) {
    const db = request.result;

    // versionchange 事务（只会在 onupgradeneeded 里有值）
    const transaction = request.transaction;
    if (!transaction) {
        console.warn("------>>>[Database]Inserted database transaction failed");
        return;
    }

    // 1) 创建或获取对象仓库
    let store: IDBObjectStore;
    if (!db.objectStoreNames.contains(__tableKolsInCategory)) {
        store = db.createObjectStore(__tableKolsInCategory, {keyPath: 'kolName'});
    } else {
        store = transaction.objectStore(__tableKolsInCategory);
    }

    // 2) 确保索引存在（缺失字段将不会进入该索引 => 稀疏索引）
    const ensureIndex = (name: string, keyPath: string | string[], options?: IDBIndexParameters) => {
        // DOMStringList.contains 在多数浏览器可用；做个兜底
        const has = (store.indexNames as any).contains
            ? (store.indexNames as any).contains(name)
            : Array.from(store.indexNames as unknown as string[]).includes(name);

        if (!has) {
            store.createIndex(name, keyPath as any, options);
            // 可选日志
            // logDB("------>>>[Database]Created index", name, "on", __tableKolsInCategory, "keyPath:", keyPath);
        }
    };

    // 单字段索引：按 kolUserId 查找
    ensureIndex('idx_kolUserId', 'kolUserId', {unique: false});

    // （可选）复合索引：按 catID + kolUserId 联合查询
    // ensureIndex('idx_cat_kol', ['catID', 'kolUserId'], { unique: false });

    // 3) 若表为空，写入初始数据
    const count = await requestToPromise(store.count());
    if (count > 0) return;

    initialKols.forEach(kol => {
        // 注意：当 kol.kolUserId 缺失/undefined 时不会进入 idx_kolUserId（稀疏）
        store.add(kol);
    });

    logDB("------>>>[Database]Create kols in category successfully.", __tableKolsInCategory, "Inserted initial categories.", initialKols);
}

async function initFollowingsTable(request: IDBOpenDBRequest) {
    const db = request.result;

    if (!db.objectStoreNames.contains(__tableFollowings)) {
        const store = db.createObjectStore(__tableFollowings, {keyPath: 'userId'});
        store.createIndex('idx_category', 'categoryId', {unique: false});
        logDB("------>>>[Database] Created followings table successfully.");
        return;
    }

    const txn = request.transaction;
    if (!txn) {
        console.warn("------>>>[Database] followings init transaction missing");
        return;
    }

    const store = txn.objectStore(__tableFollowings);
    if (!store.indexNames.contains('idx_category')) {
        store.createIndex('idx_category', 'categoryId', {unique: false});
        logDB("------>>>[Database] Added idx_category index on followings table.");
    }
}

function initWalletTable(request: IDBOpenDBRequest) {
    const db = request.result;

    if (db.objectStoreNames.contains(__tableWallets)) {
        return;
    }

    db.createObjectStore(__tableWallets, {keyPath: 'address'});
    logDB("------>>>[Database]Created wallet table successfully.");
}

function initWalletSettingsTable(request: IDBOpenDBRequest) {
    const db = request.result;

    if (db.objectStoreNames.contains(__tableWalletSettings)) {
        return;
    }

    db.createObjectStore(__tableWalletSettings, {keyPath: 'id'});
    logDB("------>>>[Database]Created wallet settings table successfully.");
}

function initIpfsSettingsTable(request: IDBOpenDBRequest) {
    const db = request.result;
    if (db.objectStoreNames.contains(__tableIpfsSettings)) return;
    db.createObjectStore(__tableIpfsSettings, { keyPath: 'id' });
    logDB("------>>>[Database]Created ipfs settings table successfully.");
}

function initAdsFeedMetaTable(request: IDBOpenDBRequest) {
    const db = request.result;
    if (db.objectStoreNames.contains(__tableAdsFeedMeta)) return;
    db.createObjectStore(__tableAdsFeedMeta, { keyPath: 'id' });
    logDB("------>>>[Database]Created ads feed meta table successfully.");
}

function initAdsFollowOffersTable(request: IDBOpenDBRequest) {
    const db = request.result;
    if (db.objectStoreNames.contains(__tableAdsFollowOffers)) return;
    db.createObjectStore(__tableAdsFollowOffers, { keyPath: 'profileUrl' });
    logDB("------>>>[Database]Created ads follow offers table successfully.");
}

function initAdsFollowClaimStateTable(request: IDBOpenDBRequest) {
    const db = request.result;
    if (db.objectStoreNames.contains(__tableAdsFollowClaimState)) return;
    db.createObjectStore(__tableAdsFollowClaimState, { keyPath: 'ad_id' });
    logDB("------>>>[Database]Created ads follow claim state table successfully.");
}


function initSystemSetting(request: IDBOpenDBRequest) {
    const db = request.result;
    if (!db.objectStoreNames.contains(__tableSystemSetting)) {
        const objectStore = db.createObjectStore(__tableSystemSetting, {keyPath: 'id', autoIncrement: true});
        logDB("------>>>[Database]Create system setting table successfully.", objectStore);
    }
}

function initCachedTweetsTable(request: IDBOpenDBRequest) {
    const db = request.result;

    if (db.objectStoreNames.contains(__tableCachedTweets)) {
        logDB("------>>>[Database] Tweets table already exists.");
        const tx = request.transaction!;
        const store = tx.objectStore(__tableCachedTweets);

        // 只有不存在时才创建，避免报错
        if (!store.indexNames.contains(idx_tweets_userid)) {
            store.createIndex(idx_tweets_userid, 'userId', {unique: false});
            logDB("------>>>[Database] Added index userId_idx on existing cached tweets store.");
        }
        if (!store.indexNames.contains(idx_tweets_time_user)) {
            store.createIndex(idx_tweets_time_user, ['timestamp', 'userId'], {unique: false});
        }
        logDB("------>>>[Database] ensured indexes on cached tweets.");
        return;
    }

    const tweetStore = db.createObjectStore(__tableCachedTweets, {keyPath: 'tweetId'});
    tweetStore.createIndex(idx_tweets_time, 'timestamp', {unique: false});
    tweetStore.createIndex(idx_tweets_user_time, ['userId', 'timestamp'], {unique: false});
    tweetStore.createIndex(idx_tweets_userid, 'userId', {unique: false});
    tweetStore.createIndex(idx_tweets_time_user, ['timestamp', 'userId'], {unique: false});

    logDB("------>>>[Database] Created cached tweets table with indexes successfully.", __tableCachedTweets);
}

function initKolCursorTable(request: IDBOpenDBRequest) {
    const db = request.result;

    if (db.objectStoreNames.contains(__tableKolCursor)) {
        return;
    }

    const store = db.createObjectStore(__tableKolCursor, {keyPath: 'userId'});

    store.createIndex('newest_fetch_idx', 'nextNewestFetchTime', {unique: false});

    logDB("------>>>[Database]Created KolCursor table successfully.", __tableKolCursor);
}


export function closeDatabase() {
    if (__databaseObj) {
        __databaseObj.close();
        logDB("------>>>Database connection closed.");
        __databaseObj = null;
    }
}

export function databaseAddItem(storeName: string, data: any): Promise<IDBValidKey> {
    return new Promise((resolve, reject) => {
        if (!__databaseObj) {
            reject('Database is not initialized');
            return;
        }

        try {
            const transaction = __databaseObj.transaction([storeName], 'readwrite');
            const objectStore = transaction.objectStore(storeName);
            const request = objectStore.add(data);

            request.onsuccess = () => {
                resolve(request.result);
            };

            request.onerror = event => {
                reject(`Error adding data to ${storeName}: ${(event.target as IDBRequest).error}`);
            };
        } catch (error) {
            reject(`Unexpected error: ${error}`);
        }
    });
}


export function databaseGetByIndex<T = any>(
    storeName: string,
    idx: string,
    idxVal: IDBValidKey | IDBKeyRange
): Promise<T | null> {
    return new Promise((resolve, reject) => {
        try {
            if (!__databaseObj) {
                reject('Database is not initialized');
                return;
            }
            const tx = __databaseObj.transaction([storeName], 'readonly');
            const store = tx.objectStore(storeName);

            let index: IDBIndex;
            try {
                index = store.index(idx); // 若索引不存在会抛 NotFoundError
            } catch (e) {
                reject(`Index not found: ${idx}`);
                return;
            }

            const req = index.get(idxVal);
            req.onsuccess = () => resolve(req.result ?? null);
            req.onerror = () =>
                reject('Error in query by key: ' + (req.error ? req.error.message : 'unknown'));

        } catch (error) {
            reject('Transaction failed: ' + (error as Error).message);
        }
    });
}


export function databaseGet(storeName: string, keyPath: any): Promise<any> {
    return new Promise((resolve, reject) => {
        if (!__databaseObj) {
            reject('Database is not initialized');
            return;
        }
        const transaction = __databaseObj.transaction([storeName], 'readonly');
        const objectStore = transaction.objectStore(storeName);

        const request = objectStore.get(keyPath);

        request.onsuccess = event => {
            const result = (event.target as IDBRequest).result;
            if (result) {
                resolve(result);
            } else {
                resolve(null);
            }
        };

        request.onerror = event => {
            reject(`Error getting data from ${storeName}: ${(event.target as IDBRequest).error}`);
        };
    });
}

export function databaseUpdate(storeName: string, keyName: string, keyVal: any, newData: any): Promise<string> {
    return new Promise((resolve, reject) => {
        if (!__databaseObj) return reject('Database is not initialized');

        const transaction = __databaseObj.transaction([storeName], 'readwrite');
        const objectStore = transaction.objectStore(storeName);
        const request = objectStore.put({...newData, [keyName]: keyVal});

        request.onsuccess = () => {
            resolve(`Data updated in ${storeName} successfully`);
        };

        request.onerror = event => {
            reject(`Error updating data in ${storeName}: ${(event.target as IDBRequest).error}`);
        };
    });
}

export function databaseUpdateOrAddItem(storeName: string, data: any): Promise<IDBValidKey> {
    return new Promise((resolve, reject) => {
        if (!__databaseObj) return reject('Database is not initialized');

        const transaction = __databaseObj.transaction([storeName], 'readwrite');
        const objectStore = transaction.objectStore(storeName);
        const request = objectStore.put(data);

        request.onsuccess = () => resolve(request.result);
        request.onerror = event => {
            reject(`Error putting data to ${storeName}: ${(event.target as IDBRequest).error}`);
        };
    });
}

export function databaseClear(storeName: string): Promise<void> {
    return new Promise((resolve, reject) => {
        if (!__databaseObj) return reject('Database is not initialized');
        const transaction = __databaseObj.transaction([storeName], 'readwrite');
        const objectStore = transaction.objectStore(storeName);
        const request = objectStore.clear();
        request.onsuccess = () => resolve();
        request.onerror = event => reject(`Error clearing ${storeName}: ${(event.target as IDBRequest).error}`);
    });
}

export function databaseUpdateFields(storeName: string, key: IDBValidKey, changes: Record<string, any>) {

    return new Promise((resolve, reject) => {
        if (!__databaseObj) return reject('Database is not initialized');
        const transaction = __databaseObj.transaction([storeName], 'readwrite');
        const store = transaction.objectStore(storeName);
        const getReq = store.get(key);

        getReq.onsuccess = () => {
            const record = getReq.result;
            if (!record) return reject('Record not found');

            Object.assign(record, changes); // 一次性更新多个字段

            const putReq = store.put(record);
            putReq.onsuccess = () => resolve('Fields updated successfully');
            putReq.onerror = e => reject(`Error updating: ${(e.target as IDBRequest).error}`);
        };

        getReq.onerror = e => reject(`Error getting record: ${(e.target as IDBRequest).error}`);
    });
}


export function databaseDelete(storeName: string, keyPath: any): Promise<string> {
    return new Promise((resolve, reject) => {
        if (!__databaseObj) {
            reject('Database is not initialized');
            return;
        }
        const transaction = __databaseObj.transaction([storeName], 'readwrite');
        const objectStore = transaction.objectStore(storeName);
        const request = objectStore.delete(keyPath);

        request.onsuccess = () => {
            resolve(`Data deleted from ${storeName} successfully`);
        };

        request.onerror = event => {
            reject(`Error deleting data from ${storeName}: ${(event.target as IDBRequest).error}`);
        };
    });
}

export function databaseDeleteByFilter(storeName: string, conditionFn: (value: any) => boolean): Promise<string> {
    return new Promise((resolve, reject) => {
        if (!__databaseObj) {
            reject('Database is not initialized');
            return;
        }
        const transaction = __databaseObj.transaction([storeName], 'readwrite');
        const objectStore = transaction.objectStore(storeName);
        const request = objectStore.openCursor();

        request.onsuccess = event => {
            const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;
            if (cursor) {
                if (conditionFn(cursor.value)) {
                    cursor.delete();
                }
                cursor.continue();
            } else {
                resolve(`Data deleted from ${storeName} successfully`);
            }
        };

        request.onerror = event => {
            reject(`Error deleting data with condition from ${storeName}: ${(event.target as IDBRequest).error}`);
        };
    });
}

export function databaseQueryAll(storeName: string): Promise<any[]> {
    return new Promise((resolve, reject) => {
        if (!__databaseObj) {
            reject('Database is not initialized');
            return;
        }
        const transaction = __databaseObj.transaction([storeName], 'readonly');
        const objectStore = transaction.objectStore(storeName);
        const request = objectStore.getAll();

        request.onsuccess = event => {
            const data = (event.target as IDBRequest).result;
            resolve(data);
        };

        request.onerror = event => {
            reject(`Error getting all data from ${storeName}: ${(event.target as IDBRequest).error}`);
        };
    });
}

export function databaseQueryByFilter(storeName: string, conditionFn: (value: any) => boolean): Promise<any[]> {
    return new Promise((resolve, reject) => {
        if (!__databaseObj) {
            reject('Database is not initialized');
            return;
        }
        const transaction = __databaseObj.transaction([storeName], 'readonly');
        const objectStore = transaction.objectStore(storeName);
        const request = objectStore.openCursor();
        const results: any[] = [];

        request.onsuccess = event => {
            const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;
            if (cursor) {
                const data = cursor.value;
                if (conditionFn(data)) {
                    results.push(data);
                }
                cursor.continue();
            } else {
                resolve(results);
            }
        };

        request.onerror = event => {
            reject(`Error querying data from ${storeName}: ${(event.target as IDBRequest).error}`);
        };
    });
}

export function getMaxIdRecord(storeName: string): Promise<any> {
    return new Promise((resolve, reject) => {
        if (!__databaseObj) {
            reject('Database is not initialized');
            return;
        }
        const transaction = __databaseObj.transaction([storeName], 'readonly');
        const objectStore = transaction.objectStore(storeName);
        const cursorRequest = objectStore.openCursor(null, 'prev');
        cursorRequest.onsuccess = function (event) {
            const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;
            if (cursor) {
                resolve(cursor.value);
            } else {
                resolve(null);
            }
        };

        cursorRequest.onerror = function (event) {
            const error = (event.target as IDBRequest).error; // 显式地转换为 IDBRequest
            reject(`Error opening cursor: ${error}`);
        };
    });
}

export async function checkAndInitDatabase(): Promise<void> {
    if (!__databaseObj) {
        await initDatabase();
    }
}

/**
 * 通过复合索引（如 userId + timestamp）进行范围查询
 * 按 timestamp 降序排列，最多返回 limit 条数据
 */
export function databaseQueryByIndexRange(
    storeName: string,
    indexName: string,
    rangeValue: any[],
    limit: number
): Promise<any[]> {
    return new Promise((resolve, reject) => {
        if (!__databaseObj) return reject('Database is not initialized');

        const transaction = __databaseObj.transaction([storeName], 'readonly');
        const objectStore = transaction.objectStore(storeName);
        const index = objectStore.index(indexName);

        // 匹配第一个键（userId），timestamp 是范围查询
        const lowerBound = [rangeValue[0], -Infinity];
        const upperBound = [rangeValue[0], Infinity];
        const keyRange = IDBKeyRange.bound(lowerBound, upperBound);

        const request = index.openCursor(keyRange, 'prev'); // timestamp 降序排列
        const results: any[] = [];

        request.onsuccess = event => {
            const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;
            if (cursor && results.length < limit) {
                results.push(cursor.value);
                cursor.continue();
            } else {
                resolve(results);
            }
        };

        request.onerror = event => {
            reject(`Error querying by index range from ${storeName}: ${(event.target as IDBRequest).error}`);
        };
    });
}

export function countTable(storeName: string): Promise<number> {
    return new Promise((resolve, reject) => {
        if (!__databaseObj) return reject("Database is not initialized");

        const transaction = __databaseObj.transaction([storeName], "readonly");
        const objectStore = transaction.objectStore(storeName);
        const request = objectStore.count();

        request.onsuccess = () => {
            resolve(request.result);
        };

        request.onerror = (event) => {
            reject(`Error counting records in ${storeName}: ${(event.target as IDBRequest).error}`);
        };
    });
}

export async function databaseQueryByIndex(
    table: string,
    index: string,
    limit: number = Infinity,
    desc: boolean = true,
    filter?: (row: any) => boolean,
    boundValue?: number // 可选的边界值，例如 timestamp；若 desc=true 则为 upperBound，asc=true 则为 lowerBound
): Promise<any[]> {
    return new Promise((resolve, reject) => {
        if (!__databaseObj) return reject("Database is not initialized");

        const results: any[] = [];
        const tx = __databaseObj.transaction([table], 'readonly');
        const store = tx.objectStore(table);
        const idx = store.index(index);

        const direction = desc ? 'prev' : 'next';

        // 构造 KeyRange 约束：只取小于或大于 boundValue 的数据
        let keyRange: IDBKeyRange | null = null;
        if (boundValue !== undefined) {
            keyRange = desc
                ? IDBKeyRange.upperBound(boundValue, true)   // timestamp < boundValue
                : IDBKeyRange.lowerBound(boundValue, true);  // timestamp > boundValue
        }

        const request = idx.openCursor(keyRange, direction);

        request.onsuccess = (event) => {
            const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;
            if (!cursor) {
                return resolve(results);
            }

            const value = cursor.value;
            if (!filter || filter(value)) {
                results.push(value);
                if (results.length >= limit) {
                    return resolve(results);
                }
            }

            cursor.continue();
        };

        request.onerror = (e) => reject((e.target as IDBRequest).error);
    });
}

export async function pruneOldDataIfNeeded(
    key: string,
    indexName: string,
    storeName: string,
    maxKeep: number
): Promise<number> {
    return new Promise((resolve, reject) => {
        if (!__databaseObj) return reject("Database is not initialized");
        const tx = __databaseObj.transaction([storeName], 'readwrite');
        const store = tx.objectStore(storeName);
        const index = store.index(indexName);

        // Step 1: 先统计数量
        const lowerBound = [key, -Infinity];
        const upperBound = [key, Infinity];
        const keyRange = IDBKeyRange.bound(lowerBound, upperBound);

        const countRequest = index.count(keyRange);

        countRequest.onsuccess = () => {
            const total = countRequest.result;
            if (total <= maxKeep) {
                logDB(`[pruneOldDataIfNeeded] ✅ no need to Pruned total[${total}]`);
                return resolve(0);
            }

            // Step 2: 需要清理的才继续 openCursor
            const cursorRequest = index.openCursor(keyRange, 'prev');
            let count = 0;
            let deleted = 0;

            cursorRequest.onsuccess = (event) => {
                const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;
                if (!cursor) return;

                count++;
                if (count > maxKeep) {
                    cursor.delete();
                    deleted++;
                }

                cursor.continue();
            };

            cursorRequest.onerror = (event) => {
                console.error('[pruneOldDataIfNeeded] ❌ Cursor error:', (event.target as IDBRequest).error);
                reject((event.target as IDBRequest).error);
            };

            tx.oncomplete = () => {
                if (deleted > 0) {
                    logDB(`[pruneOldDataIfNeeded] ✅ Pruned ${deleted} old data for key=${key}`);
                }
                resolve(deleted);
            };
        };

        countRequest.onerror = (event) => {
            reject(`Failed to count records: ${(event.target as IDBRequest).error}`);
        };
    });
}


export function databaseDeleteByIndexValue(
    storeName: string,
    indexName: string,
    indexValue: IDBValidKey
): Promise<number> {
    return new Promise((resolve, reject) => {
        if (!__databaseObj) return reject("Database is not initialized");

        const tx = __databaseObj.transaction([storeName], "readwrite");
        const store = tx.objectStore(storeName);
        const idx = store.index(indexName);

        const range = IDBKeyRange.only(indexValue);
        const req = idx.openCursor(range); // next/prev 都可

        let deleted = 0;

        req.onsuccess = (e) => {
            const cursor = (e.target as IDBRequest<IDBCursorWithValue>).result;
            if (!cursor) return;       // 扫完
            cursor.delete();           // 直接删当前命中记录
            deleted++;
            cursor.continue();
        };

        req.onerror = (e) => reject(`Error deleting by index ${indexName}: ${(e.target as IDBRequest).error}`);

        tx.oncomplete = () => resolve(deleted);
        tx.onerror = (e) => reject(`Tx error: ${(e.target as IDBRequest).error}`);
    });
}

export function databaseQueryByTimeAndUserKeyFiltered(
    table: string,
    limit: number,
    categoryUserIds: Set<string>,
    boundValue?: number, // 上一页最小 timestamp；若提供，则取 timestamp < boundValue
): Promise<any[]> {
    return new Promise((resolve, reject) => {
        if (!__databaseObj) return reject("Database is not initialized");
        if (!categoryUserIds || categoryUserIds.size === 0) return resolve([]);

        const results: any[] = [];
        const tx = __databaseObj.transaction([table], 'readonly');
        const store = tx.objectStore(table);
        const idx = store.index(idx_tweets_time_user); // 确保与建索引名称一致
        const dir = 'prev';

        // 严格小于 boundValue
        const range = (boundValue !== undefined)
            ? IDBKeyRange.upperBound([boundValue], /*open=*/true)
            : null;

        const req = idx.openKeyCursor(range, dir);

        req.onsuccess = (ev) => {
            const cursor = (ev.target as IDBRequest).result as IDBCursor | null;
            if (!cursor) return resolve(results);

            const [, uid] = cursor.key as [number, string | number]; // [timestamp, userId]
            const userId = String(uid);

            if (categoryUserIds.has(userId)) {
                const pk = cursor.primaryKey; // tweetId
                const getReq = store.get(pk);
                getReq.onsuccess = () => {
                    const val = (getReq as IDBRequest).result;
                    if (val) {
                        results.push(val);
                        if (results.length >= limit) {
                            return resolve(results);
                        }
                    }
                    cursor.continue();
                };
                getReq.onerror = () => cursor.continue();
            } else {
                cursor.continue();
            }
        };

        req.onerror = (e) => reject((e.target as IDBRequest).error);
    });
}
