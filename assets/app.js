/* ============================================================
   app.js — 应用外壳：首页 / 路由 / 功能区 / 导出
   ============================================================ */
(function (global) {
  'use strict';
  const FW = global.FW, $ = FW.$, $$ = FW.$$;
  const Store = FW.Store;

  let currentType = null;   // doc | sheet | slide | pdf
  let currentDoc = null;
  let dirty = false;
  let saveTimer = null;
  let ribbonTab = {};

  // 每个窗口一个标识，用来区分「这条记录是哪个窗口写的」（多窗口场景）
  const WINDOW_ID = Math.random().toString(36).slice(2) + Date.now().toString(36);

  const app = {
    current: () => currentType,
    refreshStatus,
    syncRibbonState
  };
  FW.app = app;

  /* ============================================================
     视图切换
     ============================================================ */
  function showView(id) {
    $$('.view').forEach((v) => v.classList.remove('active'));
    $('#view-' + id).classList.add('active');
  }

  /* ============================================================
     首页
     ============================================================ */
  /* 模板数据已抽到 assets/templates.js（30+ 套，覆盖文字 / 表格 / 演示） */

  let tplFilter = 'all';

  function renderTplFilter() {
    const cats = [
      { k: 'all', t: '全部' },
      { k: 'doc', t: '文字文档' },
      { k: 'sheet', t: '电子表格' },
      { k: 'slide', t: '演示文稿' }
    ];
    $('#tplFilter').innerHTML = cats.map((c) =>
      '<button class="tpl-tab' + (tplFilter === c.k ? ' on' : '') + '" data-cat="' + c.k + '">' + c.t + '</button>').join('');
  }

  function renderTemplates() {
    const all = global.TEMPLATES.all;
    const list = tplFilter === 'all' ? all : all.filter((t) => t.type === tplFilter);
    $('#tplCount').textContent = '共 ' + list.length + ' 套，全部免费';
    $('#tplGrid').innerHTML = list.map((t) =>
      '<button class="tpl-card" data-tpl="' + t.key + '">' +
      '<div class="tpl-thumb" style="background:linear-gradient(140deg,' + t.color + 'CC,' + t.color + ')">' +
      '<span class="tpl-cat">' + (FW.TYPE_META[t.type] || {}).name + ' · ' + t.cat + '</span>' +
      '<span class="tpl-name">' + FW.escapeHtml(t.name) + '</span></div>' +
      '<div class="tpl-meta"><strong>' + FW.escapeHtml(t.name) + '</strong><span>' + t.desc + '</span></div></button>').join('');
  }

  /* ---------------- 最近打开 ---------------- */
  const RECENT_FILTERS = [
    { k: 'all', label: '全部' },
    { k: 'doc', label: '文字' },
    { k: 'sheet', label: '表格' },
    { k: 'slide', label: '演示' }
  ];
  let recentType = 'all';

  /* 按自然日分组（今天 / 昨天 / 本周内 / 30 天内 / 更早）。
     用自然日的 0 点算，不是「24 小时前」—— 凌晨看的文档早上还在「今天」里才对。 */
  function recentGroupOf(ts) {
    const now = new Date();
    const today0 = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const t = ts || 0;
    if (t >= today0) return '今天';
    if (t >= today0 - 864e5) return '昨天';
    if (t >= today0 - 6 * 864e5) return '本周内';
    if (t >= today0 - 29 * 864e5) return '30 天内';
    return '更早';
  }

  function renderRecentFilter(all) {
    const box = $('#recentFilter');
    if (!box) return;
    const countOf = (k) => (k === 'all' ? all.length : all.filter((d) => d.type === k).length);
    box.innerHTML = RECENT_FILTERS.map((f) => {
      const c = countOf(f.k);
      return '<button class="recent-tab' + (recentType === f.k ? ' on' : '') + '" data-rt="' + f.k + '"' +
        (c ? '' : ' disabled') + '>' + f.label + (c ? '<em>' + c + '</em>' : '') + '</button>';
    }).join('');
  }

  function recentItemHtml(d) {
    const m = FW.TYPE_META[d.type] || { name: '文档', icon: '?', color: '#8D949E' };
    // 列表按「打开时间」排，所以这里也显示打开时间；修改时间放到 title 里
    const when = d.openedAt ? '打开于 ' + FW.fmtTime(d.openedAt) : '修改于 ' + FW.fmtTime(d.updated);
    return '<div class="recent-item" data-id="' + d.id + '" title="最后修改：' + FW.fmtTime(d.updated) + '">' +
      '<div class="ri-icon" style="background:' + m.color + '">' + m.icon + '</div>' +
      '<div class="ri-main"><strong>' + FW.escapeHtml(d.title || '未命名') + '</strong>' +
      '<span>' + m.name + ' · ' + when + '</span></div>' +
      '<div class="ri-actions">' +
      '<button class="mini-btn" data-act="open">打开</button>' +
      '<button class="mini-btn" data-act="newwin">新窗口</button>' +
      '<button class="mini-btn" data-act="share">发给朋友</button>' +
      '<button class="mini-btn" data-act="history">版本' +
      (Store.versionCount(d.id) ? ' ' + Store.versionCount(d.id) : '') + '</button>' +
      '<button class="mini-btn" data-act="diff">对比</button>' +
      '<button class="mini-btn" data-act="copy">复制</button>' +
      '<button class="mini-btn" data-act="rename">重命名</button>' +
      '<button class="mini-btn danger" data-act="del">删除</button>' +
      '</div></div>';
  }

  function renderRecent(filter) {
    const all = Store.listRecent();
    const kw = String(filter || '').trim().toLowerCase();
    let list = all;
    if (recentType !== 'all') list = list.filter((d) => d.type === recentType);
    if (kw) list = list.filter((d) => (d.title || '').toLowerCase().indexOf(kw) >= 0);

    $('#recentCount').textContent = all.length ? '共 ' + all.length + ' 个文档' : '';
    renderRecentFilter(all);

    const box = $('#recentList');
    if (!list.length) {
      box.innerHTML = '<div class="empty">' + ((kw || recentType !== 'all')
        ? '没有匹配的文档'
        : '还没有文档，点击上方「新建」或「模板」开始吧') + '</div>';
      return;
    }

    // 分组。listRecent 已经按时间从新到旧排好，所以组天然也是这个顺序
    const groups = [];
    let cur = null;
    list.slice(0, 60).forEach((d) => {
      const g = recentGroupOf(d.openedAt || d.updated);
      if (!cur || cur.name !== g) { cur = { name: g, items: [] }; groups.push(cur); }
      cur.items.push(d);
    });

    box.innerHTML = groups.map((g) =>
      '<div class="recent-group">' +
        '<div class="rg-head">' + g.name + '<em>' + g.items.length + '</em></div>' +
        g.items.map(recentItemHtml).join('') +
      '</div>'
    ).join('');
  }

  function updateStorageInfo() {
    const bytes = Store.usage();
    const n = Store.list().length;
    $('#storageInfo').textContent = '已使用约 ' + FW.fmtSize(bytes) + ' · ' + n + ' 个文档';
  }

  /* ============================================================
     功能区
     ============================================================ */
  function renderRibbon() {
    const ed = FW.Editors[currentType];
    if (!ed) return;
    const tabs = ed.ribbon;
    if (!ribbonTab[currentType]) ribbonTab[currentType] = 0;
    const ti = Math.min(ribbonTab[currentType], tabs.length - 1);
    $('#ribbonTabs').innerHTML = tabs.map((t, i) =>
      '<button class="rt-tab' + (i === ti ? ' active' : '') + '" data-tab="' + i + '">' + FW.escapeHtml(t.tab) + '</button>').join('');
    $('#ribbonBody').innerHTML = tabs[ti].groups.map((g) =>
      '<div class="rb-group"><div class="rb-items">' + g.items.map(itemHtml).join('') + '</div>' +
      '<div class="rb-label">' + FW.escapeHtml(g.label) + '</div></div>').join('');
  }

  function itemHtml(it) {
    if (it.t === 'select') {
      return '<select class="rb-select" data-cmd="' + it.cmd + '" style="width:' + (it.width || 80) + 'px">' +
        '<option value="">—</option>' +
        it.options.map((o) => '<option value="' + FW.escapeHtml(o.v) + '">' + FW.escapeHtml(o.t) + '</option>').join('') +
        '</select>';
    }
    if (it.t === 'color') {
      return '<label class="rb-color" data-cmd="' + it.cmd + '" data-value="' + it.value + '" title="' + it.label + '">' +
        '<span class="g">' + it.g + '</span><span class="bar" style="background:' + it.value + '"></span>' +
        '<span>' + FW.escapeHtml(it.label) + '</span>' +
        '<input type="color" value="' + it.value + '" style="display:none"></label>';
    }
    return '<button class="rb-btn' + (it.wide ? ' wide' : '') + '" data-cmd="' + it.cmd + '"' +
      (it.toggle ? ' data-toggle="1"' : '') + ' title="' + FW.escapeHtml(it.label) + '"' +
      (it.style ? ' style="' + it.style + '"' : '') + '>' +
      '<span class="g">' + it.g + '</span><span>' + FW.escapeHtml(it.label) + '</span></button>';
  }

  function bindRibbon() {
    $('#ribbonTabs').addEventListener('click', (e) => {
      const t = e.target.closest('.rt-tab');
      if (!t) return;
      ribbonTab[currentType] = +t.dataset.tab;
      renderRibbon();
    });

    $('#ribbonBody').addEventListener('click', (e) => {
      const sel = e.target.closest('.rb-select');
      if (sel) return;
      const color = e.target.closest('.rb-color');
      if (color) {
        e.preventDefault();
        const inp = color.querySelector('input');
        inp.value = color.dataset.value || '#000000';
        inp.click();
        return;
      }
      const btn = e.target.closest('.rb-btn');
      if (!btn) return;
      const ed = FW.Editors[currentType];
      if (!ed) return;
      const cmd = btn.dataset.cmd;
      ed.cmd(cmd);
      if (btn.dataset.toggle) btn.classList.toggle('on');
    });

    $('#ribbonBody').addEventListener('change', (e) => {
      const ed = FW.Editors[currentType];
      if (!ed) return;
      const sel = e.target.closest('.rb-select');
      if (sel) { ed.cmd(sel.dataset.cmd, sel.value); return; }
      const inp = e.target.closest('.rb-color input[type=color]');
      if (inp) {
        const label = inp.closest('.rb-color');
        label.dataset.value = inp.value;
        label.querySelector('.bar').style.background = inp.value;
        ed.cmd(label.dataset.cmd, inp.value);
      }
    });
  }

  function syncRibbonState(map) {
    if (!map) return;
    $$('#ribbonBody [data-cmd]').forEach((el) => {
      const c = el.dataset.cmd;
      if (c in map) el.classList.toggle('on', !!map[c]);
    });
    // PDF 工具高亮
    $$('#ribbonBody .rb-btn[data-cmd^="tool:"]').forEach((el) => {
      const t = el.dataset.cmd.slice(5);
      if (t === 'image') return;
    });
  }

  /* ============================================================
     打开文档
     ============================================================ */
  function openDoc(doc) {
    if (currentType && FW.Editors[currentType] && FW.Editors[currentType].unmount) {
      try { FW.Editors[currentType].unmount(); } catch (e) { console.warn('[编辑器] 卸载失败，可能残留状态', e); }
    }
    currentDoc = doc;
    currentType = doc.type;
    const ed = FW.Editors[doc.type];
    if (!ed) { FW.toast('未知的文档类型'); return; }

    $('#appBadge').textContent = ed.badge;
    $('#appBadge').className = 'app-badge ' + (ed.badgeCls || '');
    $('#docTitle').value = doc.title || '未命名';
    $('#docTitle').readOnly = false;

    $$('.app-pane').forEach((p) => p.classList.remove('active'));
    $('#pane-' + doc.type).classList.add('active');

    ribbonTab[doc.type] = 0;
    renderRibbon();
    ed.setChangeHandler(() => markDirty());
    ed.mount(doc);

    showView('editor');
    setSaveState(true);
    dirty = false;
    refreshStatus();

    // 记一笔「最近打开」——首页的最近列表按这个排序，与修改时间分开记
    Store.touchOpen(doc.id);

    // 记住最后打开的文档，下次启动直接进来。
    // 带上窗口标识：多窗口时，A 窗口开着文档、B 窗口回首页，
    // 不能让 B 把 A 的记录清掉。
    try {
      Store.setSetting('lastDocId', doc.id);
      Store.setSetting('lastDocOwner', WINDOW_ID);
      Store.setSetting('lastOpenedAt', Date.now());
    } catch (e) {}
  }

  function openPdf(bytes, name) {
    currentType = 'pdf';
    currentDoc = null;
    const ed = FW.Editors.pdf;
    $('#appBadge').textContent = 'PDF';
    $('#appBadge').className = 'app-badge pdf';
    $('#docTitle').value = (name || 'PDF 文档').replace(/\.pdf$/i, '');
    $('#docTitle').readOnly = true;
    $$('.app-pane').forEach((p) => p.classList.remove('active'));
    $('#pane-pdf').classList.add('active');
    ribbonTab.pdf = 0;
    renderRibbon();
    ed.setChangeHandler(() => markDirty());
    showView('editor');
    ed.mount();
    if (bytes) ed.loadBytes(bytes, name);
    else if (!FW.PDFUtil.getState()) setTimeout(() => ed.cmd('open'), 180);
    setSaveState(true);
    refreshStatus();
  }

  function newDoc(type) {
    if (type === 'pdf') { openPdf(null, 'PDF 文档'); return; }
    const d = FW.createDoc(type);
    if (!Store.upsert(d)) {
      FW.toast('本地存储已满，无法新建文档。请先删除一些旧文档或清空回收站', 4600);
      return;
    }
    openDoc(d);
    updateStorageInfo();
    renderRecent($('#homeSearch').value.trim());
  }

  function useTemplate(key) {
    const d = global.TEMPLATES.use(key);
    if (!d) return;
    updateStorageInfo();
    renderRecent($('#homeSearch').value.trim());
  }

  /* ============================================================
     保存
     ============================================================ */
  function markDirty() {
    dirty = true;
    // PDF 是会话式的，没有「保存到文档库」这回事，只能导出。
    // 原来这里会排一个 1.2 秒后调 save() 的定时器，而 save() 对 pdf 直接
    // 把状态改成「已保存」—— 等于告诉用户「存好了」，其实什么都没存。
    if (currentType === 'pdf') {
      setSaveState(false, '未导出…');
      return;
    }
    setSaveState(false);
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => save(), 1200);
  }

  /* 重新按当前编辑器状态刷新保存指示（PDF 导出成功后由 pdf-workspace 调用） */
  function refreshSaveState() {
    if (currentType === 'pdf') {
      const has = !!(FW.Editors.pdf.hasUnsavedWork && FW.Editors.pdf.hasUnsavedWork());
      setSaveState(!has, '未导出…');
      return;
    }
    setSaveState(!dirty);
  }

  function setSaveState(saved, dirtyText) {
    const el = $('#saveState');
    el.textContent = saved ? '已保存' : (dirtyText || '未保存…');
    el.classList.toggle('dirty', !saved);
  }

  function save(silent) {
    if (currentType === 'pdf') {
      // 别谎报「已保存」：PDF 只能导出
      refreshSaveState();
      dirty = false;
      return;
    }
    if (!currentDoc) return;
    const ed = FW.Editors[currentType];
    if (ed && ed.getData) {
      try {
        currentDoc.data = ed.getData();
      } catch (e) {
        // 取不到最新内容就**千万别写库** —— 否则会把旧内容当成"已保存"覆盖掉，
        // 用户看到「已保存」继续编辑，一刷新就回到上一个版本。
        console.warn('[保存] 从编辑器取内容失败，本次不保存', e);
        dirty = true;
        setSaveState(false);
        return;
      }
    }
    currentDoc.title = $('#docTitle').value.trim() || '未命名';
    // 写失败（本地存储满）时不要谎报「已保存」，也不要再存历史版本占地方
    const ok = Store.upsert(currentDoc);
    if (!ok) {
      dirty = true;
      setSaveState(false);
      return;
    }
    // 自动留存历史版本（内部有 3 分钟节流 + 内容去重）
    try { global.HISTORY.autoSnapshot(currentDoc); } catch (e) { console.warn('[历史版本] 自动快照失败', e); }
    dirty = false;
    setSaveState(true);
    updateStorageInfo();
    renderRecent($('#homeSearch').value.trim());
    if (!silent) FW.toast('已保存到本机');
  }

  /* ============================================================
     状态栏
     ============================================================ */
  function refreshStatus() {
    const ed = FW.Editors[currentType];
    if (!ed) { $('#statusBar').innerHTML = ''; return; }
    let html = '';
    try { html = ed.status ? ed.status() : ''; } catch (e) { html = ''; }
    $('#statusBar').innerHTML = html +
      '<span class="sp"></span><span style="color:#8D949E">ForFree · 本地运行</span>';
  }

  /* ============================================================
     导出
     ============================================================ */
  function openExport() {
    const ed = FW.Editors[currentType];
    if (!ed) return;
    $('#exportTitle').textContent = '导出 / 转换 — ' + (currentDoc ? currentDoc.title : $('#docTitle').value);
    $('#exportBody').innerHTML =
      '<div class="export-group"><h4>选择导出格式</h4>' +
      ed.exports.map((x) =>
        '<button class="export-opt" data-export="' + x.id + '">' +
        '<span class="eo-ico">' + x.icon + '</span>' +
        '<span class="eo-t"><strong>' + FW.escapeHtml(x.title) + '</strong><span>' + FW.escapeHtml(x.desc) + '</span></span></button>').join('') +
      '</div>' +
      '<div class="export-group"><h4>发给朋友</h4>' +
      '<button class="export-opt" data-export="__share"><span class="eo-ico">➤</span>' +
      '<span class="eo-t"><strong>发给朋友</strong><span>拖到微信、导出到电脑、或复制为文本</span></span></button></div>' +
      '<div class="export-group"><h4>更多</h4>' +
      '<button class="export-opt" data-export="__convert"><span class="eo-ico">⇄</span>' +
      '<span class="eo-t"><strong>打开格式转换中心</strong><span>批量转换多个文件，支持 PDF / 图片 / CSV</span></span></button></div>';
    $('#exportMask').classList.add('on');
  }

  async function runExport(id) {
    $('#exportMask').classList.remove('on');
    const ed = FW.Editors[currentType];

    if (id === '__convert') { showConvert(); return; }
    if (id === '__share') { global.SHARE.open(null); return; }

    if (currentType === 'pdf') {
      const map = {
        annot: 'exportAnnotated', raw: 'saveRaw', png: 'exportPng', txt: 'exportText',
        toDocx: 'toDocx', toXlsx: 'toXlsx', compress: 'compress'
      };
      if (map[id]) ed.cmd(map[id]);
      return;
    }

    const doc = currentDoc;
    if (ed && ed.getData) doc.data = ed.getData();
    doc.title = $('#docTitle').value.trim() || '未命名';
    const O = global.OFFICE;

    try {
      if (id === 'json') {
        FW.downloadText(doc.title + '.forfree.json',
          JSON.stringify({ app: 'ForFree', version: 1, type: doc.type, title: doc.title, data: doc.data }, null, 2),
          'application/json');
        FW.toast('已导出工程文件，可再次导入继续编辑');
        return;
      }
      if (id === 'pdf') { FW.toast('正在打开打印窗口，请选择「另存为 PDF」', 3000); setTimeout(() => global.print(), 300); return; }

      if (id === 'docx') {
        if (doc.type !== 'doc') { FW.toast('请用「格式转换中心」进行跨类型转换'); return; }
        FW.downloadBytes(doc.title + '.docx', O.buildDocx(doc), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
        FW.toast('已导出 Word 文档');
        return;
      }
      if (id === 'xlsx') {
        FW.downloadBytes(doc.title + '.xlsx', O.buildXlsx(doc), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        FW.toast('已导出 Excel 工作簿');
        return;
      }
      if (id === 'pptx') {
        FW.downloadBytes(doc.title + '.pptx', O.buildPptx(doc), 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
        FW.toast('已导出 PowerPoint 演示文稿');
        return;
      }
      if (id === 'csv') {
        FW.downloadText(doc.title + '.csv', O.sheetToCsv(doc.data.sheets[0]), 'text/csv');
        FW.toast('已导出 CSV');
        return;
      }
      if (id === 'txt') {
        let t = '';
        if (doc.type === 'doc') t = O.docToText(doc.data.html);
        else if (doc.type === 'sheet') t = O.sheetToCsv(doc.data.sheets[0]).replace(/,/g, '\t');
        else t = doc.data.slides.map((s, i) => '【第 ' + (i + 1) + ' 页】\n' + s.shapes.map((x) => x.text || '').filter(Boolean).join('\n')).join('\n\n');
        FW.downloadText(doc.title + '.txt', t, 'text/plain');
        FW.toast('已导出纯文本');
        return;
      }
      if (id === 'md') {
        let t = '';
        if (doc.type === 'doc') t = O.docToMarkdown(doc.data.html);
        else t = '```\n' + (doc.type === 'sheet' ? O.sheetToCsv(doc.data.sheets[0]) : '') + '\n```';
        FW.downloadText(doc.title + '.md', t, 'text/markdown');
        FW.toast('已导出 Markdown');
        return;
      }
      if (id === 'html') {
        let body = '';
        if (doc.type === 'doc') body = doc.data.html;
        else if (doc.type === 'sheet') body = doc.data.sheets.map((s) => '<h3>' + FW.escapeHtml(s.name) + '</h3>' + O.sheetToHtml(s)).join('');
        else body = '';
        if (doc.type === 'slide') {
          FW.downloadText(doc.title + '.html', O.slideToHtml(doc), 'text/html');
        } else {
          FW.downloadText(doc.title + '.html',
            '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><title>' + FW.escapeHtml(doc.title) + '</title>' +
            '<style>body{font-family:"Microsoft YaHei",sans-serif;max-width:820px;margin:0 auto;padding:44px 28px;line-height:1.8;color:#1F2328}' +
            'table{border-collapse:collapse;width:100%}td,th{border:1px solid #C9CFD6;padding:7px 11px}th{background:#F2F3F5}</style>' +
            '</head><body>' + body + '</body></html>', 'text/html');
        }
        FW.toast('已导出网页');
        return;
      }
      if (id === 'png') {
        if (doc.type !== 'slide') { FW.toast('当前文档不支持导出图片'); return; }
        const idx = parseInt(await FW.prompt('导出第几页为图片？（当前文档共 ' + doc.data.slides.length + ' 页）', '1', { title: '导出图片', type: 'number' }), 10) - 1;
        if (isNaN(idx) || idx < 0 || idx >= doc.data.slides.length) return;
        const blob = await slideToPng(doc, idx);
        FW.downloadBlob(doc.title + '_第' + (idx + 1) + '页.png', blob);
        FW.toast('已导出 PNG 图片');
        return;
      }
    } catch (e) {
      console.error(e);
      FW.toast('导出失败：' + e.message, 3200);
    }
  }

  /* 幻灯片 → PNG（用 Canvas 直接绘制，不依赖第三方库） */
  async function slideToPng(doc, idx) {
    const sl = doc.data.slides[idx];
    const THEMES = global.FW.SlideHelpers.THEMES;
    const T = THEMES[doc.data.theme] || THEMES.fresh;
    const W = doc.data.size.w, H = doc.data.size.h, s = 2;
    const cv = document.createElement('canvas');
    cv.width = W * s; cv.height = H * s;
    const ctx = cv.getContext('2d');
    ctx.scale(s, s);

    // 背景
    const bg = sl.bg || T.bg;
    if (/gradient/i.test(bg)) {
      const cols = bg.match(/#[0-9a-fA-F]{3,8}/g) || ['#ffffff', '#eeeeee'];
      const g = ctx.createLinearGradient(0, 0, W, H);
      cols.forEach((c, i) => g.addColorStop(i / Math.max(1, cols.length - 1), c));
      ctx.fillStyle = g;
    } else ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    for (const sh of sl.shapes) {
      if (sh.type === 'text') {
        ctx.save();
        const fs = sh.size || 18;
        ctx.font = (sh.italic ? 'italic ' : '') + (sh.bold ? 'bold ' : '') + fs + 'px "Microsoft YaHei","PingFang SC",sans-serif';
        ctx.fillStyle = sh.color || '#1F2328';
        ctx.textBaseline = 'top';
        const lines = String(sh.text || '').split('\n');
        const lh = fs * 1.35;
        const totalH = lines.length * lh;
        let y0 = sh.y;
        if (sh.valign === 'middle') y0 = sh.y + (sh.h - totalH) / 2;
        else if (sh.valign === 'bottom') y0 = sh.y + sh.h - totalH;
        ctx.textAlign = sh.align === 'center' ? 'center' : sh.align === 'right' ? 'right' : 'left';
        const x = sh.align === 'center' ? sh.x + sh.w / 2 : sh.align === 'right' ? sh.x + sh.w : sh.x;
        lines.forEach((ln, i) => ctx.fillText(ln, x, y0 + i * lh + (lh - fs) / 2));
        ctx.restore();
      } else if (sh.type === 'rect' || sh.type === 'line') {
        if (sh.fill) { ctx.fillStyle = sh.fill; ctx.fillRect(sh.x, sh.y, sh.w, sh.type === 'line' ? Math.max(1, sh.h) : sh.h); }
        if (sh.line) { ctx.strokeStyle = sh.line; ctx.lineWidth = sh.lineW || 2; ctx.strokeRect(sh.x, sh.y, sh.w, sh.h); }
      } else if (sh.type === 'ellipse') {
        ctx.beginPath();
        ctx.ellipse(sh.x + sh.w / 2, sh.y + sh.h / 2, sh.w / 2, sh.h / 2, 0, 0, Math.PI * 2);
        if (sh.fill) { ctx.fillStyle = sh.fill; ctx.fill(); }
        if (sh.line) { ctx.strokeStyle = sh.line; ctx.lineWidth = sh.lineW || 2; ctx.stroke(); }
      } else if (sh.type === 'triangle') {
        ctx.beginPath();
        ctx.moveTo(sh.x + sh.w / 2, sh.y);
        ctx.lineTo(sh.x + sh.w, sh.y + sh.h);
        ctx.lineTo(sh.x, sh.y + sh.h);
        ctx.closePath();
        if (sh.fill) { ctx.fillStyle = sh.fill; ctx.fill(); }
        if (sh.line) { ctx.strokeStyle = sh.line; ctx.lineWidth = sh.lineW || 2; ctx.stroke(); }
      } else if (sh.type === 'star') {
        const cx = sh.x + sh.w / 2, cy = sh.y + sh.h / 2, R = Math.min(sh.w, sh.h) / 2, r = R * 0.42;
        ctx.beginPath();
        for (let i = 0; i < 10; i++) {
          const ang = -Math.PI / 2 + i * Math.PI / 5;
          const rad = i % 2 ? r : R;
          const px = cx + rad * Math.cos(ang), py = cy + rad * Math.sin(ang);
          i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
        }
        ctx.closePath();
        if (sh.fill) { ctx.fillStyle = sh.fill; ctx.fill(); }
      } else if (sh.type === 'image' && sh.src) {
        await new Promise((res) => {
          const im = new Image();
          im.onload = () => { ctx.drawImage(im, sh.x, sh.y, sh.w, sh.h); res(); };
          im.onerror = () => res();
          im.src = sh.src;
        });
      }
    }
    return await new Promise((res) => cv.toBlob(res, 'image/png'));
  }

  /* ============================================================
     转换中心
     ============================================================ */
  function showConvert() {
    showView('convert');
  }

  /* ============================================================
     事件绑定
     ============================================================ */
  function bind() {
    // 首页
    $$('.new-card').forEach((b) => b.addEventListener('click', () => newDoc(b.dataset.new)));
    $('#tplGrid').addEventListener('click', (e) => {
      const c = e.target.closest('.tpl-card');
      if (c) useTemplate(c.dataset.tpl);
    });
    $('#recentFilter').addEventListener('click', (e) => {
      const b = e.target.closest('[data-rt]');
      if (!b || b.disabled) return;
      recentType = b.dataset.rt;
      renderRecent($('#homeSearch').value.trim());
    });

    $('#recentList').addEventListener('click', async (e) => {
      const item = e.target.closest('.recent-item');
      const btn = e.target.closest('button');
      if (!item) return;
      const id = item.dataset.id;
      const d = Store.get(id);
      if (!d) return;
      if (!btn) { openDoc(d); return; }
      const act = btn.dataset.act;
      if (act === 'open') openDoc(d);
      else if (act === 'copy') { const c = Store.duplicate(id); if (c) { FW.toast('已创建副本'); renderRecent($('#homeSearch').value.trim()); updateStorageInfo(); } }
      else if (act === 'rename') {
        const n = await FW.prompt('重命名：', d.title, { title: '重命名文档' });
        if (n && n.trim()) { d.title = n.trim(); Store.upsert(d); renderRecent($('#homeSearch').value.trim()); if (currentDoc && currentDoc.id === id) $('#docTitle').value = d.title; }
      } else if (act === 'del') {
        if (await FW.confirm('确定删除「' + d.title + '」？\n文档会移到回收站，可以随时还原。', { title: '删除文档', okText: '移入回收站' })) {
          Store.trashDoc(id);
          renderRecent($('#homeSearch').value.trim());
          updateStorageInfo();
          global.TRASH.updateBadge();
          FW.toast('已移入回收站');
        }
      } else if (act === 'history') {
        global.HISTORY.openPanel(id);
      } else if (act === 'share') {
        global.SHARE.open(id);
      } else if (act === 'newwin') {
        openInNewWindow(id);
      } else if (act === 'diff') {
        global.DIFF.open({ leftKey: 'd:' + id });
      }
    });
    $('#homeSearch').addEventListener('input', () => renderRecent($('#homeSearch').value.trim()));

    $('#btnOpenFile').addEventListener('click', openAnyFile);
    $('#btnConvert').addEventListener('click', showConvert);
    $('#btnAbout').addEventListener('click', () => {
      const hasBridge = !!(global.forfree && global.forfree.isDesktop);
      const b = $('#btnAppFolder');
      if (b) b.style.display = hasBridge ? 'inline-block' : 'none';
      const sc = $('#btnShortcut');
      if (sc) sc.style.display = hasBridge ? 'inline-block' : 'none';
      const h = $('#appFolderHint');
      if (h) h.textContent = hasBridge ? '把整个文件夹拷给别人，对方双击 exe 就能用' : '';
      // AGPL 第 5 条要求分发物带有显著声明：桌面版内置 MuPDF（AGPL-3.0），
      // 因此桌面版整体以 AGPL-3.0 发布；网页版不含 MuPDF，仍是 MIT。
      const lic = $('#aboutLicense');
      if (lic) {
        lic.textContent = hasBridge
          ? '桌面版内置 MuPDF（AGPL-3.0），因此桌面版整体按 AGPL-3.0-or-later 发布；完整源码见项目仓库。网页版不含 MuPDF，仍为 MIT 许可证。'
          : '本软件为 MIT 许可证，可自由使用、修改、分发。';
      }
      const cb = $('#setAutoOpen');
      if (cb) cb.checked = Store.settings().autoOpenLast !== false;
      $('#aboutMask').classList.add('on');
    });
    $('#setAutoOpen').addEventListener('change', (e) => {
      Store.setSetting('autoOpenLast', e.target.checked);
      FW.toast(e.target.checked ? '下次启动会自动回到上次编辑的文档' : '下次启动会停在首页');
    });

    /* 整库备份 / 恢复：文档只在本机 localStorage，清浏览器数据就全丢 */
    $('#btnBackup').addEventListener('click', () => {
      try {
        const data = Store.exportAll();
        const json = JSON.stringify(data);
        const d = new Date();
        const stamp = d.getFullYear() + '-' +
          String(d.getMonth() + 1).padStart(2, '0') + '-' +
          String(d.getDate()).padStart(2, '0');
        FW.downloadText('ForFree备份_' + stamp + '.json', json, 'application/json');
        FW.toast('已导出 ' + data.docs.length + ' 篇文档、回收站 ' + data.trash.length +
          ' 项、历史版本 ' + Object.keys(data.versions).length + ' 组（' + FW.fmtSize(json.length * 2) + '）', 5000);
      } catch (e) {
        FW.toast('备份失败：' + (e && e.message ? e.message : e), 4200);
      }
    });

    $('#btnRestore').addEventListener('click', async () => {
      const f = await FW.pickFile('.json,application/json');
      if (!f) return;
      let obj = null;
      try {
        const text = (await FW.readAsText(f)).replace(/^\uFEFF/, '');
        obj = JSON.parse(text);
      } catch (e) {
        FW.toast('这个文件不是合法的 JSON：' + (e && e.message ? e.message : e), 4500);
        return;
      }
      if (!obj || obj.kind !== 'backup' || obj.app !== 'forfree') {
        FW.toast('这不是 ForFree 的备份文件', 4200);
        return;
      }
      const ok = await FW.confirm(
        '备份里有 ' + obj.docs.length + ' 篇文档（导出于 ' + FW.fmtTime(obj.exportedAt) + '）。\n\n' +
        '会按「合并」方式导入：同 ID 的文档保留较新的那一份，现有文档不会被删除。',
        { title: '从备份恢复', okText: '合并导入' });
      if (!ok) return;
      const r = Store.importAll(obj, 'merge');
      if (!r.ok) { FW.toast('恢复失败：' + r.error, 5000); return; }
      renderRecent($('#homeSearch').value.trim());
      updateStorageInfo();
      if (global.TRASH && global.TRASH.updateBadge) global.TRASH.updateBadge();
      FW.toast('已导入：新增 ' + r.added + ' 篇，现在共 ' + r.total + ' 篇文档', 4500);
    });
    $('#btnAppFolder').addEventListener('click', async () => {
      if (!(global.forfree && global.forfree.openAppFolder)) return;
      const r = await global.forfree.openAppFolder();
      if (r && r.ok) FW.toast('已打开：' + r.path, 4000);
      else FW.toast('打开失败' + (r && r.error ? '：' + r.error : ''), 3600);
    });
    $('#btnShortcut').addEventListener('click', async () => {
      if (!(global.forfree && global.forfree.createDesktopShortcut)) return;
      const r = await global.forfree.createDesktopShortcut();
      if (r && r.ok) {
        FW.toast((r.updated ? '已更新桌面快捷方式' : '已在桌面创建快捷方式') + '：' + r.path, 5000);
      } else {
        FW.toast('创建失败' + (r && r.error ? '：' + r.error : ''), 5200);
      }
    });
    $('#btnDiff').addEventListener('click', () => global.DIFF.open());
    $('#btnTrash').addEventListener('click', () => global.TRASH.open());
    $('#btnImage').addEventListener('click', () => global.IMGTOOLS.open());

    $('#tplFilter').addEventListener('click', (e) => {
      const b = e.target.closest('.tpl-tab');
      if (!b) return;
      tplFilter = b.dataset.cat;
      renderTplFilter();
      renderTemplates();
    });

    // 编辑器
    $('#btnHome').addEventListener('click', goHome);
    $('#btnHome2').addEventListener('click', goHome);
    $('#btnHome3').addEventListener('click', goHome);
    $('#btnHome4').addEventListener('click', goHome);
    $('#btnHome5').addEventListener('click', goHome);
    $('#docTitle').addEventListener('input', markDirty);
    $('#docTitle').addEventListener('blur', () => { if (dirty) save(true); });
    $$('[data-qa]').forEach((b) => b.addEventListener('click', () => {
      const a = b.dataset.qa;
      const ed = FW.Editors[currentType];
      if (a === 'save') save();
      else if (a === 'undo') ed && ed.undo();
      else if (a === 'redo') ed && ed.redo();
      else if (a === 'history') global.HISTORY.openPanel(currentDoc ? currentDoc.id : null);
      else if (a === 'share') global.SHARE.open(null);
      else if (a === 'newwin') openInNewWindow(null);
      else if (a === 'export') openExport();
    }));
    $('#btnFullscreen').addEventListener('click', () => {
      if (!document.fullscreenElement) document.documentElement.requestFullscreen().catch(() => {});
      else document.exitFullscreen();
    });

    // 弹窗关闭
    $$('[data-close]').forEach((b) => b.addEventListener('click', () => {
      b.closest('.modal-mask').classList.remove('on');
    }));
    $$('.modal-mask').forEach((m) => m.addEventListener('click', (e) => { if (e.target === m) m.classList.remove('on'); }));
    $('#exportBody').addEventListener('click', (e) => {
      const b = e.target.closest('[data-export]');
      if (b) runExport(b.dataset.export);
    });

    // 全局快捷键
    document.addEventListener('keydown', (e) => {
      const ctrl = e.ctrlKey || e.metaKey;
      if (ctrl && e.key.toLowerCase() === 's') {
        e.preventDefault();
        if ($('#view-editor').classList.contains('active')) save();
        return;
      }
      if (e.key === 'Escape') {
        $$('.modal-mask.on').forEach((m) => m.classList.remove('on'));
      }
      if (ctrl && (e.key === 'z' || e.key === 'Z' || e.key === 'y' || e.key === 'Y')) {
        if (currentType === 'sheet' || currentType === 'slide' || currentType === 'pdf') {
          const ed = FW.Editors[currentType];
          if (ed) {
            e.preventDefault();
            // Ctrl+Shift+Z 也按重做处理（很多人的习惯）
            const isRedo = e.key === 'y' || e.key === 'Y' || (e.shiftKey && (e.key === 'z' || e.key === 'Z'));
            if (isRedo) ed.redo(); else ed.undo();
          }
        }
      }
    });

    window.addEventListener('beforeunload', (e) => {
      if (dirty) { save(true); }
      // PDF 的编辑只存在于内存里，关窗口同样会丢。
      // 注意：Electron 里光靠 returnValue 只会让窗口关不掉、且不给任何提示，
      // 必须在主进程配 will-prevent-unload 弹原生对话框（见 desktop/main.js）。
      if (currentType === 'pdf' && FW.Editors.pdf.hasUnsavedWork && FW.Editors.pdf.hasUnsavedWork()) {
        e.preventDefault();
        e.returnValue = '';
      }
    });
  }

  async function goHome() {
    // PDF 是会话式的：编辑结果不进文档库。原来这里对 pdf 直接跳过保存，
    // 点「返回首页」等于把批注 / 页面调整 / 文字修改全部静默丢弃。
    if (currentType === 'pdf' && FW.Editors.pdf.hasUnsavedWork && FW.Editors.pdf.hasUnsavedWork()) {
      const leave = await FW.confirm(
        '当前 PDF 的编辑（批注、页面调整、文字修改）不会保存到文档库，返回首页后会丢失。\n\n要保留的话请先点「导出」把 PDF 存下来。',
        { title: 'PDF 编辑尚未导出', okText: '放弃编辑并返回', cancelText: '返回继续编辑' });
      if (!leave) return;
    }
    if (currentType && FW.Editors[currentType] && FW.Editors[currentType].unmount) {
      try { FW.Editors[currentType].unmount(); } catch (e) { console.warn('[编辑器] 卸载失败，可能残留状态', e); }
    }
    if (dirty && currentType !== 'pdf') save(true);
    currentType = null; currentDoc = null;
    // 只有「是我这个窗口设的记录」才清 —— 否则多窗口下会误清别的窗口的记录
    try {
      const s = Store.settings();
      if (!s.lastDocOwner || s.lastDocOwner === WINDOW_ID) {
        Store.setSetting('lastDocId', null);
        Store.setSetting('lastDocOwner', null);
      }
    } catch (e) {}
    $$('.app-pane').forEach((p) => p.classList.remove('active'));
    renderRecent($('#homeSearch').value.trim());
    updateStorageInfo();
    showView('home');
  }

  /** 启动时恢复上次编辑的文档 */
  function restoreLastDoc() {
    // 先看 URL 上有没有指定文档（多窗口打开时会带 ?doc=xxx）
    let urlDoc = null;
    try { urlDoc = new URLSearchParams(location.search).get('doc'); } catch (e) {}
    if (urlDoc) {
      const d0 = Store.get(urlDoc);
      if (d0) { openDoc(d0); return; }
    }

    let s;
    try { s = Store.settings(); } catch (e) { return; }
    if (s.autoOpenLast === false) return;      // 用户在「关于」里关掉了
    const id = s.lastDocId;
    if (!id) return;
    const d = Store.get(id);
    if (!d) { try { Store.setSetting('lastDocId', null); } catch (e) {} return; }
    openDoc(d);
    FW.toast('已恢复上次编辑的文档', 2400);
  }

  /** 在另一个窗口打开指定文档 */
  async function openInNewWindow(id) {
    if (global.forfree && global.forfree.openInNewWindow) {
      const r = await global.forfree.openInNewWindow(id);
      if (r && r.ok) { FW.toast('已在新窗口打开'); return; }
      FW.toast('新窗口打开失败' + (r && r.error ? '：' + r.error : ''), 3200);
      return;
    }
    // 网页版：开一个新标签页
    try {
      const url = location.pathname + '?doc=' + encodeURIComponent(id);
      const w = global.open(url, '_blank');
      if (!w) FW.toast('浏览器拦截了新标签页，请允许弹出窗口');
    } catch (e) {
      FW.toast('新窗口打开失败：' + e.message, 3200);
    }
  }

  async function openAnyFile() {
    const files = await FW.pickFile('', true);
    if (!files || !files.length) return;
    const list = Array.prototype.slice.call(files);
    // 图片批量 → 直接合成 PDF
    const kinds = list.map((f) => global.CONVERT.kindOf(f));
    if (kinds.every((k) => k === 'image')) {
      FW.toast('正在生成 PDF……', 4000);
      try {
        const bytes = await global.CONVERT.imagesToPdf(list);
        FW.downloadBytes('图片合集.pdf', bytes, 'application/pdf');
        FW.toast('已生成 PDF（' + list.length + ' 页）');
      } catch (e) { FW.toast('生成失败：' + e.message); }
      return;
    }
    if (kinds.every((k) => k === 'pdf') && list.length > 1) {
      FW.toast('正在合并 PDF……', 4000);
      try {
        const r = await global.CONVERT.mergePdfs(list);
        FW.downloadBytes('合并文档.pdf', r.bytes, 'application/pdf');
        FW.toast('已合并 ' + list.length + ' 个 PDF，共 ' + r.pages + ' 页');
      } catch (e) { FW.toast('合并失败：' + e.message); }
      return;
    }
    // 单个文件
    const f = list[0];
    const kind = global.CONVERT.kindOf(f);
    if (kind === 'pdf') {
      const bytes = await FW.readAsArrayBuffer(f);
      openPdf(bytes, f.name);
      return;
    }
    if (['docx', 'xlsx', 'pptx', 'csv', 'txt', 'md', 'html', 'json'].indexOf(kind) >= 0) {
      FW.toast('正在读取 ' + f.name + ' …', 3000);
      try {
        const doc = await global.CONVERT.readAsDoc(f);
        doc.id = FW.uid();
        Store.upsert(doc);
        openDoc(doc);
        updateStorageInfo();
        FW.toast('已打开：' + doc.title);
      } catch (e) {
        FW.toast('打开失败：' + e.message, 3200);
      }
      return;
    }
    if (list.length > 1) { showConvert(); global.CONVERT.addFiles(list); return; }
    FW.toast('无法识别的文件格式，已转到转换中心');
    showConvert();
    global.CONVERT.addFiles(list);
  }

  /* ============================================================
     初始化
     ============================================================ */
  function init() {
    renderTplFilter();
    renderTemplates();
    renderRecent('');
    updateStorageInfo();
    global.TRASH.updateBadge();
    bind();
    bindRibbon();
    global.CONVERT.bind();
    global.FW.Editors.pdf.mount = global.FW.Editors.pdf.mount; // 保持引用

    // 空状态提示
    if (!Store.list().length) {
      const demo = FW.createDoc('doc');
      demo.title = '欢迎使用 ForFree';
      demo.data.html =
        '<h1 style="text-align:center">欢迎使用 ForFree</h1>' +
        '<p style="text-align:center;color:#6B7280">一个完全免费、离线可用的网页版办公套件</p>' +
        '<h2>你可以做什么</h2>' +
        '<ul><li><strong>文字文档</strong>：富文本排版，可导出真实的 .docx 文件</li>' +
        '<li><strong>电子表格</strong>：内置公式引擎（SUM / AVERAGE / IF / VLOOKUP 等），可导出 .xlsx</li>' +
        '<li><strong>演示文稿</strong>：版式、主题、动画、放映，可导出 .pptx</li>' +
        '<li><strong>PDF 工作台</strong>：阅读、批注、高亮、画笔、水印、页面管理、合并拆分</li>' +
        '<li><strong>格式转换中心</strong>：docx / xlsx / pptx / pdf / csv / txt / md / html / 图片 互转</li></ul>' +
        '<h2>开始使用</h2>' +
        '<p>点击左上角返回首页，选择「新建」或「模板」；也可以点击「打开文件」读取你电脑上已有的 Office 文档，编辑后再导出回去。</p>' +
        '<blockquote>所有数据都保存在你本机浏览器中，不联网、不上传。</blockquote>';
      Store.upsert(demo);
      renderRecent('');
      updateStorageInfo();
    }

    // 恢复上次编辑的文档（可在「关于」里关掉）
    setTimeout(restoreLastDoc, 60);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  app.openDoc = openDoc;
  app.openPdf = openPdf;
  app.newDoc = newDoc;
  app.save = save;
  app.openExport = openExport;
  app.showConvert = showConvert;
  app.showView = showView;
  app.currentDoc = () => currentDoc;
  app.refreshHome = () => {
    renderRecent($('#homeSearch').value.trim());
    updateStorageInfo();
    global.TRASH.updateBadge();
  };
  app.refreshStatus = refreshStatus;
  app.refreshSaveState = refreshSaveState;
  app.restoreLastDoc = restoreLastDoc;
  app.openInNewWindow = openInNewWindow;
})(window);
