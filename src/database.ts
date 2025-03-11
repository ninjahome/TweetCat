let __databaseObj: IDBDatabase | null = null;
const __databaseName = 'tweet-cat-database';
export const __currentDatabaseVersion = 1;
export const __tableCategory = '__table_category__v1';
export const __tableSystemSetting = '__table_system_setting__v1';

export function initDatabase(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(__databaseName, __currentDatabaseVersion);

        request.onerror = function (event: Event) {
            console.error("------>>>[Database]Database open failed:", (event.target as IDBOpenDBRequest).error);
            reject((event.target as IDBOpenDBRequest).error);
        };

        request.onsuccess = function (event: Event) {
            __databaseObj = (event.target as IDBOpenDBRequest).result;
            console.log("------>>>[Database]Database open success, version=", __databaseObj.version);
            resolve(__databaseObj);
        };

        request.onupgradeneeded = function (event: IDBVersionChangeEvent) {
            const db = (event.target as IDBOpenDBRequest).result;
            if (!db.objectStoreNames.contains(__tableCategory)) {
                const objectStore = db.createObjectStore(__tableCategory, {keyPath: 'id', autoIncrement: true});
                console.log("------>>>[Database]Created wallet table successfully.", objectStore);
            }

            if (!db.objectStoreNames.contains(__tableSystemSetting)) {
                const objectStore = db.createObjectStore(__tableSystemSetting, {keyPath: 'id', autoIncrement: true});
                console.log("------>>>[Database]Created wallet setting table successfully.", objectStore);
            }
        };
    });
}

export function closeDatabase() {
    if (__databaseObj) {
        __databaseObj.close();
        console.log("------>>>Database connection closed.");
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

export function databaseGetByID(storeName: string, id: any): Promise<any> {
    return new Promise((resolve, reject) => {
        if (!__databaseObj) {
            reject('Database is not initialized');
            return;
        }
        const transaction = __databaseObj.transaction([storeName], 'readonly');
        const objectStore = transaction.objectStore(storeName);

        const request = objectStore.get(id);

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

export function databaseUpdate(storeName: string, id: any, newData: any): Promise<string> {
    return new Promise((resolve, reject) => {
        if (!__databaseObj) {
            reject('Database is not initialized');
            return;
        }
        const transaction = __databaseObj.transaction([storeName], 'readwrite');
        const objectStore = transaction.objectStore(storeName);

        const request = objectStore.put({...newData, id});

        request.onsuccess = () => {
            resolve(`Data updated in ${storeName} successfully`);
        };

        request.onerror = event => {
            reject(`Error updating data in ${storeName}: ${(event.target as IDBRequest).error}`);
        };
    });
}

export function databaseDelete(storeName: string, id: any): Promise<string> {
    return new Promise((resolve, reject) => {
        if (!__databaseObj) {
            reject('Database is not initialized');
            return;
        }
        const transaction = __databaseObj.transaction([storeName], 'readwrite');
        const objectStore = transaction.objectStore(storeName);
        const request = objectStore.delete(id);

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