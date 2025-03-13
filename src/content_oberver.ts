import {activeCategory} from "./content_category";

const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
        if (mutation.addedNodes.length > 0) {
            filterTweets(mutation.addedNodes);
        }
    });
});

export function observerTweetList(){
    observer.observe(document.body, {childList: true, subtree: true});
}

function filterTweets(nodes: NodeList) {
    const cat = activeCategory();
    if (!cat){
        return;
    }
    nodes.forEach((cellInnerDiv) => {
        if (!isTweetDiv(cellInnerDiv)) {
            // console.log("------>>> not tweet div",cellInnerDiv)
            return;
        }
        console.log("------>>> tweet div：", window.location.href, cellInnerDiv)
    });
}

function isTweetDiv(node: Node): node is HTMLDivElement {
    return (
        node instanceof HTMLDivElement && // 检查是否为 <div> 元素
        node.dataset.testid === 'cellInnerDiv'
    );
}
