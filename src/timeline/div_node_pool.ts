import {logPool} from "../common/debug_flags";
import {TweetCatCell} from "./tweet_div_cell";
import {LRUCache} from "../common/lru_map";

export class NodePool {
    private pool = new LRUCache<string, HTMLElement> (1000);
    private nodeToCellMap = new LRUCache<HTMLElement, TweetCatCell>(1000);

    constructor(private readonly maxSize: number = 300) {
    }

    acquire(id: string): HTMLElement | undefined {
        const node = this.pool.get(id);
        if (node) {
            this.pool.delete(id);
            logPool(`[NodePool] Reuse node for id=${id}`);
        }
        logPool(`[NodePool] acquire id=${id} => ${!!node ? "HIT" : "MISS"}`);
        return node;
    }

    get(id:string): HTMLElement | undefined{
        return this.pool.get(id);
    }

    release(id: string, node: HTMLElement) {
        if (this.pool.has(id)) return;  // 防止重复加入

        if (this.pool.size >= this.maxSize) {
            const oldestEntry = this.pool.entries().next().value as [string, HTMLElement];
            if (oldestEntry) {
                const [oldestId, oldestNode] = oldestEntry;
                this.pool.delete(oldestId);
                logPool(`[NodePool] Discard oldest node id=${oldestId}`);
                if(oldestNode){
                    oldestNode.remove();
                    oldestNode.innerHTML = "";
                }
            }
        }

        this.pool.set(id, node);
        logPool(`[NodePool] Released node id=${id}, current size: ${this.pool.size}`);
    }

    size() {
        return this.pool.size;
    }

    clear() {
        this.pool.clear();
        this.nodeToCellMap.clear();
        logPool(`[NodePool] Cleared`);
    }

    register(cell: TweetCatCell, node: HTMLElement) {
        this.nodeToCellMap.set(node, cell);
    }

    unregister(node: HTMLElement) {
        this.nodeToCellMap.delete(node);
    }

    getCellFromNode(node: HTMLElement): TweetCatCell | undefined {
        return this.nodeToCellMap.get(node);
    }
}

export const globalNodePool = new NodePool();
// 工具函数
export function findCellFromNode(node: HTMLElement): TweetCatCell | undefined {
    return globalNodePool.getCellFromNode(node);
}
