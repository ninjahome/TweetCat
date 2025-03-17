import {activeCategory} from "./content_category";
import {parseNameFromTweetCell} from "./content_filter";

const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
        if (mutation.addedNodes.length > 0) {
            filterTweets(mutation.addedNodes);
        }
    });
});

export function observerTweetList() {
    observer.observe(document.body, {childList: true, subtree: true});
}

function filterTweets(nodes: NodeList) {
    const kolNameInCategory = activeCategory();
    if (!kolNameInCategory) {
        return;
    }
    nodes.forEach((cellInnerDiv) => {
        if (!isTweetDiv(cellInnerDiv)) {
            // console.log("------>>> not tweet div", cellInnerDiv)
            return;
        }
        const user = parseNameFromTweetCell(cellInnerDiv);
        if (!user) {
            console.log("------>>> failed parse user name :", cellInnerDiv);
            return;
        }

        if(kolNameInCategory.has(user.userName)){
            console.log('------>>> tweet hint:', user.nameVal());
        }else{
            console.log('------>>> tweet missed:', user.nameVal());
            cellInnerDiv.style.display= "none";
        }
    });
}

function isTweetDiv(node: Node): node is HTMLDivElement {
    return (
        node instanceof HTMLDivElement && // 检查是否为 <div> 元素
        node.dataset.testid === 'cellInnerDiv'
    );
}
