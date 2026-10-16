/* ============================================================
   pdf-workspace.js — PDF 阅读与编辑工作台
   读取渲染：pdf.js    写入导出：pdf-lib
   ============================================================ */
(function (global) {
  'use strict';
  const FW = global.FW, $ = FW.$, $$ = FW.$$;
  const uid = FW.uid;

  const pdfjs = global.pdfjsLib;
  if (pdfjs) {
    pdfjs.GlobalWorkerOptions.workerSrc = 'assets/vendor/pdf.worker.min.js';
  }

  const TOOL_LABEL = {
    select: '选择 / 滚动', hand: '抓手', text: '文本批注', highlight: '高亮标记',
    rect: '矩形框', ellipse: '椭圆圈', arrow: '箭头', ink: '自由画笔', eraser: '橡皮擦', image: '图片图章'
  };

  let state = null;      // 当前 PDF 会话
  let tool = 'select';
  let scale = 1.25;
  let toolColor = '#F5B301';
  let toolSize = 16;
  let onChange = null;
  let undoStack = [];
  let renderToken = 0;
  let bound = false;

  const srcCache = {};   // sourceIdx -> {doc, bytes}

  function emit() { if (onChange) onChange(); }

  /* ============================================================
     打开 / 载入
     ============================================================ */
  async function loadBytes(bytes, name) {
    if (!pdfjs) { FW.toast('PDF 引擎未加载'); return; }
    try {
      // 换文件时必须把上一次的缓存全部清掉，
      // 否则 getPdfLibDoc(0) 会返回上一个 PDF 的文档对象，
      // 导致表单检测、批注导出、提取页面全部作用在错误的文件上。
      Object.keys(srcCache).forEach((k) => delete srcCache[k]);
      Object.keys(pdfLibCache).forEach((k) => delete pdfLibCache[k]);
      renderToken++;

      const src = { bytes: bytes, name: name || 'PDF 文档' };
      const doc = await pdfjs.getDocument({ data: bytes.slice(), cMapPacked: true }).promise;
      state = {
        title: (name || 'PDF 文档').replace(/\.pdf$/i, ''),
        sources: [src],
        pages: [],
        annots: [],
        fileBytes: bytes
      };
      srcCache[0] = { doc: doc, bytes: bytes };
      for (let i = 0; i < doc.numPages; i++) state.pages.push({ pid: uid(), src: 0, idx: i, rot: 0 });
      state.formMode = false;
      state.formFields = [];
      state.formValues = {};
      scale = 1.25;

      // 探测表单字段（有 AcroForm 才能填写）
      try {
        const libDoc = await getPdfLibDoc(0);
        state.formFields = global.PDFTOOLS ? global.PDFTOOLS.readFields(libDoc) : [];
        state.formFields.forEach((f) => { state.formValues[f.name] = f.value; });
      } catch (e) { state.formFields = []; }

      render();
      const extra = state.formFields.length ? '，检测到 ' + state.formFields.length + ' 个表单字段' : '';
      FW.toast('已打开：' + state.title + '（' + state.pages.length + ' 页）' + extra, 3000);
    } catch (e) {
      console.error(e);
      FW.toast('打开失败：' + (e && e.message ? e.message : '文件可能已加密或损坏'), 3200);
    }
  }

  async function openPdf() {
    const f = await FW.pickFile('application/pdf,.pdf');
    if (!f) return;
    const bytes = await FW.readAsArrayBuffer(f);
    await loadBytes(bytes, f.name);
  }

  async function addSource(bytes) {
    const idx = state.sources.length;
    const doc = await pdfjs.getDocument({ data: bytes.slice() }).promise;
    state.sources.push({ bytes: bytes, name: 'merged' });
    srcCache[idx] = { doc: doc, bytes: bytes };
    return { idx: idx, count: doc.numPages };
  }

  async function mergePdf() {
    if (!state) { FW.toast('请先打开一个 PDF'); return; }
    const files = await FW.pickFile('application/pdf,.pdf', true);
    if (!files || !files.length) return;
    for (const f of files) {
      const bytes = await FW.readAsArrayBuffer(f);
      const info = await addSource(bytes);
      for (let i = 0; i < info.count; i++) state.pages.push({ pid: uid(), src: info.idx, idx: i, rot: 0 });
    }
    render(); emit();
    FW.toast('已合并 ' + files.length + ' 个 PDF');
  }

  /* ============================================================
     渲染
     ============================================================ */
  async function render() {
    const box = $('#pdfPages');
    if (!state) {
      box.innerHTML = '<div class="pdf-empty"><div class="pdf-empty-ico">PDF</div>' +
        '<h3>打开一个 PDF 文件开始工作</h3>' +
        '<p>可以阅读、翻页、选中文字，也可以添加批注、高亮、画笔、水印，<br>还能删除/旋转/重排页面、合并拆分、导出带批注的新 PDF。</p>' +
        '<button class="primary-btn" id="pdfOpenBig">打开 PDF 文件</button></div>';
      const b = $('#pdfOpenBig');
      if (b) b.addEventListener('click', openPdf);
      renderThumbs();
      if (global.FW.app) global.FW.app.refreshStatus();
      return;
    }
    const token = ++renderToken;
    box.innerHTML = state.pages.map((p, i) => {
      const dim = pageBoxSize(p);
      return '<div class="pdf-page" data-pi="' + i + '" data-pid="' + p.pid + '" style="width:' + dim.w + 'px;height:' + dim.h + 'px">' +
        '<canvas></canvas><div class="textLayer"></div><div class="annotLayer" data-pid="' + p.pid + '"></div>' +
        '<div class="formLayer" data-pi="' + i + '"></div>' +
        '<span class="pdf-page-no">' + (i + 1) + '</span></div>';
    }).join('');
    renderThumbs();
    paintAnnots();
    renderFormBar();
    if (state.formMode) paintForms();
    if (global.FW.app) global.FW.app.refreshStatus();
    // 逐页渲染（进入视口才画）
    for (let i = 0; i < state.pages.length; i++) {
      if (token !== renderToken) return;
      await renderPage(i, token);
    }
  }

  /* ---------- 表单栏 ---------- */
  function renderFormBar() {
    const main = document.querySelector('.pdf-main');
    if (!main) return;
    let bar = main.querySelector('.form-bar');
    if (!state || !state.formMode) { if (bar) bar.remove(); return; }
    if (!bar) {
      bar = document.createElement('div');
      bar.className = 'form-bar';
      main.insertBefore(bar, main.firstChild);
    }
    const n = state.formFields.length;
    const filled = state.formFields.filter((f) => {
      const v = state.formValues[f.name];
      return v !== '' && v !== false && v != null;
    }).length;
    bar.innerHTML =
      '<span>表单填写模式：共 <b>' + n + '</b> 个字段，已填 <b>' + filled + '</b> 个</span>' +
      '<span class="sp"></span>' +
      '<button id="formFlatten">导出并扁平化</button>' +
      '<button class="primary" id="formExport">导出 PDF</button>' +
      '<button id="formExit">退出填写</button>';
    bar.querySelector('#formExport').addEventListener('click', () => exportForm(false));
    bar.querySelector('#formFlatten').addEventListener('click', () => exportForm(true));
    bar.querySelector('#formExit').addEventListener('click', () => toggleFormMode(false));
  }

  /* ---------- 表单字段叠加层 ---------- */
  async function paintForms() {
    if (!state || !state.formMode || !state.formFields.length) return;
    const box = $('#pdfPages');
    box.classList.add('form-mode');

    for (let i = 0; i < state.pages.length; i++) {
      const p = state.pages[i];
      const rec = srcCache[p.src];
      if (!rec) continue;
      const host = box.querySelector('.pdf-page[data-pi="' + i + '"]');
      if (!host) continue;
      const layer = host.querySelector('.formLayer');
      if (!layer) continue;
      layer.innerHTML = '';

      // 这一页上的字段（field.page 是 pdf-lib 文档里的原始页号）
      const mine = state.formFields.filter((f) => f.page === p.idx && p.src === 0);
      if (!mine.length) continue;

      const rot = (rec.sizes[p.idx].rot + p.rot) % 360;
      const pg = await rec.doc.getPage(p.idx + 1);
      const vp = pg.getViewport({ scale: scale, rotation: rot });

      mine.forEach((f) => {
        const r = f.rect;
        // PDF 坐标（原点左下）→ 视口坐标（原点左上）
        const tl = vp.convertToViewportPoint(r.x, r.y + r.height);
        const br = vp.convertToViewportPoint(r.x + r.width, r.y);
        const left = Math.min(tl[0], br[0]);
        const top = Math.min(tl[1], br[1]);
        const w = Math.abs(br[0] - tl[0]);
        const h = Math.abs(br[1] - tl[1]);

        let el;
        if (f.type === 'checkbox') {
          el = document.createElement('input');
          el.type = 'checkbox';
        } else if (f.type === 'dropdown' || f.type === 'optionlist') {
          el = document.createElement('select');
          const blank = document.createElement('option');
          blank.value = '';
          blank.textContent = '—';
          el.appendChild(blank);
          f.options.forEach((o) => {
            const op = document.createElement('option');
            op.value = o;
            op.textContent = o;
            el.appendChild(op);
          });
        } else if (f.type === 'radio') {
          el = document.createElement('input');
          el.type = 'radio';
          el.name = 'fwradio_' + f.name;
          el.value = f.options[0] || '';
        } else {
          el = document.createElement('input');
          el.type = 'text';
          if (f.multiline) {
            el = document.createElement('textarea');
          }
        }

        el.className = 'formField' + (f.readOnly ? ' is-readonly' : '');
        el.style.left = left + 'px';
        el.style.top = top + 'px';
        el.style.width = Math.max(16, w) + 'px';
        el.style.height = Math.max(14, h) + 'px';
        if (f.readOnly) el.disabled = true;
        el.title = f.name + '（' + f.type + '）';

        if (f.type === 'checkbox') {
          el.checked = state.formValues[f.name] === 'on' || state.formValues[f.name] === true;
        } else if (f.type === 'radio') {
          el.checked = state.formValues[f.name] === el.value;
        } else {
          el.value = state.formValues[f.name] || '';
        }
        if (el.value || el.checked) el.classList.add('is-filled');

        const commit = () => {
          if (f.type === 'checkbox') state.formValues[f.name] = el.checked;
          else state.formValues[f.name] = el.value;
          el.classList.toggle('is-filled', f.type === 'checkbox' ? el.checked : !!el.value);
          renderFormBar();
        };
        el.addEventListener('input', commit);
        el.addEventListener('change', commit);
        layer.appendChild(el);
      });
    }
  }

  function toggleFormMode(force) {
    if (!state) { FW.toast('请先打开一个 PDF'); return; }
    const want = force === undefined ? !state.formMode : !!force;
    if (want && !state.formFields.length) {
      FW.toast('这个 PDF 里没有可填写的表单字段', 3000);
      return;
    }
    state.formMode = want;
    if (!want) {
      const box = $('#pdfPages');
      if (box) box.classList.remove('form-mode');
      $$('.formLayer').forEach((l) => { l.innerHTML = ''; });
    }
    renderFormBar();
    if (want) {
      paintForms();
      FW.toast('已进入表单填写模式，直接在页面上填写后点「导出 PDF」', 3200);
    } else {
      FW.toast('已退出表单填写模式');
    }
  }

  async function exportForm(flatten) {
    if (!state) return;
    if (!state.formFields.length) { FW.toast('没有表单字段'); return; }
    FW.toast('正在生成 PDF……', 3000);
    try {
      // 用干净的副本写入，避免污染缓存里的文档
      const fresh = await PDFLib.PDFDocument.load(state.sources[0].bytes, { ignoreEncryption: true });
      const r = await global.PDFTOOLS.fillAndSave(fresh, state.formValues, flatten);
      const suffix = flatten ? (r.flattened ? '_已填写_扁平化.pdf' : '_已填写.pdf') : '_已填写.pdf';
      FW.downloadBytes(state.title + suffix, r.bytes, 'application/pdf');
      if (flatten && !r.flattened) {
        FW.toast('已导出 ' + r.applied.length + ' 个字段。注意：扁平化未成功，已按普通填写导出，接收方仍可编辑。', 6000);
      } else if (flatten && r.flattened && r.flattenError) {
        FW.toast('已导出并扁平化 ' + r.applied.length + ' 个字段。字段值含中文，已改用图像化方式扁平化（接收方不可编辑，但该部分文字不可再选中）。', 6000);
      } else {
        FW.toast('已导出，写入 ' + r.applied.length + ' 个字段' + (r.flattened ? '（已扁平化，不可再编辑）' : ''), 3400);
      }
    } catch (e) {
      console.error(e);
      FW.toast('导出失败：' + e.message, 3600);
    }
  }

  /* ---------- 压缩 ---------- */
  function compressDialog() {
    if (!state) { FW.toast('请先打开一个 PDF'); return; }
    if (!global.PDFTOOLS) { FW.toast('压缩模块未加载'); return; }
    const P = global.PDFTOOLS.PRESETS;
    let m = document.getElementById('pdfCompressMask');
    if (!m) {
      m = document.createElement('div');
      m.className = 'modal-mask';
      m.id = 'pdfCompressMask';
      document.body.appendChild(m);
      m.addEventListener('click', (e) => { if (e.target === m) m.classList.remove('on'); });
    }
    const before = state.sources[0].bytes.length;
    m.innerHTML =
      '<div class="modal"><div class="modal-head"><h3>压缩 PDF</h3>' +
      '<button class="modal-x" data-cc-close>×</button></div>' +
      '<div class="modal-body">' +
      '<p class="muted" style="margin-bottom:14px">当前文件 <b>' + FW.fmtSize(before) + '</b>，共 ' + state.pages.length + ' 页。' +
      '压缩会把每页重新渲染成图片再重建 PDF —— 对扫描件、图片型 PDF 效果最明显；纯文字 PDF 会因此变成图片（不可再选中文字）。</p>' +
      '<div class="export-group">' +
      Object.keys(P).map((k) =>
        '<button class="export-opt" data-cc="' + k + '">' +
        '<span class="eo-ico">' + (k === 'extreme' ? 'S' : k === 'high' ? 'M' : k === 'balanced' ? 'B' : 'L') + '</span>' +
        '<span class="eo-t"><strong>' + P[k].name + '（' + P[k].dpi + ' DPI · 画质 ' + Math.round(P[k].quality * 100) + '%）</strong>' +
        '<span>' + P[k].desc + '</span></span></button>').join('') +
      '</div></div></div>';
    m.querySelector('[data-cc-close]').addEventListener('click', () => m.classList.remove('on'));
    m.querySelectorAll('[data-cc]').forEach((b) => {
      b.addEventListener('click', async () => {
        m.classList.remove('on');
        await doCompress(b.dataset.cc);
      });
    });
    m.classList.add('on');
  }

  async function doCompress(preset) {
    const before = state.sources[0].bytes.length;
    FW.toast('正在压缩，请稍候……', 60000);
    try {
      const rec = srcCache[0];
      const r = await global.PDFTOOLS.compress(rec.doc, preset, (i, n) => {
        if (i === n || i % 3 === 0) FW.toast('正在压缩第 ' + i + '/' + n + ' 页…', 1200);
      });
      const after = r.bytes.length;
      const ratio = Math.round((1 - after / before) * 100);
      const name = state.title + '_压缩.pdf';
      if (after >= before) {
        FW.toast('压缩后反而变大了（' + FW.fmtSize(before) + ' → ' + FW.fmtSize(after) + '），已保留原文件', 4000);
        return;
      }
      FW.downloadBytes(name, r.bytes, 'application/pdf');
      FW.toast('压缩完成：' + FW.fmtSize(before) + ' → ' + FW.fmtSize(after) + '，减小 ' + ratio + '%', 4200);
    } catch (e) {
      console.error(e);
      FW.toast('压缩失败：' + e.message, 3600);
    }
  }

  function pageBoxSize(p) {
    const rec = srcCache[p.src];
    const base = (rec && rec.sizes && rec.sizes[p.idx]) || null;
    let w = base ? base.w : 595, h = base ? base.h : 842;
    const rot = ((base ? base.rot : 0) + p.rot) % 360;
    if (rot === 90 || rot === 270) { const t = w; w = h; h = t; }
    return { w: Math.round(w * scale), h: Math.round(h * scale) };
  }

  async function ensureSizes(srcIdx) {
    const rec = srcCache[srcIdx];
    if (!rec || rec.sizes) return;
    rec.sizes = {};
    for (let i = 1; i <= rec.doc.numPages; i++) {
      const pg = await rec.doc.getPage(i);
      const vp = pg.getViewport({ scale: 1 });
      rec.sizes[i - 1] = { w: vp.width, h: vp.height, rot: pg.rotate || 0 };
    }
  }

  async function renderPage(i, token) {
    const p = state.pages[i];
    if (!p) return;
    const rec = srcCache[p.src];
    if (!rec) return;
    await ensureSizes(p.src);
    const host = $('#pdfPages').querySelector('.pdf-page[data-pi="' + i + '"]');
    if (!host) return;
    const rot = (rec.sizes[p.idx].rot + p.rot) % 360;
    const pg = await rec.doc.getPage(p.idx + 1);
    const viewport = pg.getViewport({ scale: scale, rotation: rot });
    if (token !== renderToken) return;
    const cv = host.querySelector('canvas');
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = Math.floor(viewport.width * dpr);
    cv.height = Math.floor(viewport.height * dpr);
    cv.style.width = Math.floor(viewport.width) + 'px';
    cv.style.height = Math.floor(viewport.height) + 'px';
    const ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    await pg.render({ canvasContext: ctx, viewport: viewport }).promise;
    if (token !== renderToken) return;

    // 文本层（可选中复制）
    try {
      const tc = await pg.getTextContent();
      if (token !== renderToken) return;
      const tl = host.querySelector('.textLayer');
      tl.innerHTML = '';
      tl.style.width = viewport.width + 'px';
      tl.style.height = viewport.height + 'px';
      // pdf.js 3.x 要求容器上必须有 --scale-factor，且等于 viewport.scale，
      // 否则文本层不定位（文字选不中、复制错位）
      tl.style.setProperty('--scale-factor', String(viewport.scale));
      if (pdfjs.renderTextLayer) {
        await pdfjs.renderTextLayer({ textContentSource: tc, container: tl, viewport: viewport, textDivs: [] }).promise;
      }
    } catch (e) { /* 文本层失败不影响阅读 */ }
  }

  function renderThumbs() {
    const box = $('#pdfThumbs');
    if (!state) { box.innerHTML = ''; return; }
    box.innerHTML = state.pages.map((p, i) =>
      '<div class="pdf-thumb" data-pi="' + i + '"><span class="pdf-thumb-no">' + (i + 1) + '</span>' +
      '<div class="pdf-thumb-box">' + (p.thumb ? '<img src="' + p.thumb + '">' : '') + '</div></div>').join('');
    // 异步生成缩略图
    state.pages.forEach((p, i) => { if (!p.thumb) makeThumb(i); });
  }

  async function makeThumb(i) {
    const p = state.pages[i];
    const rec = srcCache[p.src];
    if (!rec) return;
    try {
      const pg = await rec.doc.getPage(p.idx + 1);
      const vp = pg.getViewport({ scale: 0.24 });
      const cv = document.createElement('canvas');
      cv.width = vp.width; cv.height = vp.height;
      await pg.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise;
      p.thumb = cv.toDataURL('image/jpeg', 0.6);
      const host = $('#pdfThumbs').querySelector('.pdf-thumb[data-pi="' + i + '"] .pdf-thumb-box');
      if (host) host.innerHTML = '<img src="' + p.thumb + '">';
    } catch (e) {}
  }

  /* ============================================================
     批注渲染
     ============================================================ */
  function annotsOf(pid) { return state.annots.filter((a) => a.pid === pid); }

  function paintAnnots() {
    if (!state) return;
    $$('.annotLayer').forEach((layer) => {
      const pid = layer.dataset.pid;
      layer.innerHTML = annotsOf(pid).map((a) => annotHtml(a)).join('');
    });
  }

  function repaintLayer(box, pid) {
    const layer = box.querySelector('.annotLayer[data-pid="' + pid + '"]');
    if (layer) layer.innerHTML = annotsOf(pid).map(annotHtml).join('');
  }

  function annotHtml(a) {
    const s = scale;
    const common = 'position:absolute;left:' + (a.x * s) + 'px;top:' + (a.y * s) + 'px;';
    if (a.type === 'highlight') {
      return '<div class="an an-hl" data-id="' + a.id + '" style="' + common + 'width:' + (a.w * s) + 'px;height:' + (a.h * s) +
        'px;background:' + a.color + ';opacity:' + (a.opacity == null ? 0.36 : a.opacity) + '"></div>';
    }
    if (a.type === 'rect' || a.type === 'ellipse') {
      return '<div class="an an-shape" data-id="' + a.id + '" style="' + common + 'width:' + (a.w * s) + 'px;height:' + (a.h * s) +
        'px;border:' + (a.lineW || 2) + 'px solid ' + a.color + ';' + (a.type === 'ellipse' ? 'border-radius:50%;' : '') + '"></div>';
    }
    if (a.type === 'text') {
      return '<div class="an an-text" data-id="' + a.id + '" style="' + common + 'width:' + (a.w * s) + 'px;min-height:' + (a.h * s) +
        'px;color:' + a.color + ';font-size:' + (a.size * s) + 'px;' + (a.bg ? 'background:' + a.bg + ';padding:2px 4px;border-radius:3px;' : '') + '">' +
        FW.escapeHtml(a.text || '双击输入文字').replace(/\n/g, '<br>') + '</div>';
    }
    if (a.type === 'image') {
      return '<div class="an an-img" data-id="' + a.id + '" style="' + common + 'width:' + (a.w * s) + 'px;height:' + (a.h * s) + 'px"><img src="' + a.src + '" style="width:100%;height:100%"></div>';
    }
    if (a.type === 'ink' || a.type === 'arrow') {
      const pts = a.points.map((pt) => (pt[0] * s) + ',' + (pt[1] * s)).join(' ');
      let svg = '<svg style="position:absolute;left:0;top:0;width:100%;height:100%;overflow:visible">';
      if (a.type === 'ink') {
        svg += '<polyline points="' + pts + '" fill="none" stroke="' + a.color + '" stroke-width="' + (a.lineW || 3) + '" stroke-linecap="round" stroke-linejoin="round"/>';
      } else {
        const p0 = a.points[0], p1 = a.points[a.points.length - 1];
        const x1 = p0[0] * s, y1 = p0[1] * s, x2 = p1[0] * s, y2 = p1[1] * s;
        const ang = Math.atan2(y2 - y1, x2 - x1), L = 12;
        const a1 = [x2 - L * Math.cos(ang - 0.42), y2 - L * Math.sin(ang - 0.42)];
        const a2 = [x2 - L * Math.cos(ang + 0.42), y2 - L * Math.sin(ang + 0.42)];
        svg += '<line x1="' + x1 + '" y1="' + y1 + '" x2="' + x2 + '" y2="' + y2 + '" stroke="' + a.color + '" stroke-width="' + (a.lineW || 3) + '"/>' +
          '<polygon points="' + x2 + ',' + y2 + ' ' + a1[0] + ',' + a1[1] + ' ' + a2[0] + ',' + a2[1] + '" fill="' + a.color + '"/>';
      }
      return '<div class="an an-ink" data-id="' + a.id + '" style="' + common + 'left:0;top:0;width:100%;height:100%">' + svg + '</div>';
    }
    return '';
  }

  /* ============================================================
     鼠标交互
     ============================================================ */
  function bindLayer() {
    if (bound) return;
    bound = true;
    const box = $('#pdfPages');
    let drawing = null;

    box.addEventListener('mousedown', (e) => {
      if (!state) return;
      const layer = e.target.closest('.annotLayer');
      const host = e.target.closest('.pdf-page');
      if (!host) return;
      const pid = host.dataset.pid;
      const rect = host.getBoundingClientRect();
      const x = (e.clientX - rect.left) / scale;
      const y = (e.clientY - rect.top) / scale;

      if (tool === 'select' || tool === 'hand') {
        const an = e.target.closest('.an');
        if (an && tool === 'select') {
          const a = state.annots.find((v) => v.id === an.dataset.id);
          if (a && a.type === 'text') {
            const el = an;
            el.setAttribute('contenteditable', 'true');
            el.focus();
            el.addEventListener('blur', () => {
              a.text = el.innerText.replace(/\u00a0/g, ' ');
              el.removeAttribute('contenteditable');
              paintAnnots(); emit();
            }, { once: true });
          }
        }
        return;
      }
      if (tool === 'eraser') {
        const an = e.target.closest('.an');
        if (an) {
          const i = state.annots.findIndex((v) => v.id === an.dataset.id);
          if (i >= 0) { pushUndo(); state.annots.splice(i, 1); paintAnnots(); emit(); }
        }
        return;
      }
      if (tool === 'image') return;

      e.preventDefault();
      if (tool === 'text') {
        pushUndo();
        state.annots.push({ id: uid(), pid: pid, type: 'text', x: x, y: y, w: 200, h: 26, text: '', color: toolColor, size: toolSize, bg: 'rgba(255,255,255,.86)' });
        paintAnnots(); emit();
        const el = box.querySelector('.annotLayer[data-pid="' + pid + '"] .an-text:last-child');
        if (el) {
          el.textContent = '';
          el.setAttribute('contenteditable', 'true');
          el.focus();
          el.addEventListener('blur', () => {
            const a = state.annots.find((v) => v.id === el.dataset.id);
            if (a) { a.text = el.innerText.replace(/\u00a0/g, ' '); if (!a.text.trim()) state.annots = state.annots.filter((v) => v.id !== a.id); }
            el.removeAttribute('contenteditable'); paintAnnots(); emit();
          }, { once: true });
        }
        setTool('select');
        return;
      }
      if (tool === 'ink' || tool === 'arrow') {
        drawing = { id: uid(), pid: pid, type: tool, x: 0, y: 0, w: 0, h: 0, points: [[x, y]], color: toolColor, lineW: Math.max(1, Math.round(toolSize / 6)) };
        state.annots.push(drawing);
        repaintLayer(box, pid);
        return;
      }
      // 拖拽生成矩形类
      drawing = { id: uid(), pid: pid, type: tool, x: x, y: y, w: 0, h: 0, _ox: x, _oy: y, color: toolColor, opacity: tool === 'highlight' ? 0.36 : 1, lineW: Math.max(2, Math.round(toolSize / 5)) };
      state.annots.push(drawing);
      repaintLayer(box, pid);
    });

    box.addEventListener('mousemove', (e) => {
      if (!drawing) return;
      const host = box.querySelector('.pdf-page[data-pid="' + drawing.pid + '"]');
      if (!host) return;
      const rect = host.getBoundingClientRect();
      const x = (e.clientX - rect.left) / scale, y = (e.clientY - rect.top) / scale;
      if (drawing.type === 'ink' || drawing.type === 'arrow') {
        drawing.points.push([x, y]);
      } else {
        drawing.w = Math.abs(x - drawing._ox);
        drawing.h = Math.abs(y - drawing._oy);
        drawing.x = Math.min(drawing._ox, x);
        drawing.y = Math.min(drawing._oy, y);
      }
      repaintLayer(box, drawing.pid);
    });

    window.addEventListener('mouseup', () => {
      if (!drawing) return;
      const d = drawing; drawing = null;
      if (d.type !== 'ink' && d.type !== 'arrow' && d.w < 4 && d.h < 4) {
        state.annots = state.annots.filter((a) => a.id !== d.id);
      } else if (d.type === 'ink' && d.points.length < 3) {
        state.annots = state.annots.filter((a) => a.id !== d.id);
      } else { pushUndo(); }
      paintAnnots(); emit();
    });

    $('#pdfThumbs').addEventListener('click', (e) => {
      const t = e.target.closest('.pdf-thumb');
      if (!t || !state) return;
      const host = $('#pdfPages').querySelector('.pdf-page[data-pi="' + t.dataset.pi + '"]');
      if (host) host.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });

    box.addEventListener('dragover', (e) => { e.preventDefault(); });
    box.addEventListener('drop', async (e) => {
      e.preventDefault();
      const f = e.dataTransfer.files[0];
      if (!f) return;
      if (/\.pdf$/i.test(f.name)) {
        const bytes = await FW.readAsArrayBuffer(f);
        if (!state) await loadBytes(bytes, f.name);
        else {
          const info = await addSource(bytes);
          for (let i = 0; i < info.count; i++) state.pages.push({ pid: uid(), src: info.idx, idx: i, rot: 0 });
          render(); emit(); FW.toast('已追加 ' + info.count + ' 页');
        }
      } else if (/^image\//.test(f.type)) {
        insertImageAnnot(f);
      }
    });
  }

  function insertImageAnnot(file) {
    if (!state) { FW.toast('请先打开一个 PDF'); return; }
    FW.readAsDataURL(file).then((url) => {
      const img = new Image();
      img.onload = () => {
        const first = $('#pdfPages').querySelector('.pdf-page');
        const pid = first ? first.dataset.pid : state.pages[0].pid;
        const base = srcCache[state.pages[0].src];
        const sz = base && base.sizes ? base.sizes[state.pages[0].idx] : { w: 595, h: 842 };
        const maxW = sz.w * 0.4;
        const r = Math.min(maxW / img.width, 1);
        pushUndo();
        state.annots.push({
          id: uid(), pid: pid, type: 'image', src: url,
          x: sz.w * 0.3, y: sz.h * 0.62, w: img.width * r, h: img.height * r
        });
        paintAnnots(); emit();
        FW.toast('已插入图片，可直接拖到需要的位置');
      };
      img.src = url;
    });
  }

  /* ============================================================
     撤销
     ============================================================ */
  function pushUndo() {
    if (!state) return;
    undoStack.push(JSON.stringify(state.annots));
    if (undoStack.length > 40) undoStack.shift();
  }
  function undoAnnot() {
    if (!undoStack.length) { FW.toast('没有可撤销的批注操作'); return; }
    state.annots = JSON.parse(undoStack.pop());
    paintAnnots(); emit();
  }

  /* ============================================================
     页面管理
     ============================================================ */
  function rotatePages(delta) {
    const sel = selectedPages();
    sel.forEach((i) => { state.pages[i].rot = ((state.pages[i].rot + delta) % 360 + 360) % 360; });
    render(); emit();
  }
  function deletePages() {
    const sel = selectedPages();
    if (sel.length >= state.pages.length) { FW.toast('至少保留一页'); return; }
    sel.sort((a, b) => b - a).forEach((i) => state.pages.splice(i, 1));
    render(); emit(); FW.toast('已删除 ' + sel.length + ' 页');
  }
  function movePage(dir) {
    const sel = selectedPages();
    if (!sel.length) return;
    const i = sel[0];
    const j = i + dir;
    if (j < 0 || j >= state.pages.length) return;
    const t = state.pages[i]; state.pages[i] = state.pages[j]; state.pages[j] = t;
    render(); emit();
  }
  function currentPageIndex() {
    const host = $('#pdfPages').querySelector('.pdf-page');
    const box = $('#pdfScroll');
    if (!host || !box) return 0;
    const top = box.scrollTop + 40;
    let acc = 0;
    const pages = $$('#pdfPages .pdf-page');
    for (let i = 0; i < pages.length; i++) {
      const h = pages[i].offsetHeight + 18;
      if (top < acc + h) return i;
      acc += h;
    }
    return Math.max(0, pages.length - 1);
  }
  function selectedPages() { return [currentPageIndex()]; }

  async function extractCurrent() {
    const i = currentPageIndex();
    const p = state.pages[i];
    try {
      const out = await PDFLib.PDFDocument.create();
      const src = await getPdfLibDoc(p.src);
      const [copied] = await out.copyPages(src, [p.idx]);
      if (p.rot) copied.setRotation(PDFLib.degrees(((copied.getRotation().angle || 0) + p.rot) % 360));
      out.addPage(copied);
      const bytes = await out.save();
      FW.downloadBytes(state.title + '_第' + (i + 1) + '页.pdf', bytes, 'application/pdf');
      FW.toast('已提取第 ' + (i + 1) + ' 页');
    } catch (e) { FW.toast('提取失败：' + e.message); }
  }

  const pdfLibCache = {};
  async function getPdfLibDoc(srcIdx) {
    if (pdfLibCache[srcIdx]) return pdfLibCache[srcIdx];
    const d = await PDFLib.PDFDocument.load(state.sources[srcIdx].bytes, { ignoreEncryption: true });
    pdfLibCache[srcIdx] = d;
    return d;
  }

  /* ============================================================
     导出
     ============================================================ */
  async function buildAnnotatedPdf() {
    const out = await PDFLib.PDFDocument.create();
    const copied = [];
    for (const p of state.pages) {
      const src = await getPdfLibDoc(p.src);
      const [pg] = await out.copyPages(src, [p.idx]);
      if (p.rot) pg.setRotation(PDFLib.degrees(((pg.getRotation().angle || 0) + p.rot) % 360));
      out.addPage(pg);
      copied.push({ p: p, pg: pg });
    }
    // 画批注
    for (let i = 0; i < copied.length; i++) {
      const item = copied[i];
      const list = annotsOf(item.p.pid);
      if (!list.length) continue;
      const rec = srcCache[item.p.src];
      const pdfPage = await rec.doc.getPage(item.p.idx + 1);
      const rot = (rec.sizes[item.p.idx].rot + item.p.rot) % 360;
      const vp = pdfPage.getViewport({ scale: 1, rotation: rot });
      const toPdf = (x, y) => vp.convertToPdfPoint(x, y);
      const pg = item.pg;

      for (const a of list) {
        try {
          if (a.type === 'highlight') {
            const [x1, y1] = toPdf(a.x, a.y);
            const [x2, y2] = toPdf(a.x + a.w, a.y + a.h);
            pg.drawRectangle({
              x: Math.min(x1, x2), y: Math.min(y1, y2),
              width: Math.abs(x2 - x1), height: Math.abs(y2 - y1),
              color: hex2rgb(a.color), opacity: a.opacity == null ? 0.36 : a.opacity,
              blendMode: PDFLib.BlendMode.Multiply
            });
          } else if (a.type === 'rect') {
            const [x1, y1] = toPdf(a.x, a.y);
            const [x2, y2] = toPdf(a.x + a.w, a.y + a.h);
            pg.drawRectangle({
              x: Math.min(x1, x2), y: Math.min(y1, y2),
              width: Math.abs(x2 - x1), height: Math.abs(y2 - y1),
              borderColor: hex2rgb(a.color), borderWidth: a.lineW || 2, opacity: 0
            });
          } else if (a.type === 'ellipse') {
            const [x1, y1] = toPdf(a.x, a.y);
            const [x2, y2] = toPdf(a.x + a.w, a.y + a.h);
            pg.drawEllipse({
              x: Math.min(x1, x2) + Math.abs(x2 - x1) / 2,
              y: Math.min(y1, y2) + Math.abs(y2 - y1) / 2,
              xScale: Math.abs(x2 - x1), yScale: Math.abs(y2 - y1),
              borderColor: hex2rgb(a.color), borderWidth: a.lineW || 2
            });
          } else if (a.type === 'text') {
            const png = await textToPng(a.text || '', a.w, a.size, a.color, a.bg);
            const img = await out.embedPng(png);
            const [x, y] = toPdf(a.x, a.y);
            const h = Math.max(a.h, a.size * 1.5);
            pg.drawImage(img, { x: x, y: y - h, width: a.w, height: h });
          } else if (a.type === 'image') {
            const png = await urlToPng(a.src);
            const img = await out.embedPng(png.bytes);
            const [x, y] = toPdf(a.x, a.y);
            pg.drawImage(img, { x: x, y: y - a.h, width: a.w, height: a.h });
          } else if (a.type === 'ink' || a.type === 'arrow') {
            const pts = a.points.map((pt) => toPdf(pt[0], pt[1]));
            if (a.type === 'ink') {
              for (let k = 1; k < pts.length; k++) {
                pg.drawLine({
                  start: { x: pts[k - 1][0], y: pts[k - 1][1] },
                  end: { x: pts[k][0], y: pts[k][1] },
                  thickness: a.lineW || 3, color: hex2rgb(a.color),
                  lineCap: PDFLib.LineCapStyle.Round
                });
              }
            } else {
              const s = pts[0], e = pts[pts.length - 1];
              pg.drawLine({ start: { x: s[0], y: s[1] }, end: { x: e[0], y: e[1] }, thickness: a.lineW || 3, color: hex2rgb(a.color) });
              const ang = Math.atan2(e[1] - s[1], e[0] - s[0]), L = 10;
              [0.42, -0.42].forEach((d) => {
                pg.drawLine({
                  start: { x: e[0], y: e[1] },
                  end: { x: e[0] - L * Math.cos(ang + d), y: e[1] - L * Math.sin(ang + d) },
                  thickness: a.lineW || 3, color: hex2rgb(a.color)
                });
              });
            }
          }
        } catch (err) { console.warn('批注导出失败', a.type, err); }
      }
    }
    return await out.save();
  }

  function hex2rgb(hex) {
    const h = String(hex || '#000000').replace('#', '');
    const v = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
    return PDFLib.rgb(parseInt(v.slice(0, 2), 16) / 255, parseInt(v.slice(2, 4), 16) / 255, parseInt(v.slice(4, 6), 16) / 255);
  }

  function textToPng(text, boxW, size, color, bg) {
    const dpr = 3;
    const lines = String(text || ' ').split('\n');
    const W = Math.max(60, boxW) * dpr;
    const lineH = size * 1.45 * dpr;
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = Math.ceil(lineH * lines.length + 8 * dpr);
    const ctx = cv.getContext('2d');
    if (bg) { ctx.fillStyle = bg; ctx.fillRect(0, 0, cv.width, cv.height); }
    ctx.font = (size * dpr) + 'px "Microsoft YaHei","PingFang SC",sans-serif';
    ctx.fillStyle = color || '#000';
    ctx.textBaseline = 'top';
    lines.forEach((ln, i) => ctx.fillText(ln, 4 * dpr, i * lineH + 4 * dpr));
    return new Promise((res) => cv.toBlob((b) => b.arrayBuffer().then((ab) => res(new Uint8Array(ab))), 'image/png'));
  }

  function urlToPng(url) {
    return new Promise((res) => {
      const img = new Image();
      img.onload = () => {
        const cv = document.createElement('canvas');
        cv.width = img.naturalWidth; cv.height = img.naturalHeight;
        cv.getContext('2d').drawImage(img, 0, 0);
        cv.toBlob((b) => b.arrayBuffer().then((ab) => res({ bytes: new Uint8Array(ab), w: cv.width, h: cv.height })), 'image/png');
      };
      img.src = url;
    });
  }

  async function exportAnnotated() {
    if (!state) { FW.toast('请先打开一个 PDF'); return; }
    FW.toast('正在合成 PDF……', 4000);
    try {
      const bytes = await buildAnnotatedPdf();
      FW.downloadBytes(state.title + '_已批注.pdf', bytes, 'application/pdf');
      FW.toast('已导出带批注的 PDF（' + state.pages.length + ' 页）');
    } catch (e) {
      console.error(e);
      FW.toast('导出失败：' + e.message, 3200);
    }
  }

  async function exportPagesPng() {
    if (!state) return;
    FW.toast('正在渲染图片……', 4000);
    const zipFiles = {};
    for (let i = 0; i < state.pages.length; i++) {
      const p = state.pages[i];
      const rec = srcCache[p.src];
      const rot = (rec.sizes[p.idx].rot + p.rot) % 360;
      const pg = await rec.doc.getPage(p.idx + 1);
      const vp = pg.getViewport({ scale: 2, rotation: rot });
      const cv = document.createElement('canvas');
      cv.width = vp.width; cv.height = vp.height;
      await pg.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise;
      const b64 = cv.toDataURL('image/png').split(',')[1];
      zipFiles['page-' + String(i + 1).padStart(3, '0') + '.png'] = b64ToU8(b64);
    }
    const zipped = global.fflate.zipSync(zipFiles, { level: 6 });
    FW.downloadBytes(state.title + '_图片.zip', zipped, 'application/zip');
    FW.toast('已导出 ' + state.pages.length + ' 张 PNG（zip 打包）');
  }

  function b64ToU8(b64) {
    const bin = atob(b64);
    const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return u8;
  }

  async function exportText() {
    if (!state) return;
    let out = '';
    for (let i = 0; i < state.pages.length; i++) {
      const p = state.pages[i];
      const rec = srcCache[p.src];
      const pg = await rec.doc.getPage(p.idx + 1);
      const tc = await pg.getTextContent();
      out += '===== 第 ' + (i + 1) + ' 页 =====\n' + tc.items.map((it) => it.str).join('') + '\n\n';
    }
    FW.downloadText(state.title + '.txt', out, 'text/plain');
    FW.toast('已导出文本');
  }

  /* ---------- 转 Word / Excel ---------- */
  async function convertToOffice(target) {
    if (!state) { FW.toast('请先打开一个 PDF'); return; }
    if (!global.PDFCONV) { FW.toast('转换模块未加载'); return; }
    const label = target === 'docx' ? 'Word' : 'Excel';
    FW.toast('正在转换为 ' + label + '……', 6000);
    try {
      const res = await global.PDFCONV.fromSession(state, target, (i, n) => {
        if (i === n || i % 5 === 0) FW.toast('正在解析第 ' + i + '/' + n + ' 页…', 1500);
      });

      // 顺便解析成可编辑的文档对象 —— 转完可以直接接着改，不用先下载再重新打开
      let doc = null;
      try {
        if (target === 'docx') {
          const r = global.OFFICE.parseDocx(res.bytes);
          doc = FW.createDoc('doc');
          doc.title = state.title;
          doc.data.html = r.html || '<p></p>';
        } else {
          const r = global.OFFICE.parseXlsx(res.bytes);
          doc = FW.createDoc('sheet');
          doc.title = state.title;
          doc.data.sheets = r.sheets && r.sheets.length ? r.sheets : doc.data.sheets;
          doc.data.active = 0;
        }
      } catch (e) { console.warn('转换结果回读失败，只能下载', e); }

      showConvertResult(doc, res.bytes, target, label);
    } catch (e) {
      console.error(e);
      FW.toast('转换失败：' + e.message, 3600);
    }
  }

  /** 转换完成后的结果窗口：可以直接打开编辑，也可以只下载 */
  function showConvertResult(doc, bytes, target, label) {
    let m = document.getElementById('convResultMask');
    if (!m) {
      m = document.createElement('div');
      m.className = 'modal-mask';
      m.id = 'convResultMask';
      document.body.appendChild(m);
      m.addEventListener('click', (e) => { if (e.target === m) m.classList.remove('on'); });
    }
    const mime = target === 'docx'
      ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    const editable = !!doc;

    m.innerHTML =
      '<div class="modal"><div class="modal-head"><h3>转换完成</h3>' +
      '<button class="modal-x" data-cv-close>×</button></div>' +
      '<div class="modal-body">' +
      '<p style="font-size:13.5px;margin-bottom:6px">已生成 <b>' + label + ' 文件</b>' +
      '（' + state.pages.length + ' 页 · ' + FW.fmtSize(bytes.length) + '）</p>' +
      '<p class="muted" style="font-size:12px;line-height:1.8;margin-bottom:14px">' +
      (editable
        ? '可以直接打开编辑 —— 改完再导出回 .' + target + ' 或发给朋友，不用先下载再重新打开。'
        : '这个文件可以下载后用其他软件打开。') +
      '</p>' +
      '<div class="cv-actions">' +
      (editable ? '<button class="primary-btn" id="cvEdit">打开编辑</button>' : '') +
      '<button class="' + (editable ? 'ghost-btn' : 'primary-btn') + '" id="cvDownload">下载文件</button>' +
      '<button class="ghost-btn" data-cv-close>关闭</button>' +
      '</div></div></div>';

    m.querySelectorAll('[data-cv-close]').forEach((b) => b.addEventListener('click', () => m.classList.remove('on')));
    m.querySelector('#cvDownload').addEventListener('click', () => {
      FW.downloadBytes(state.title + '.' + target, bytes, mime);
      FW.toast('已下载 ' + label + ' 文件');
      m.classList.remove('on');
    });
    const editBtn = m.querySelector('#cvEdit');
    if (editBtn) {
      editBtn.addEventListener('click', () => {
        if (!FW.Store.upsert(doc)) {
          FW.toast('本地存储已满，暂时无法打开编辑。你可以先「下载文件」再自行打开', 5000);
          return;
        }
        m.classList.remove('on');
        FW.app.openDoc(doc);
        FW.toast('已打开转换结果，可以直接编辑了', 3200);
      });
    }
    m.classList.add('on');
  }

  function addWatermark() {    if (!state) return;
    const text = prompt('输入水印文字：', '内部资料 · 请勿外传');
    if (!text) return;
    const color = prompt('水印颜色（十六进制）：', '#D93B2B') || '#D93B2B';
    const size = parseFloat(prompt('字号（磅）：', '48')) || 48;
    pushUndo();
    state.pages.forEach((p) => {
      const rec = srcCache[p.src];
      const sz = (rec && rec.sizes && rec.sizes[p.idx]) || { w: 595, h: 842 };
      state.annots.push({
        id: uid(), pid: p.pid, type: 'text', text: text,
        x: sz.w * 0.12, y: sz.h * 0.46, w: sz.w * 0.76, h: size * 1.6,
        size: size, color: color, bg: null, opacity: 0.3
      });
    });
    paintAnnots(); emit();
    FW.toast('已为 ' + state.pages.length + ' 页添加水印');
  }

  function setTool(t) {
    tool = t;
    const box = $('#pdfPages');
    box.className = 'pdf-pages tool-' + t;
    if (global.FW.app) global.FW.app.syncRibbonState({ ['tool:' + t]: true });
    FW.toast('当前工具：' + TOOL_LABEL[t], 1200);
  }

  function zoom(delta) {
    scale = Math.max(0.35, Math.min(4, scale + delta));
    if (state) render(); else if (global.FW.app) global.FW.app.refreshStatus();
  }
  function fitWidth() {
    const box = $('#pdfScroll');
    if (!box || !state) return;
    const rec = srcCache[state.pages[0].src];
    const w = (rec && rec.sizes) ? rec.sizes[state.pages[0].idx].w : 595;
    scale = Math.max(0.35, Math.min(4, (box.clientWidth - 48) / w));
    render();
  }

  /* ============================================================
     功能区
     ============================================================ */
  const ribbon = [
    {
      tab: '开始', groups: [
        {
          label: '文件', items: [
            { t: 'btn', g: '📂', label: '打开 PDF', cmd: 'open', wide: true },
            { t: 'btn', g: '💾', label: '下载原文件', cmd: 'saveRaw', wide: true },
            { t: 'btn', g: '＋', label: '合并 PDF', cmd: 'merge', wide: true }
          ]
        },
        {
          label: '导出', items: [
            { t: 'btn', g: '✓', label: '带批注 PDF', cmd: 'exportAnnotated', wide: true },
            { t: 'btn', g: '🖼', label: '页面转图片', cmd: 'exportPng', wide: true },
            { t: 'btn', g: 'T', label: '导出文本', cmd: 'exportText', wide: true },
            { t: 'btn', g: 'P', label: '打印', cmd: 'print', wide: true }
          ]
        },
        {
          label: '转 Office（免费）', items: [
            { t: 'btn', g: 'W', label: '转 Word', cmd: 'toDocx', wide: true },
            { t: 'btn', g: 'X', label: '转 Excel', cmd: 'toXlsx', wide: true }
          ]
        }
      ]
    },
    {
      tab: '批注', groups: [
        {
          label: '工具', items: [
            { t: 'btn', g: '🖱', label: '选择', cmd: 'tool:select', toggle: true, wide: true },
            { t: 'btn', g: '✋', label: '抓手', cmd: 'tool:hand', toggle: true, wide: true },
            { t: 'btn', g: 'T', label: '文本批注', cmd: 'tool:text', toggle: true, wide: true },
            { t: 'btn', g: '▨', label: '高亮', cmd: 'tool:highlight', toggle: true, wide: true },
            { t: 'btn', g: '▭', label: '矩形框', cmd: 'tool:rect', toggle: true, wide: true },
            { t: 'btn', g: '◯', label: '椭圆圈', cmd: 'tool:ellipse', toggle: true, wide: true },
            { t: 'btn', g: '↗', label: '箭头', cmd: 'tool:arrow', toggle: true, wide: true },
            { t: 'btn', g: '✎', label: '画笔', cmd: 'tool:ink', toggle: true, wide: true },
            { t: 'btn', g: '⌫', label: '橡皮擦', cmd: 'tool:eraser', toggle: true, wide: true },
            { t: 'btn', g: '🖼', label: '图片图章', cmd: 'tool:image', toggle: true, wide: true }
          ]
        },
        {
          label: '颜色与粗细', items: [
            { t: 'color', g: '▨', label: '批注颜色', cmd: 'annotColor', value: '#F5B301' },
            { t: 'select', cmd: 'annotSize', width: 62, options: [{ v: 12, t: '细' }, { v: 16, t: '中' }, { v: 22, t: '粗' }, { v: 32, t: '特粗' }] }
          ]
        },
        {
          label: '操作', items: [
            { t: 'btn', g: '↶', label: '撤销批注', cmd: 'undoAnnot', wide: true },
            { t: 'btn', g: '💧', label: '添加水印', cmd: 'watermark', wide: true },
            { t: 'btn', g: '🖼', label: '插入图片', cmd: 'insertImage', wide: true },
            { t: 'btn', g: '🗑', label: '清空批注', cmd: 'clearAnnots', wide: true }
          ]
        }
      ]
    },
    {
      tab: '页面', groups: [
        {
          label: '旋转', items: [
            { t: 'btn', g: '↺', label: '左转 90°', cmd: 'rot:-90', wide: true },
            { t: 'btn', g: '↻', label: '右转 90°', cmd: 'rot:90', wide: true }
          ]
        },
        {
          label: '整理', items: [
            { t: 'btn', g: '↑', label: '上移一页', cmd: 'pageUp', wide: true },
            { t: 'btn', g: '↓', label: '下移一页', cmd: 'pageDown', wide: true },
            { t: 'btn', g: '✂', label: '提取当前页', cmd: 'extract', wide: true },
            { t: 'btn', g: '🗑', label: '删除当前页', cmd: 'delPage', wide: true }
          ]
        },
        {
          label: '重排', items: [
            { t: 'btn', g: '⇅', label: '整体倒序', cmd: 'reverse', wide: true },
            { t: 'btn', g: '⟲', label: '恢复原始顺序', cmd: 'resetOrder', wide: true }
          ]
        }
      ]
    },
    {
      tab: '视图', groups: [
        {
          label: '缩放', items: [
            { t: 'btn', g: '−', label: '缩小', cmd: 'zoom:-0.15' },
            { t: 'btn', g: '+', label: '放大', cmd: 'zoom:0.15' },
            { t: 'btn', g: '⇔', label: '适应宽度', cmd: 'fitWidth', wide: true },
            { t: 'btn', g: '100', label: '100%', cmd: 'zoomReset', wide: true }
          ]
        },
        {
          label: '信息', items: [
            { t: 'btn', g: 'ℹ', label: '文档信息', cmd: 'info', wide: true }
          ]
        }
      ]
    },
    {
      tab: '工具', groups: [
        {
          label: '压缩', items: [
            { t: 'btn', g: '🗜', label: '压缩 PDF', cmd: 'compress', wide: true }
          ]
        },
        {
          label: '表单', items: [
            { t: 'btn', g: '▤', label: '填写表单', cmd: 'toggleForm', wide: true }
          ]
        },
        {
          label: '转 Office', items: [
            { t: 'btn', g: 'W', label: '转 Word', cmd: 'toDocx', wide: true },
            { t: 'btn', g: 'X', label: '转 Excel', cmd: 'toXlsx', wide: true }
          ]
        }
      ]
    }
  ];

  /* ============================================================
     模块接口
     ============================================================ */
  global.FW.Editors = global.FW.Editors || {};
  global.FW.Editors.pdf = {
    badge: 'PDF',
    badgeCls: 'pdf',
    ribbon: ribbon,
    isSession: true,

    mount() {
      undoStack = [];
      bindLayer();
      render();
    },

    unmount() { },

    getData() { return null; },
    setChangeHandler(fn) { onChange = fn; },

    loadBytes: loadBytes,

    cmd(name, value) {
      if (name === 'open') return openPdf();
      if (!state && name !== 'open') { FW.toast('请先打开一个 PDF 文件'); return; }
      if (name === 'saveRaw') { FW.downloadBytes(state.title + '.pdf', state.fileBytes, 'application/pdf'); FW.toast('已下载原文件'); return; }
      if (name === 'merge') return mergePdf();
      if (name === 'exportAnnotated') return exportAnnotated();
      if (name === 'exportPng') return exportPagesPng();
      if (name === 'exportText') return exportText();
      if (name === 'print') { global.print(); return; }
      if (name === 'toDocx' || name === 'toXlsx') return convertToOffice(name === 'toDocx' ? 'docx' : 'xlsx');
      if (name === 'compress') return compressDialog();
      if (name === 'toggleForm') return toggleFormMode();
      if (name.indexOf('tool:') === 0) {
        const t = name.slice(5);
        if (t === 'image') { FW.pickFile('image/*').then((f) => f && insertImageAnnot(f)); setTool('image'); return; }
        return setTool(t);
      }
      if (name === 'annotColor') { toolColor = value; return; }
      if (name === 'annotSize') { toolSize = parseInt(value, 10); return; }
      if (name === 'undoAnnot') return undoAnnot();
      if (name === 'watermark') return addWatermark();
      if (name === 'insertImage') { FW.pickFile('image/*').then((f) => f && insertImageAnnot(f)); return; }
      if (name === 'clearAnnots') {
        if (!state.annots.length) { FW.toast('当前没有批注'); return; }
        if (!confirm('确定清空全部批注？')) return;
        pushUndo(); state.annots = []; paintAnnots(); emit(); return;
      }
      if (name.indexOf('rot:') === 0) return rotatePages(parseInt(name.slice(4), 10));
      if (name === 'pageUp') return movePage(-1);
      if (name === 'pageDown') return movePage(1);
      if (name === 'extract') return extractCurrent();
      if (name === 'delPage') return deletePages();
      if (name === 'reverse') { state.pages.reverse(); render(); emit(); return; }
      if (name === 'resetOrder') {
        state.pages = [];
        state.sources.forEach((s, si) => {
          const rec = srcCache[si];
          for (let i = 0; i < rec.doc.numPages; i++) state.pages.push({ pid: uid(), src: si, idx: i, rot: 0 });
        });
        render(); emit(); FW.toast('已恢复原始顺序');
        return;
      }
      if (name.indexOf('zoom:') === 0) return zoom(parseFloat(name.slice(5)));
      if (name === 'zoomReset') { scale = 1; render(); return; }
      if (name === 'fitWidth') return fitWidth();
      if (name === 'info') {
        FW.toast('文档：' + state.title + ' · 页数 ' + state.pages.length + ' · 批注 ' + state.annots.length + ' 条 · 缩放 ' + Math.round(scale * 100) + '%', 3600);
        return;
      }
    },

    undo() { undoAnnot(); },
    redo() { FW.toast('PDF 批注暂不支持重做'); },

    status() {
      if (!state) return '<span>未打开文件</span>';
      const formPart = state.formMode
        ? '<span style="color:#D93B2B">表单填写中（' + state.formFields.length + ' 个字段）</span>'
        : (state.formFields && state.formFields.length ? '<span>含 ' + state.formFields.length + ' 个表单字段</span>' : '');
      return '<span>页数：' + state.pages.length + '</span>' +
        '<span>当前：第 ' + (currentPageIndex() + 1) + ' 页</span>' +
        '<span>批注：' + state.annots.length + ' 条</span>' +
        formPart +
        '<span>缩放：' + Math.round(scale * 100) + '%</span>' +
        '<span class="sp"></span><span>工具：' + TOOL_LABEL[tool] + '</span>';
    },

    exports: [
      { id: 'annot', icon: '✓', title: '带批注的 PDF (.pdf)', desc: '把批注烧录进 PDF，任何人打开都能看到', ext: 'pdf' },
      { id: 'toDocx', icon: 'W', title: '转为 Word 文档 (.docx)', desc: '提取文字与段落结构，生成可编辑的 Word 文档', ext: 'docx' },
      { id: 'toXlsx', icon: 'X', title: '转为 Excel 表格 (.xlsx)', desc: '按坐标还原成行列，适合表格类 PDF', ext: 'xlsx' },
      { id: 'compress', icon: '🗜', title: '压缩 PDF', desc: '重渲染降画质，扫描件能压掉一大半', ext: 'pdf' },
      { id: 'raw', icon: 'PDF', title: '原始 PDF（未修改）', desc: '下载最初打开的那份文件', ext: 'pdf' },
      { id: 'png', icon: '🖼', title: '所有页面转图片 (.zip)', desc: '每页导出为 2 倍分辨率 PNG 并打包', ext: 'zip' },
      { id: 'txt', icon: 'T', title: '提取全部文本 (.txt)', desc: '把 PDF 里的文字抽取成纯文本', ext: 'txt' }
    ]
  };

  // 让转换中心也能调用
  global.FW.PDFUtil = {
    loadBytes: loadBytes,
    getState: () => state,
    setState: (s) => { state = s; },
    reset: () => { state = null; Object.keys(srcCache).forEach((k) => delete srcCache[k]); Object.keys(pdfLibCache).forEach((k) => delete pdfLibCache[k]); },
    srcCache: srcCache
  };
})(window);
