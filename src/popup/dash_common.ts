
// 显示确认弹窗
export function showConfirmPopup(message: string, onConfirm: () => void): void {
    const popup = document.getElementById('confirm-popup') as HTMLDivElement;
    const msgSpan = document.getElementById('confirm-message') as HTMLParagraphElement;
    const btnCancel = document.getElementById('btn-cancel') as HTMLButtonElement;
    const btnOk = document.getElementById('btn-ok') as HTMLButtonElement;

    if (!popup || !msgSpan || !btnCancel || !btnOk) {
        console.error('confirm popup elements not found');
        return;
    }

    // 设置提示消息
    msgSpan.textContent = message;

    // 显示弹窗
    popup.style.display = 'block';

    // 取消按钮
    btnCancel.onclick = () => {
        popup.style.display = 'none';
    };

    // 确定按钮
    btnOk.onclick = () => {
        popup.style.display = 'none';
        onConfirm();
    };
}

export function showAlert(title:string, message:string) {
    const alertBox = document.getElementById('custom-alert');
    const alertTitle = document.getElementById('alert-title');
    const alertMessage = document.getElementById('alert-message');
    const alertOk = document.getElementById('alert-ok');

    if (!alertBox || !alertTitle || !alertMessage || !alertOk) {
        console.error('Alert elements not found.');
        return;
    }

    // 设置标题和消息
    alertTitle.textContent = title;
    alertMessage.textContent = message;

    // 显示弹窗
    alertBox.style.display = 'block';

    // 按下 OK 按钮后隐藏
    alertOk.onclick = () => {
        alertBox.style.display = 'none';
    };
}

export function showLoading() {
    const overlay = document.getElementById('loading-overlay');
    if (overlay) {
        overlay.style.display = 'flex';
    }
}

export function hideLoading() {
    const overlay = document.getElementById('loading-overlay');
    if (overlay) {
        overlay.style.display = 'none';
    }
}
