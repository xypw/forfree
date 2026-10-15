/* ============================================================
   share.js — 发给朋友
   把当前文档交给别人。三条路，都是实测可用的：

   1. 拖到微信 / QQ   —— Electron 原生拖拽（Chromium 用真正的 IDataObject，含 CF_HDROP）
   2. 导出并打开文件夹 —— 写文件 + 在资源管理器里选中
   3. 复制为文本       —— 标准剪贴板文本

   说明：往系统剪贴板写「文件」这条路（CF_HDROP）Electron 的 writeBuffer 做不到，
   实测写 FileNameW / FileName / text/uri-list / CF_HDROP 四个格式名全部无效，
   所以这里不做那个按钮，免得点了没反应。
   ============================================================ */
(function (global) {
  'use strict';
  const FW = global.FW, $ = FW.$, $$ = FW.$$;

  const OFFICE_FORMAT = {
    doc: { ext: 'docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', label: 'Word 文档', ico: 'W', color: '#2B7FE0' },
    sheet: { ext: 'xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', label: 'Excel 工作簿', ico: 'X', color: '#21A366' },
    slide: { ext: 'pptx', mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', label: 'PPT 演示文稿', ico: 'P', color: '#F2994A' }
  };

  const isDesktop = () => !!(global.forfree && global.forfree.isDesktop);

  /* ============================================================
     生成内容
     ============================================================ */
  function buildFile(doc) {
    const f = OFFICE_FORMAT[doc.type];
    if (!f) return null;
    const O = global.OFFICE;
    let bytes;
    if (doc.type === 'doc') bytes = O.buildDocx(doc);
    else if (doc.type === 'sheet') bytes = O.buildXlsx(doc);
    else bytes = O.buildPptx(doc);
    return { name: (doc.title || '未命名') + '.' + f.ext, bytes: bytes, mime: f.mime, meta: f };
  }

  function buildText(doc) {
    const O = global.OFFICE;
    if (doc.type === 'doc') return O.docToText(doc.data.html);
    if (doc.type === 'sheet') return O.sheetToCsv(doc.data.sheets[0]);
    if (doc.type === 'slide') {
      return doc.data.slides.map((s, i) =>
        '【第 ' + (i + 1) + ' 页】\n' + (s.shapes || []).map((x) => x.text || '').filter(Boolean).join('\n')
      ).join('\n\n');
    }
    return '';
  }

  /* ============================================================
     面板
     ============================================================ */
  let modal = null;
  let ctx = null;   // { doc, file, text, tmpPath }

  function buildModal() {
    if (modal) return modal;
    modal = document.createElement('div');
    modal.className = 'modal-mask';
    modal.id = 'shareMask';
    modal.innerHTML =
      '<div class="modal modal-wide">' +
      '<div class="modal-head"><h3>发给朋友</h3><button class="modal-x" data-sh-close>×</button></div>' +
      '<div class="modal-body sh-body">' +
      '<div class="sh-file" id="shFile"></div>' +
      '<div class="sh-ways" id="shWays"></div>' +
      '<p class="sh-note" id="shNote"></p>' +
      '</div></div>';
    document.body.appendChild(modal);
    modal.addEventListener('click', (e) => {
      if (e.target === modal || e.target.closest('[data-sh-close]')) close();
    });
    return modal;
  }

  function renderWays() {
    const box = $('#shWays', modal);
    const d = isDesktop();
    const ways = [];

    if (d) {
      ways.push(
        '<div class="sh-way">' +
        '<div class="sw-t"><strong>拖到微信 / QQ</strong><span>按住右边的图标，拖到聊天窗口松手就行</span></div>' +
        '<div class="sw-drag" id="shDrag" draggable="true" title="按住拖到微信">' +
        '<span class="sd-ico">' + ctx.file.meta.ico + '</span><span>拖我</span></div>' +
        '</div>');
    }

    ways.push(
      '<div class="sh-way">' +
      '<div class="sw-t"><strong>导出到电脑</strong><span>' +
      (d ? '存好后自动弹出文件夹并选中文件，拖进微信即可' : '保存到下载文件夹') + '</span></div>' +
      '<button class="ghost-btn" id="shSave">导出 ' + ctx.file.meta.ext.toUpperCase() + '</button>' +
      '</div>');

    ways.push(
      '<div class="sh-way">' +
      '<div class="sw-t"><strong>复制为文本</strong><span>直接粘到微信、邮件、任何输入框</span></div>' +
      '<button class="ghost-btn" id="shCopy">复制文本</button>' +
      '</div>');

    box.innerHTML = ways.join('');

    const dragEl = $('#shDrag', modal);
    if (dragEl) {
      dragEl.addEventListener('dragstart', (e) => {
        e.preventDefault();
        if (ctx.tmpPath) global.forfree.startDrag(ctx.tmpPath);
        else FW.toast('文件还没准备好，稍等一下再拖');
      });
      // 鼠标按下时若还没准备好，补一次
      dragEl.addEventListener('mousedown', () => { if (!ctx.tmpPath) prepareTemp(); });
    }

    $('#shSave', modal).addEventListener('click', doSave);
    $('#shCopy', modal).addEventListener('click', doCopy);
  }

  async function prepareTemp() {
    if (!isDesktop() || !ctx || ctx.tmpPath) return;
    try {
      const r = await global.forfree.prepareFile(ctx.file.name, ctx.file.bytes);
      ctx.tmpPath = r.path;
    } catch (e) {
      console.warn('准备临时文件失败', e);
    }
  }

  async function doSave() {
    if (isDesktop()) {
      try {
        const r = await global.forfree.saveAndReveal(ctx.file.name, ctx.file.bytes);
        if (r && r.ok) {
          FW.toast('已保存并在文件夹中选中：' + r.path, 4200);
        } else if (r && r.canceled) {
          FW.toast('已取消');
        } else {
          FW.toast('保存失败');
        }
      } catch (e) {
        FW.toast('保存失败：' + e.message, 3600);
      }
      return;
    }
    FW.downloadBytes(ctx.file.name, ctx.file.bytes, ctx.file.mime);
    FW.toast('已导出 ' + ctx.file.meta.label);
  }

  async function doCopy() {
    const text = ctx.text || '';
    if (!text.trim()) { FW.toast('这个文档没有可复制的文字'); return; }
    try {
      if (isDesktop()) {
        global.forfree.copyText(text);
      } else if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      FW.toast('已复制 ' + text.length + ' 个字符，去微信里 Ctrl+V 就行', 3200);
    } catch (e) {
      FW.toast('复制失败：' + e.message, 3600);
    }
  }

  function open(docId) {
    let doc = docId ? FW.Store.get(docId) : (FW.app.currentDoc ? FW.app.currentDoc() : null);
    if (!doc) { FW.toast('请先打开一个文档'); return; }
    // 从编辑器取最新内容
    const ed = FW.Editors[doc.type];
    if (ed && ed.getData && FW.app.currentDoc && FW.app.currentDoc() === doc) {
      try { doc.data = ed.getData(); } catch (e) {}
    }

    const file = buildFile(doc);
    if (!file) { FW.toast('这个类型暂不支持分享'); return; }
    ctx = { doc: doc, file: file, text: buildText(doc), tmpPath: null };

    buildModal();
    const m = file.meta;
    $('#shFile', modal).innerHTML =
      '<span class="sf-ico" style="background:' + m.color + '">' + m.ico + '</span>' +
      '<div class="sf-t"><strong>' + FW.escapeHtml(file.name) + '</strong>' +
      '<span>' + m.label + ' · ' + FW.fmtSize(file.bytes.length) + ' · 共 ' + (ctx.text.replace(/\s/g, '').length) + ' 字</span></div>';

    $('#shNote', modal).textContent = isDesktop()
      ? '提示：拖拽是最快的方式 —— 按住「拖我」不放，移到微信聊天窗口上松手即可发送。'
      : '网页版只能下载文件或复制文本。装桌面版可以直接把文件拖进微信。';

    renderWays();
    modal.classList.add('on');
    if (isDesktop()) prepareTemp();   // 提前把临时文件准备好，拖的时候不卡
  }

  function close() {
    if (modal) modal.classList.remove('on');
    ctx = null;
  }

  global.SHARE = { open: open, close: close, buildFile: buildFile, buildText: buildText };
})(window);
