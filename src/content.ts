document.addEventListener('DOMContentLoaded', async () => {
    console.log('------>>>TweetCat content script success ✨')
    monitorMainArea();
})


function currentCategory(): string {
    return ""
}

function monitorMainArea() {

    const target = document.querySelector('main[role="main"]');
    if (!target) {
        //TODO::Need a timer to check again
        setTimeout(() => {
            monitorMainArea();
        }, 5000);
        return
    }

    const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
            if (mutation.addedNodes.length > 0) {
                filterTweets(mutation.addedNodes);
            }
        });
    });

    observer.observe(target, {childList: true, subtree: true});
}

function filterTweets(nodes: NodeList) {
    const cat = currentCategory();
    console.log("------>>> current nodes:", nodes)
}


