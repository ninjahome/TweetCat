const syncBtn = document.getElementById("sync-btn")!;
const emptyState = document.getElementById("empty-state")!;
const userList = document.getElementById("user-list")!;

syncBtn.addEventListener("click", async () => {
    emptyState.style.display = "none";
    userList.style.display = "grid";

    // renderUsers(users);
});

function renderUsers(users) {
    userList.innerHTML = "";
    for (const user of users) {
        const card = document.createElement("div");
        card.className = "user-card";
        card.innerHTML = `
      <img src="${user.avatar}" alt="">
      <div class="info">
        <div class="name">${user.name}</div>
        <div class="handle">@${user.handle}</div>
      </div>
      <input type="checkbox" data-id="${user.id}">
    `;
        userList.appendChild(card);
    }
}
