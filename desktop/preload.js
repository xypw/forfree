/* 预加载脚本：只做两件事 —— 导出保存完成后的提示，以及「发给朋友」的能力桥接 */
'use strict';
const { ipcRenderer, contextBridge } = require('electron');

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

/* 暴露给渲染进程的原生能力。
   注意：剪贴板写「文件」（CF_HDROP）这条路实测走不通，
   所以「导出并打开文件夹」和系统原生拖拽才是可靠方案。 */
contextBridge.exposeInMainWorld('forfree', {
  isDesktop: true,

  /** 保存文件并打开文件夹。ask=true 弹「另存为」，ask=false 直接存到「下载」文件夹 */
  saveAndReveal: (name, bytes, ask) =>
    ipcRenderer.invoke('ff:save-and-reveal', { name: name, bytes: bytes, ask: !!ask }),

  /** 打开程序自己所在的文件夹（方便把 exe 拷给别人） */
  openAppFolder: () => ipcRenderer.invoke('ff:open-app-folder'),

  /** 把内容写到一个临时文件，返回路径（供系统原生拖拽用） */
  prepareFile: (name, bytes) => ipcRenderer.invoke('ff:prepare-file', { name: name, bytes: bytes }),

  /** 触发 Electron 原生拖拽（用户拖到微信 / 资源管理器 / 邮件附件） */
  startDrag: (filePath) => ipcRenderer.send('ff:start-drag', filePath),

  /** 复制纯文本到系统剪贴板 */
  copyText: (text) => ipcRenderer.send('ff:copy-text', text),

  /** 在资源管理器里显示某个路径 */
  reveal: (p) => ipcRenderer.invoke('ff:reveal', p)
});
