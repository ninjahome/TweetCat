
const poolDebug = true;
const log = (...args: any[]) => poolDebug && console.log("[TweetCat]", ...args);
export class NodePool {
    private pool: Map<string, HTMLElement> = new Map();

    constructor(private readonly maxSize: number = 1000) {
    }

    acquire(id: string): HTMLElement | undefined {
        const node = this.pool.get(id);
        if (node) {
            this.pool.delete(id);
            log(`[NodePool] Reuse node for id=${id}`);
        }
        log(`[NodePool] acquire id=${id} => ${!!node ? "HIT" : "MISS"}`);
        return node;
    }

    release(id: string, node: HTMLElement) {
        if (this.pool.has(id)) return;  // 防止重复加入

        if (this.pool.size >= this.maxSize) {
            const oldestEntry = this.pool.entries().next().value as [string, HTMLElement];
            if (oldestEntry) {
                const [oldestId, oldestNode] = oldestEntry;
                this.pool.delete(oldestId);
                log(`[NodePool] Discard oldest node id=${oldestId}`);
                oldestNode.remove();
                oldestNode.innerHTML = "";
            }
        }

        this.pool.set(id, node);
        log(`[NodePool] Released node id=${id}, current size: ${this.pool.size}`);
    }

    size() {
        return this.pool.size;
    }

    clear() {
        this.pool.clear();
        log(`[NodePool] Cleared`);
    }
}


export const globalNodePool = new NodePool();
