
export class LRUCache<K, V> {
    private readonly maxSize: number;
    private cache: Map<K, V>;

    constructor(maxSize: number = 1000) {
        if (maxSize <= 0) {
            throw new Error('maxSize must be greater than 0');
        }
        this.maxSize = maxSize;
        this.cache = new Map();
    }

    /**
     * 获取值，同时将该键移到最新位置
     */
    get(key: K): V | undefined {
        const value = this.cache.get(key);
        if (value !== undefined) {
            // 重新插入以更新位置（移到最后）
            this.cache.delete(key);
            this.cache.set(key, value);
        }
        return value;
    }

    /**
     * 设置值，超过容量时自动淘汰最旧的条目
     */
    set(key: K, value: V): void {
        // 如果键已存在，先删除旧的
        if (this.cache.has(key)) {
            this.cache.delete(key);
        }
        // 检查是否需要淘汰
        else if (this.cache.size >= this.maxSize) {
            // Map 的迭代器按插入顺序，第一个就是最旧的
            const firstKey = this.cache.keys().next().value;
            this.cache.delete(firstKey);
        }

        // 插入新值
        this.cache.set(key, value);
    }

    /**
     * 检查键是否存在
     */
    has(key: K): boolean {
        return this.cache.has(key);
    }

    /**
     * 删除指定键
     */
    delete(key: K): boolean {
        return this.cache.delete(key);
    }

    /**
     * 清空缓存
     */
    clear(): void {
        this.cache.clear();
    }

    /**
     * 获取当前大小
     */
    get size(): number {
        return this.cache.size;
    }

    /**
     * 获取最大容量
     */
    get capacity(): number {
        return this.maxSize;
    }

    /**
     * 获取所有键（按从旧到新排序）
     */
    keys(): IterableIterator<K> {
        return this.cache.keys();
    }

    /**
     * 获取所有值
     */
    values(): IterableIterator<V> {
        return this.cache.values();
    }

    /**
     * 获取所有条目
     */
    entries(): IterableIterator<[K, V]> {
        return this.cache.entries();
    }

    /**
     * 批量清理旧条目（可选方法）
     * @param count 要清理的数量，默认清理到容量的 75%
     */
    trim(count?: number): number {
        const targetCount = count ?? Math.floor(this.maxSize * 0.25);
        let removed = 0;

        const keysToRemove: K[] = [];
        for (const key of this.cache.keys()) {
            if (removed >= targetCount) break;
            keysToRemove.push(key);
            removed++;
        }

        keysToRemove.forEach(key => this.cache.delete(key));
        return removed;
    }

    /**
     * 获取缓存命中率统计（需要启用统计）
     */
    getStats(): { size: number; capacity: number; utilizationRate: number } {
        return {
            size: this.cache.size,
            capacity: this.maxSize,
            utilizationRate: (this.cache.size / this.maxSize) * 100
        };
    }
}


// 示例 4: 带统计信息的缓存
class StatsLRUCache<K, V> extends LRUCache<K, V> {
    private hits = 0;
    private misses = 0;

    get(key: K): V | undefined {
        const value = super.get(key);
        if (value !== undefined) {
            this.hits++;
        } else {
            this.misses++;
        }
        return value;
    }

    getHitRate(): number {
        const total = this.hits + this.misses;
        return total === 0 ? 0 : (this.hits / total) * 100;
    }

    resetStats(): void {
        this.hits = 0;
        this.misses = 0;
    }

    getDetailedStats() {
        return {
            ...super.getStats(),
            hits: this.hits,
            misses: this.misses,
            hitRate: this.getHitRate()
        };
    }
}
