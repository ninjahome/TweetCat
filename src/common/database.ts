import {defaultCategoryName, defaultCatID, defaultUserName} from "./consts";
import {logDB} from "./debug_flags";

let __databaseObj: IDBDatabase | null = null;
const __databaseName = 'tweet-cat-database';
export const __currentDatabaseVersion = 4;
export const __tableCategory = '__table_category__';
export const __tableKolsInCategory = '__table_kol_in_category__';
export const __tableSystemSetting = '__table_system_setting__';
export const __tableCachedTweets = '__table_cached_tweets__'
export const BossOfTheWholeWorld = '44196397';

const initialCategories = [
    {catName: defaultCategoryName, forUser: defaultUserName},
];


const initialKols = [
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
            initCategory(request);
            initKolsInCategory(request);
            initSystemSetting(request);
            initCachedTweetsTable(request);
        };
    });
}

function initCategory(request: IDBOpenDBRequest) {
    const db = request.result;
    const transaction = request.transaction;

    if (db.objectStoreNames.contains(__tableCategory)) {
        return;
    }
    db.createObjectStore(__tableCategory, {keyPath: 'id', autoIncrement: true});
    if (transaction) {
        const categoryStore = transaction.objectStore(__tableCategory);
        initialCategories.forEach(category => {
            categoryStore.add(category);
        });
        logDB("------>>>[Database]Inserted initial categories.", initialCategories);
    }

    logDB("------>>>[Database]Created category successfully.", __tableCategory);
}

function initKolsInCategory(request: IDBOpenDBRequest) {
    const db = request.result;
    const transaction = request.transaction;

    if (db.objectStoreNames.contains(__tableKolsInCategory)) {
        return;
    }
    db.createObjectStore(__tableKolsInCategory, {keyPath: 'kolName'});
    if (transaction) {
        const categoryStore = transaction.objectStore(__tableKolsInCategory);
        initialKols.forEach(kol => {
            categoryStore.add(kol);
        });
        logDB("------>>>[Database]Inserted initial categories.", initialKols);
    }
    logDB("------>>>[Database]Create kols in category successfully.", __tableKolsInCategory);
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
        return;
    }

    const tweetStore = db.createObjectStore(__tableCachedTweets, {keyPath: 'tweetId'});

    tweetStore.createIndex('timestamp_idx', 'timestamp', {unique: false});

    tweetStore.createIndex('userId_timestamp_idx', ['userId', 'timestamp'], {unique: false});

    logDB("------>>>[Database] Created cached tweets table with indexes successfully.", __tableCachedTweets);
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

export function databaseGetByIndex(storeName: string, idx: string, idxVal: any): Promise<any> {
    return new Promise((resolve, reject) => {
        try {
            if (!__databaseObj) {
                reject('Database is not initialized');
                return;
            }
            const transaction = __databaseObj.transaction([storeName], 'readonly');
            const objectStore = transaction.objectStore(storeName);
            const index = objectStore.index(idx);

            const queryRequest = index.get(idxVal);

            queryRequest.onsuccess = function () {
                if (queryRequest.result) {
                    resolve(queryRequest.result);
                } else {
                    resolve(null);
                }
            };

            queryRequest.onerror = function (event) {
                reject('Error in query by key: ' + (event.target as IDBRequest).error);
            };
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

export function databasePutItem(storeName: string, data: any): Promise<IDBValidKey> {
    return new Promise((resolve, reject) => {
        if (!__databaseObj) {
            return reject('Database is not initialized');
        }
        const transaction = __databaseObj.transaction([storeName], 'readwrite');
        const objectStore = transaction.objectStore(storeName);
        const request = objectStore.put(data);

        request.onsuccess = () => resolve(request.result);
        request.onerror = event => {
            reject(`Error putting data to ${storeName}: ${(event.target as IDBRequest).error}`);
        };
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
