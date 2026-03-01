import { log } from './utils.js';

const DB_NAME = 'ST-CharManager-DB';
const DB_VERSION = 1;
const STORE_NAME = 'keyvalue';

let db = null;

function openDB() {
    return new Promise((resolve, reject) => {
        if (db) return resolve(db);

        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onerror = (event) => {
            console.error('[CharManager] IndexedDB error:', event.target.error);
            reject(event.target.error);
        };

        request.onsuccess = (event) => {
            db = event.target.result;
            resolve(db);
        };

        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME);
            }
        };
    });
}

export async function getCache(key) {
    try {
        const db = await openDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([STORE_NAME], 'readonly');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.get(key);

            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    } catch (e) {
        console.error('[CharManager] Failed to get cache:', e);
        return null;
    }
}

export async function setCache(key, value) {
    try {
        const db = await openDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([STORE_NAME], 'readwrite');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.put(value, key);

            // 使用事务完成事件确保数据真正落盘
            // request.onsuccess 仅表示请求成功，但事务可能尚未提交
            // transaction.oncomplete 才是数据真正持久化的边界
            transaction.oncomplete = () => resolve();
            transaction.onerror = () => reject(transaction.error);
            transaction.onabort = () => reject(new Error('Transaction aborted'));
            
            // 仍然需要监听 request 错误以便及早发现问题
            request.onerror = () => reject(request.error);
        });
    } catch (e) {
        console.error('[CharManager] Failed to set cache:', e);
        throw e;
    }
}

/**
 * 批量写入多个 key-value 对（原子事务）
 * 确保多 key 写入在同一事务中完成，避免部分成功导致的数据不一致
 * 【修复】添加对每个 item 的边界检查
 * @param {Array<{key: string, value: any}>} items - 要写入的 key-value 对数组
 * @returns {Promise<void>}
 */
export async function setCacheBatch(items) {
    if (!items || items.length === 0) return;
    
    // 过滤无效项，避免写入失败
    const validItems = items.filter(item =>
        item &&
        item.key !== undefined &&
        item.key !== null &&
        item.value !== undefined
    );
    
    if (validItems.length === 0) {
        console.warn('[CharManager] setCacheBatch: 无有效数据项');
        return;
    }
    
    try {
        const db = await openDB();
        return new Promise((resolve, reject) => {
            // 使用单一事务写入所有数据
            const transaction = db.transaction([STORE_NAME], 'readwrite');
            const store = transaction.objectStore(STORE_NAME);
            
            let errorOccurred = null;
            
            for (const item of validItems) {
                try {
                    store.put(item.value, item.key);
                } catch (e) {
                    errorOccurred = e;
                    break;
                }
            }
            
            if (errorOccurred) {
                transaction.abort();
                reject(errorOccurred);
                return;
            }
            
            // 使用事务完成事件确保所有数据真正落盘
            transaction.oncomplete = () => {
                log('[CharManager] Batch cache saved:', validItems.length, 'items');
                resolve();
            };
            
            transaction.onerror = () => reject(transaction.error);
            transaction.onabort = () => reject(new Error('Transaction aborted'));
        });
    } catch (e) {
        console.error('[CharManager] Failed to set cache batch:', e);
        throw e;
    }
}

export async function clearCache(key) {
    try {
        const db = await openDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([STORE_NAME], 'readwrite');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.delete(key);

            // 使用事务完成事件确保数据真正落盘
            transaction.oncomplete = () => resolve();
            transaction.onerror = () => reject(transaction.error);
            transaction.onabort = () => reject(new Error('Transaction aborted'));
            
            request.onerror = () => reject(request.error);
        });
    } catch (e) {
        console.error('[CharManager] Failed to clear cache:', e);
    }
}

/**
 * 清除 IndexedDB 中所有缓存数据
 * @returns {Promise<string[]>} 已清除的 key 列表
 */
export async function clearAllCache() {
    try {
        const db = await openDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([STORE_NAME], 'readwrite');
            const store = transaction.objectStore(STORE_NAME);
            
            // 用于保存 keys 的闭包变量
            let cachedKeys = [];
            
            // 获取所有 keys
            const getAllKeysRequest = store.getAllKeys();
            
            getAllKeysRequest.onsuccess = () => {
                // 先保存 keys 到闭包变量，避免事务完成后请求结果不可用
                cachedKeys = getAllKeysRequest.result;
                const clearRequest = store.clear();
                
                clearRequest.onerror = () => reject(clearRequest.error);
            };
            
            // 使用事务完成事件确保数据真正落盘
            transaction.oncomplete = () => {
                log('[CharManager] IndexedDB 缓存已清除:', cachedKeys);
                resolve(cachedKeys);
            };
            
            transaction.onerror = () => reject(transaction.error);
            
            getAllKeysRequest.onerror = () => reject(getAllKeysRequest.error);
        });
    } catch (e) {
        console.error('[CharManager] Failed to clear all cache:', e);
        return [];
    }
}

// 迁移逻辑
export async function migrateFromLocalStorage(key) {
    try {
        const raw = localStorage.getItem(key);
        if (raw) {
            log('正在从 LocalStorage 迁移数据到 IndexedDB...');
            const data = JSON.parse(raw);
            if (Array.isArray(data) && data.length > 0) {
                await setCache(key, data);
                localStorage.removeItem(key); // 迁移成功后删除旧数据
                log('迁移完成，已清除 LocalStorage 旧数据');
                return data;
            }
        }
    } catch (e) {
        console.error('[CharManager] Migration failed:', e);
    }
    return null;
}