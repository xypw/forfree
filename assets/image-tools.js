/* ============================================================
   image-tools.js — 图片工具箱
   图片工具箱：压缩、格式转换、旋转翻转、
   加水印、拼图。全部用 Canvas 在本机完成。
   ============================================================ */
(function (global) {
  'use strict';
  const FW = global.FW, $ = FW.$, $$ = FW.$$;

  let items = [];        // {id, name, type, img, w, h, size, url, out}
  let op = 'compress';
  let bound = false;
  let busy = false;

  const params = {
    compress: { quality: 0.75, maxSide: 0, format: 'auto' },
    convert: { format: 'image/jpeg' },
    transform: { rotate: 0, flipH: false, flipV: false },
    watermark: { text: 'ForFree', size: 36, color: '#ffffff', opacity: 0.55, pos: 'br', rotate: -30 },
    collage: { dir: 'h', cols: 2, gap: 10, bg: '#ffffff' }
  };

  const OPS = [
    { k: 'compress', n: '压缩', d: '降低质量与尺寸，大幅减小体积' },
    { k: 'convert', n: '格式转换', d: '在 PNG / JPEG / WebP 之间互转' },
    { k: 'transform', n: '旋转翻转', d: '旋转 90/180/270 度、水平或垂直翻转' },
    { k: 'watermark', n: '加水印', d: '批量叠加文字水印' },
    { k: 'collage', n: '拼图', d: '多张拼成一张长图或网格图' }
  ];

  const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };

  /* ============================================================
     基础工具
     ============================================================ */
  function makeCanvas(w, h) {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w));
    c.height = Math.max(1, Math.round(h));
    return c;
  }
  function toBlob(canvas, type, quality) {
    return new Promise((res) => canvas.toBlob((b) => res(b), type, quality));
  }
  function loadImage(url) {
    return new Promise((res, rej) => {
      const im = new Image();
      im.onload = () => res(im);
      im.onerror = () => rej(new Error('图片解码失败'));
      im.src = url;
    });
  }
  function blobToU8(blob) {
    return new Promise((res) => blob.arrayBuffer().then((ab) => res(new Uint8Array(ab))));
  }

  /* ============================================================
     队列
     ============================================================ */
  async function addFiles(files) {
    const list = Array.prototype.slice.call(files).filter((f) => /^image\//.test(f.type));
    if (!list.length) { FW.toast('请选择图片文件'); return; }
    for (const f of list) {
      try {
        const url = await FW.readAsDataURL(f);
        const img = await loadImage(url);
        items.push({
          id: FW.uid(), name: f.name, type: f.type, img: img,
          w: img.naturalWidth, h: img.naturalHeight,
          size: f.size, url: url, out: null
        });
      } catch (e) { console.warn('跳过', f.name, e); }
    }
    renderList();
    updateHint();
    FW.toast('已添加 ' + list.length + ' 张图片');
  }

  function renderList() {
    const box = $('#imgList');
    if (!items.length) { box.innerHTML = ''; return; }
    box.innerHTML = items.map((it, i) =>
      '<div class="img-item" data-i="' + i + '">' +
      '<img src="' + it.url + '" alt="">' +
      '<div class="img-item-info">' +
      '<strong>' + FW.escapeHtml(it.name) + '</strong>' +
      '<span>' + it.w + '×' + it.h + ' · ' + FW.fmtSize(it.size) +
      (it.out ? ' <b class="img-arrow">→</b> <b class="img-out">' + FW.fmtSize(it.out.size) +
        ' (' + Math.round((1 - it.out.size / it.size) * 100) + '%)</b>' : '') + '</span>' +
      '</div>' +
      '<button class="mini-btn danger" data-del="' + i + '">×</button>' +
      '</div>').join('');
  }

  function renderPreview() {
    const box = $('#imgPreview');
    const first = items.find((x) => x.out) || items[0];
    if (!first) {
      box.innerHTML = '<div class="img-preview-empty">处理后的图片会显示在这里</div>';
      return;
    }
    const src = first.out ? first.out.url : first.url;
    const info = first.out
      ? '<div class="ip-meta"><span>原始 ' + FW.fmtSize(first.size) + ' · ' + first.w + '×' + first.h + '</span>' +
        '<span class="ip-arrow">→</span>' +
        '<span class="ip-new">处理后 ' + FW.fmtSize(first.out.size) + ' · ' + first.out.w + '×' + first.out.h +
        '（' + (first.out.size < first.size ? '减小 ' + Math.round((1 - first.out.size / first.size) * 100) + '%' : '增大 ' + Math.round((first.out.size / first.size - 1) * 100) + '%') + '）</span></div>'
      : '<div class="ip-meta"><span>' + FW.escapeHtml(first.name) + ' · ' + FW.fmtSize(first.size) + ' · ' + first.w + '×' + first.h + '</span></div>';
    box.innerHTML = '<img src="' + src + '" alt="">' + info;
  }

  function updateHint() {
    const n = items.length;
    const done = items.filter((x) => x.out).length;
    $('#imgHint').textContent = n
      ? n + ' 张图片' + (done ? ' · 已处理 ' + done + ' 张' : '')
      : '还没有添加图片';
    $('#imgRun').disabled = !n;
    $('#imgRun').textContent = busy ? '处理中…' : '开始处理';
    $('#imgRun').style.opacity = n ? 1 : .5;
  }

  /* ============================================================
     操作面板
     ============================================================ */
  function renderTabs() {
    $('#imgOpTabs').innerHTML = OPS.map((o) =>
      '<button class="img-tab' + (op === o.k ? ' on' : '') + '" data-op="' + o.k + '">' + o.n + '</button>').join('');
  }

  function renderPanel() {
    const box = $('#imgOpBody');
    const p = params[op];
    const row = (label, ctrl) => '<label class="ip-row"><span>' + label + '</span>' + ctrl + '</label>';

    if (op === 'compress') {
      box.innerHTML = '<p class="ip-desc">降低画质与分辨率来减小体积。PNG 转 JPEG 通常能减掉一大半。</p>' +
        row('输出画质', '<input type="range" id="ipQuality" min="10" max="100" value="' + Math.round(p.quality * 100) + '">' +
          '<b id="ipQualityV">' + Math.round(p.quality * 100) + '%</b>') +
        row('最大边长', '<select id="ipMaxSide">' +
          [[0, '不限制'], [1920, '1920 px'], [1280, '1280 px'], [800, '800 px'], [480, '480 px']]
            .map((o) => '<option value="' + o[0] + '"' + (p.maxSide === o[0] ? ' selected' : '') + '>' + o[1] + '</option>').join('') +
          '</select>') +
        row('输出格式', '<select id="ipFormat">' +
          [['auto', '自动（推荐）'], ['image/jpeg', 'JPEG（体积最小）'], ['image/webp', 'WebP'],
           ['image/png', 'PNG（无损，压不动）'], ['keep', '保持原格式']]
            .map((o) => '<option value="' + o[0] + '"' + (p.format === o[0] ? ' selected' : '') + '>' + o[1] + '</option>').join('') +
          '</select>') +
        '<p class="ip-hint">自动模式：有透明通道的图保留 PNG，其余转 JPEG —— 只有 JPEG/WebP 才能靠画质档位压缩体积。</p>';
    } else if (op === 'convert') {
      box.innerHTML = '<p class="ip-desc">在常见图片格式之间互相转换。</p>' +
        row('目标格式', '<select id="ipTarget">' +
          [['image/jpeg', 'JPEG (.jpg)'], ['image/png', 'PNG (.png)'], ['image/webp', 'WebP (.webp)']]
            .map((o) => '<option value="' + o[0] + '"' + (p.format === o[0] ? ' selected' : '') + '>' + o[1] + '</option>').join('') +
          '</select>');
    } else if (op === 'transform') {
      box.innerHTML = '<p class="ip-desc">旋转或翻转，适合批量纠正手机拍歪的照片。</p>' +
        row('旋转', '<select id="ipRotate">' +
          [[0, '不旋转'], [90, '顺时针 90°'], [180, '180°'], [270, '顺时针 270°']]
            .map((o) => '<option value="' + o[0] + '"' + (p.rotate === o[0] ? ' selected' : '') + '>' + o[1] + '</option>').join('') +
          '</select>') +
        row('水平翻转', '<input type="checkbox" id="ipFlipH"' + (p.flipH ? ' checked' : '') + '>') +
        row('垂直翻转', '<input type="checkbox" id="ipFlipV"' + (p.flipV ? ' checked' : '') + '>');
    } else if (op === 'watermark') {
      box.innerHTML = '<p class="ip-desc">给每张图叠加文字水印，适合批量加版权标记。</p>' +
        row('水印文字', '<input type="text" id="ipWmText" value="' + FW.escapeHtml(p.text) + '" maxlength="40">') +
        row('字号', '<input type="number" id="ipWmSize" min="8" max="200" value="' + p.size + '">') +
        row('颜色', '<input type="color" id="ipWmColor" value="' + p.color + '">') +
        row('不透明度', '<input type="range" id="ipWmOpacity" min="5" max="100" value="' + Math.round(p.opacity * 100) + '">' +
          '<b id="ipWmOpacityV">' + Math.round(p.opacity * 100) + '%</b>') +
        row('旋转角度', '<input type="number" id="ipWmRotate" min="-90" max="90" value="' + p.rotate + '">') +
        row('位置', '<select id="ipWmPos">' +
          [['tl', '左上'], ['tc', '上中'], ['tr', '右上'], ['ml', '左中'], ['mc', '正中'], ['mr', '右中'],
           ['bl', '左下'], ['bc', '下中'], ['br', '右下']]
            .map((o) => '<option value="' + o[0] + '"' + (p.pos === o[0] ? ' selected' : '') + '>' + o[1] + '</option>').join('') +
          '</select>');
    } else if (op === 'collage') {
      box.innerHTML = '<p class="ip-desc">把多张图拼成一张。选「网格」时按下面的列数排列。</p>' +
        row('拼接方向', '<select id="ipColDir">' +
          [['h', '横向拼接'], ['v', '纵向拼接'], ['grid', '网格']]
            .map((o) => '<option value="' + o[0] + '"' + (p.dir === o[0] ? ' selected' : '') + '>' + o[1] + '</option>').join('') +
          '</select>') +
        row('网格列数', '<input type="number" id="ipCols" min="1" max="8" value="' + p.cols + '">') +
        row('间距 (px)', '<input type="number" id="ipGap" min="0" max="100" value="' + p.gap + '">') +
        row('背景色', '<input type="color" id="ipColBg" value="' + p.bg + '">') +
        '<p class="ip-warn">拼图模式会把全部 ' + items.length + ' 张图合成 1 张输出。</p>';
    }
    bindPanelInputs();
  }

  function bindPanelInputs() {
    const on = (id, ev, fn) => { const el = $('#' + id); if (el) el.addEventListener(ev, fn); };
    const p = params[op];

    on('ipQuality', 'input', (e) => {
      p.quality = +e.target.value / 100;
      $('#ipQualityV').textContent = e.target.value + '%';
    });
    on('ipMaxSide', 'change', (e) => { p.maxSide = +e.target.value; });
    on('ipFormat', 'change', (e) => { p.format = e.target.value; });
    on('ipTarget', 'change', (e) => { p.format = e.target.value; });
    on('ipRotate', 'change', (e) => { p.rotate = +e.target.value; });
    on('ipFlipH', 'change', (e) => { p.flipH = e.target.checked; });
    on('ipFlipV', 'change', (e) => { p.flipV = e.target.checked; });
    on('ipWmText', 'input', (e) => { p.text = e.target.value; });
    on('ipWmSize', 'input', (e) => { p.size = +e.target.value; });
    on('ipWmColor', 'input', (e) => { p.color = e.target.value; });
    on('ipWmOpacity', 'input', (e) => {
      p.opacity = +e.target.value / 100;
      $('#ipWmOpacityV').textContent = e.target.value + '%';
    });
    on('ipWmRotate', 'input', (e) => { p.rotate = +e.target.value; });
    on('ipWmPos', 'change', (e) => { p.pos = e.target.value; });
    on('ipColDir', 'change', (e) => { p.dir = e.target.value; });
    on('ipCols', 'input', (e) => { p.cols = Math.max(1, +e.target.value); });
    on('ipGap', 'input', (e) => { p.gap = Math.max(0, +e.target.value); });
    on('ipColBg', 'input', (e) => { p.bg = e.target.value; });
  }

  /* ============================================================
     处理
     ============================================================ */
  const alphaCache = new WeakMap();

  /** 图片是否含透明像素（缩到 256px 抽样检测，够快也够准） */
  function hasAlpha(img) {
    if (alphaCache.has(img)) return alphaCache.get(img);
    let res = false;
    try {
      const s = Math.min(256 / img.naturalWidth, 256 / img.naturalHeight, 1);
      const cv = makeCanvas(img.naturalWidth * s, img.naturalHeight * s);
      const ctx = cv.getContext('2d');
      ctx.drawImage(img, 0, 0, cv.width, cv.height);
      const d = ctx.getImageData(0, 0, cv.width, cv.height).data;
      for (let i = 3; i < d.length; i += 4) { if (d[i] < 250) { res = true; break; } }
    } catch (e) { res = false; }
    alphaCache.set(img, res);
    return res;
  }

  function baseType(item, fmt) {
    if (fmt === 'keep') return item.type === 'image/png' ? 'image/png' : (item.type === 'image/webp' ? 'image/webp' : 'image/jpeg');
    // 自动：有透明通道就留 PNG，否则转 JPEG（JPEG 才能靠画质压缩，PNG 不行）
    if (fmt === 'auto') return hasAlpha(item.img) ? 'image/png' : 'image/jpeg';
    return fmt;
  }
  function outName(item, type) {
    const base = item.name.replace(/\.[^.]+$/, '');
    return base + '.' + (EXT[type] || 'png');
  }

  async function processCompress(item) {
    const p = params.compress;
    let w = item.w, h = item.h;
    if (p.maxSide > 0 && Math.max(w, h) > p.maxSide) {
      const r = p.maxSide / Math.max(w, h);
      w = Math.round(w * r); h = Math.round(h * r);
    }
    const type = baseType(item, p.format);
    const cv = makeCanvas(w, h);
    const ctx = cv.getContext('2d');
    if (type === 'image/jpeg') { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h); }
    ctx.drawImage(item.img, 0, 0, w, h);
    const blob = await toBlob(cv, type, p.quality);
    return { blob: blob, w: w, h: h, type: type };
  }

  async function processConvert(item) {
    const p = params.convert;
    const cv = makeCanvas(item.w, item.h);
    const ctx = cv.getContext('2d');
    if (p.format === 'image/jpeg') { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, item.w, item.h); }
    ctx.drawImage(item.img, 0, 0);
    const blob = await toBlob(cv, p.format, 0.92);
    return { blob: blob, w: item.w, h: item.h, type: p.format };
  }

  async function processTransform(item) {
    const p = params.transform;
    const rot = ((p.rotate % 360) + 360) % 360;
    const swap = rot === 90 || rot === 270;
    const w = swap ? item.h : item.w;
    const h = swap ? item.w : item.h;
    const cv = makeCanvas(w, h);
    const ctx = cv.getContext('2d');
    ctx.translate(w / 2, h / 2);
    ctx.rotate(rot * Math.PI / 180);
    ctx.scale(p.flipH ? -1 : 1, p.flipV ? -1 : 1);
    ctx.drawImage(item.img, -item.w / 2, -item.h / 2);
    const type = item.type === 'image/png' ? 'image/png' : 'image/jpeg';
    const blob = await toBlob(cv, type, 0.92);
    return { blob: blob, w: w, h: h, type: type };
  }

  async function processWatermark(item) {
    const p = params.watermark;
    const cv = makeCanvas(item.w, item.h);
    const ctx = cv.getContext('2d');
    if (item.type === 'image/jpeg') { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, item.w, item.h); }
    ctx.drawImage(item.img, 0, 0);

    // 水印按图片尺寸等比缩放，避免小图水印过大
    const scale = Math.max(0.5, Math.min(1.6, Math.min(item.w, item.h) / 600));
    const fs = Math.max(10, Math.round(p.size * scale));
    const pad = Math.round(Math.min(item.w, item.h) * 0.045);

    ctx.save();
    ctx.globalAlpha = p.opacity;
    ctx.fillStyle = p.color;
    ctx.font = 'bold ' + fs + 'px "Microsoft YaHei","PingFang SC",sans-serif';
    ctx.textBaseline = 'middle';
    const hAlign = p.pos[1] === 'l' ? 'left' : p.pos[1] === 'r' ? 'right' : 'center';
    const vAlign = p.pos[0] === 't' ? 'top' : p.pos[0] === 'b' ? 'bottom' : 'middle';
    ctx.textAlign = hAlign;

    let x = p.pos[1] === 'l' ? pad : p.pos[1] === 'r' ? item.w - pad : item.w / 2;
    let y = p.pos[0] === 't' ? pad + fs / 2 : p.pos[0] === 'b' ? item.h - pad - fs / 2 : item.h / 2;

    if (p.rotate) {
      ctx.translate(x, y);
      ctx.rotate(p.rotate * Math.PI / 180);
      ctx.textBaseline = 'middle';
      ctx.fillText(p.text, 0, 0);
    } else {
      ctx.textBaseline = vAlign === 'top' ? 'top' : vAlign === 'bottom' ? 'bottom' : 'middle';
      ctx.fillText(p.text, x, y);
    }
    ctx.restore();

    const type = item.type === 'image/png' ? 'image/png' : 'image/jpeg';
    const blob = await toBlob(cv, type, 0.92);
    return { blob: blob, w: item.w, h: item.h, type: type };
  }

  async function processCollage() {
    const p = params.collage;
    const list = items;
    if (!list.length) return null;
    let cw, ch;
    if (p.dir === 'h') {
      cw = list.reduce((s, x) => s + x.w, 0) + p.gap * (list.length - 1);
      ch = Math.max.apply(null, list.map((x) => x.h));
    } else if (p.dir === 'v') {
      cw = Math.max.apply(null, list.map((x) => x.w));
      ch = list.reduce((s, x) => s + x.h, 0) + p.gap * (list.length - 1);
    } else {
      const cols = Math.max(1, Math.min(p.cols, list.length));
      const rows = Math.ceil(list.length / cols);
      const cellW = Math.max.apply(null, list.map((x) => x.w));
      const cellH = Math.max.apply(null, list.map((x) => x.h));
      cw = cols * cellW + p.gap * (cols - 1);
      ch = rows * cellH + p.gap * (rows - 1);
      const cv = makeCanvas(cw, ch);
      const ctx = cv.getContext('2d');
      ctx.fillStyle = p.bg; ctx.fillRect(0, 0, cw, ch);
      list.forEach((it, i) => {
        const r = Math.floor(i / cols), c = i % cols;
        const x = c * (cellW + p.gap) + (cellW - it.w) / 2;
        const y = r * (cellH + p.gap) + (cellH - it.h) / 2;
        ctx.drawImage(it.img, x, y);
      });
      const blob = await toBlob(cv, 'image/png');
      return { blob: blob, w: cw, h: ch, type: 'image/png', name: '拼图.png' };
    }
    const cv = makeCanvas(cw, ch);
    const ctx = cv.getContext('2d');
    ctx.fillStyle = p.bg; ctx.fillRect(0, 0, cw, ch);
    let x = 0, y = 0;
    list.forEach((it) => {
      if (p.dir === 'h') { ctx.drawImage(it.img, x, (ch - it.h) / 2); x += it.w + p.gap; }
      else { ctx.drawImage(it.img, (cw - it.w) / 2, y); y += it.h + p.gap; }
    });
    const blob = await toBlob(cv, 'image/png');
    return { blob: blob, w: cw, h: ch, type: 'image/png', name: p.dir === 'h' ? '横向拼图.png' : '纵向拼图.png' };
  }

  async function run() {
    if (busy || !items.length) return;
    busy = true;
    updateHint();

    try {
      if (op === 'collage') {
        items.forEach((it) => { it.out = null; });
        const r = await processCollage();
        if (!r) return;
        const u8 = await blobToU8(r.blob);
        items[0].out = { blob: r.blob, size: r.blob.size, w: r.w, h: r.h, type: r.type, name: r.name, url: URL.createObjectURL(r.blob), u8: u8, single: true };
        // 拼图只输出一张，清掉其余的结果
        for (let i = 1; i < items.length; i++) items[i].out = null;
        renderList(); renderPreview(); updateHint();
        FW.toast('拼图完成：' + r.w + '×' + r.h + '，' + FW.fmtSize(r.blob.size));
        downloadAll();
        return;
      }

      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        $('#imgHint').textContent = '处理中 ' + (i + 1) + ' / ' + items.length + ' …';
        let r;
        if (op === 'compress') r = await processCompress(it);
        else if (op === 'convert') r = await processConvert(it);
        else if (op === 'transform') r = await processTransform(it);
        else r = await processWatermark(it);
        const u8 = await blobToU8(r.blob);
        if (it.out && it.out.url) URL.revokeObjectURL(it.out.url);
        it.out = {
          blob: r.blob, size: r.blob.size, w: r.w, h: r.h, type: r.type,
          name: outName(it, r.type), url: URL.createObjectURL(r.blob), u8: u8
        };
      }
      renderList(); renderPreview(); updateHint();
      const total = items.reduce((s, x) => s + x.out.size, 0);
      const before = items.reduce((s, x) => s + x.size, 0);
      FW.toast('处理完成：' + items.length + ' 张，' + FW.fmtSize(before) + ' → ' + FW.fmtSize(total), 3000);
      downloadAll();
    } catch (e) {
      console.error(e);
      FW.toast('处理失败：' + e.message, 3200);
    } finally {
      busy = false;
      updateHint();
    }
  }

  async function downloadAll() {
    const outs = items.filter((x) => x.out);
    if (!outs.length) return;
    if (outs.length === 1) {
      FW.downloadBlob(outs[0].out.name, outs[0].out.blob);
      return;
    }
    // 多张打包成 zip
    const zipFiles = {};
    const used = {};
    outs.forEach((x) => {
      let n = x.out.name;
      if (used[n]) { used[n]++; n = n.replace(/(\.[^.]+)$/, '_' + used[n] + '$1'); }
      else used[n] = 1;
      zipFiles[n] = x.out.u8;
    });
    const zipped = global.fflate.zipSync(zipFiles, { level: 6 });
    FW.downloadBytes('图片处理结果.zip', zipped, 'application/zip');
  }

  /* ============================================================
     打开与事件
     ============================================================ */
  function open() {
    bind();
    renderTabs();
    renderPanel();
    renderList();
    renderPreview();
    updateHint();
    if (FW.app) FW.app.showView('image');
  }

  function bind() {
    if (bound) return;
    bound = true;

    const drop = $('#imgDrop');
    drop.addEventListener('click', async () => {
      const files = await FW.pickFile('image/*', true);
      if (files && files.length) addFiles(files);
    });
    ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
    ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
    drop.addEventListener('drop', (e) => { if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files); });

    // 整个视图都支持拖入
    const wrap = $('#view-image');
    wrap.addEventListener('dragover', (e) => e.preventDefault());
    wrap.addEventListener('drop', (e) => {
      e.preventDefault();
      if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
    });

    $('#imgOpTabs').addEventListener('click', (e) => {
      const b = e.target.closest('.img-tab');
      if (!b) return;
      op = b.dataset.op;
      renderTabs();
      renderPanel();
    });

    $('#imgList').addEventListener('click', (e) => {
      const d = e.target.closest('[data-del]');
      if (d) {
        const i = +d.dataset.del;
        if (items[i] && items[i].out && items[i].out.url) URL.revokeObjectURL(items[i].out.url);
        items.splice(i, 1);
        renderList(); renderPreview(); updateHint(); renderPanel();
        return;
      }
      const it = e.target.closest('.img-item');
      if (it) {
        const i = +it.dataset.i;
        $$('.img-item').forEach((x) => x.classList.remove('sel'));
        it.classList.add('sel');
        const box = $('#imgPreview');
        const t = items[i];
        if (t) {
          const src = t.out ? t.out.url : t.url;
          box.innerHTML = '<img src="' + src + '" alt="">' +
            '<div class="ip-meta"><span>' + FW.escapeHtml(t.name) + ' · ' + t.w + '×' + t.h + ' · ' + FW.fmtSize(t.size) + '</span>' +
            (t.out ? '<span class="ip-arrow">→</span><span class="ip-new">' + t.out.w + '×' + t.out.h + ' · ' + FW.fmtSize(t.out.size) + '</span>' : '') +
            '</div>';
        }
      }
    });

    $('#imgClear').addEventListener('click', () => {
      items.forEach((x) => { if (x.out && x.out.url) URL.revokeObjectURL(x.out.url); });
      items = [];
      renderList(); renderPreview(); updateHint(); renderPanel();
    });

    $('#imgRun').addEventListener('click', run);
  }

  global.IMGTOOLS = { open: open, addFiles: addFiles, getItems: () => items };
})(window);
