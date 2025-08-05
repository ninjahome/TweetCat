import {loadCategories, removeKolsCategory, updateKolsCategory} from "../object/category";
import {defaultUserName} from "../common/consts";
import {checkAndInitDatabase} from "../common/database";
import {Category} from "../object/category";
import {kolsForCategory, TweetKol} from "../object/tweet_kol";

const queryUrl = new URL(window.location.href);
document.addEventListener("DOMContentLoaded", initKolManager as EventListener);

let _categories: Category[] = [];
let _kolMap: Map<string, TweetKol> = new Map<string, TweetKol>();
let _selectList: HTMLSelectElement;
let _curCatID: Number = -1;

async function initKolManager() {
    const catID = queryUrl.searchParams.get("catID");
    if (!catID) {
        alert("failed to find category id");
        return;
    }
    const catName = queryUrl.searchParams.get("catName")
    document.title = catName ?? "Category Management";
    document.getElementById("category-name")!.textContent = catName;

    await checkAndInitDatabase();

    _curCatID = Number(catID);

    _categories = await loadCategories(defaultUserName);
    populateCategoryList();

    _kolMap = await kolsForCategory(Number(catID));
    populateKolList();
}

function populateCategoryList() {
    _selectList = document.getElementById("category-list") as HTMLSelectElement
    _selectList.innerHTML = '';

    const optionItem = document.getElementById("category-item") as HTMLOptionElement;
    _categories.forEach(cat => {
        const item = optionItem.cloneNode(true) as HTMLOptionElement;
        item.style.display = 'block';
        item.setAttribute('id', '' + cat.id);
        item.value = '' + cat.id;
        item.text = cat.catName;
        _selectList.append(item);
    });
}

function populateKolList() {
    const kolList = document.getElementById("kol-mgn-list") as HTMLDivElement;
    kolList.innerHTML = '';
    document.querySelector(".category-kol-size")!.textContent = "" + _kolMap.size;

    const kolItem = document.getElementById("kol-item-template") as HTMLDivElement;
    _kolMap.forEach(kol => {

        const item = kolItem.cloneNode(true) as HTMLElement;
        item.setAttribute('id', kol.kolName);
        item.style.display = 'flex';

        const infoArea = item.querySelector(".kol-info-area") as HTMLElement;
        const img = infoArea.querySelector(".kolAvatar") as HTMLImageElement
        img.src = kol.avatarUrl ?? "../images/logo_16.png";
        infoArea.querySelector(".kolName")!.textContent = kol.kolName;
        infoArea.querySelector(".kolDisName")!.textContent = kol.displayName;
        infoArea.onclick = () => {
            window.open("https://x.com/" + kol.kolName, '_blank');
        }

        const opArea = item.querySelector(".kol-op-area") as HTMLElement;
        opArea.querySelector(".kol-op-remove")!.addEventListener('click', async () => {
            await removeKolsCategory(kol.kolName)
            updateCache(kol.kolName, item);
        });

        const moveOption = _selectList.cloneNode(true) as HTMLSelectElement;
        moveOption.onchange = async () => {
            if (_curCatID === Number(moveOption.value)) return;
            kol.catID = Number(moveOption.value);
            await updateKolsCategory(kol)
            updateCache(kol.kolName, item);
        };
        moveOption.style.display = 'block';
        moveOption.value = '' + _curCatID;

        opArea.append(moveOption);
        kolList.append(item);
    })
}

function updateCache(name: string, item: HTMLElement) {
    _kolMap.delete(name);
    item.remove();
    document.querySelector(".category-kol-size")!.textContent = "" + _kolMap.size;
}
