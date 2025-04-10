const imageList: string[] = [
    "../images/add-category.jpg",
    "../images/add-kol.jpg",
    "../images/use-category.jpg",
    "../images/manage-category.jpg",
    "../images/ManageKOL.jpg"
];

let currentIndex = 0;

function openModal(index: number): void {
    currentIndex = index;
    const modal = document.getElementById("modal") as HTMLElement | null;
    const modalImg = document.getElementById("modal-img") as HTMLImageElement | null;

    if (modal && modalImg) {
        modalImg.src = imageList[currentIndex];
        modal.style.display = "flex";
    }
}

function closeModal(): void {
    const modal = document.getElementById("modal") as HTMLElement | null;
    if (modal) {
        modal.style.display = "none";
    }
}

function prevImage(event: Event): void {
    event.stopPropagation();
    currentIndex = (currentIndex - 1 + imageList.length) % imageList.length;
    const modalImg = document.getElementById("modal-img") as HTMLImageElement | null;
    if (modalImg) {
        modalImg.src = imageList[currentIndex];
    }
}

function nextImage(event: Event): void {
    event.stopPropagation();
    currentIndex = (currentIndex + 1) % imageList.length;
    const modalImg = document.getElementById("modal-img") as HTMLImageElement | null;
    if (modalImg) {
        modalImg.src = imageList[currentIndex];
    }
}

document.addEventListener("DOMContentLoaded", initDashBoard);

function initDashBoard(): void {
    document.addEventListener("keydown", (e: KeyboardEvent) => {
        const modal = document.getElementById("modal") as HTMLElement | null;
        if (modal && modal.style.display === "flex") {
            if (e.key === "ArrowLeft") prevImage(e);
            if (e.key === "ArrowRight") nextImage(e);
            if (e.key === "Escape") closeModal();
        }
    });

    const leftArrow = document.querySelector(".arrow.left") as HTMLElement | null;
    const rightArrow = document.querySelector(".arrow.right") as HTMLElement | null;

    leftArrow?.addEventListener("click", (evt: MouseEvent) => {
        prevImage(evt);
    });

    rightArrow?.addEventListener("click", (evt: MouseEvent) => {
        nextImage(evt);
    });

    const cards = document.querySelectorAll(".grid .card");
    for (let i = 0; i < cards.length; i++) {
        const card = cards[i] as HTMLElement;
        card.onclick = () => {
            openModal(i);
        }
    }
}
