/* 预加载脚本：只做一件事 —— 导出文件保存完成后，在界面上提示保存路径 */
'use strict';
const { ipcRenderer } = require('electron');

window.addEventListener('DOMContentLoaded', () => {
  ipcRenderer.on('fw-download-done', (evt, filePath) => {
    const t = document.getElementById('toast');
    if (!t) return;
    t.textContent = '已保存到：' + filePath;
    t.classList.add('on');
    clearTimeout(window.__fwToastTimer);
    window.__fwToastTimer = setTimeout(() => t.classList.remove('on'), 3600);
  });
});
