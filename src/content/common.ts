export function showGlobalLoading(title: string, details: string = "") {
    const gwo = document.getElementById("global-wait-overlay") as HTMLElement;
    const detail = document.getElementById("global-wait-detail") as HTMLElement;
    const titleSpn = gwo.querySelector(".wait-title") as HTMLElement

    gwo.style.display = "block";
    detail.innerText = details;
    titleSpn.innerText = title;
}

export function hideGlobalLoading() {
    const gwo = document.getElementById("global-wait-overlay") as HTMLElement;
    gwo.style.display = "none";
}
