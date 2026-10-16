/* ============================================================
   editor-slide.js — 演示文稿编辑器
   ============================================================ */
(function (global) {
  'use strict';
  const FW = global.FW, $ = FW.$, $$ = FW.$$;
  const uid = FW.uid;

  let doc = null, cur = 0, selShape = null, onChange = null;
  let scale = 1, presenting = false, presentIdx = 0;
  let drag = null, bound = false;
  const stage = () => $('#slideStage');
  const canvas = () => $('#slideCanvas');

  const THEMES = {
    fresh: { name: '清新白', bg: '#FFFFFF', title: '#1F2328', sub: '#6B7280', accent: '#2B7FE0' },
    blue: { name: '商务蓝', bg: '#0F2C52', title: '#FFFFFF', sub: '#A9C4E4', accent: '#4FA3FF' },
    dark: { name: '暗夜黑', bg: '#17191D', title: '#F5F7FA', sub: '#9AA2AD', accent: '#F2994A' },
    warm: { name: '暖阳橙', bg: '#FFF6EE', title: '#7A3B12', sub: '#B4764A', accent: '#E8762B' },
    green: { name: '生态绿', bg: '#F1F8F4', title: '#15472C', sub: '#4E7C63', accent: '#21A366' },
    gradient: { name: '渐变紫', bg: 'linear-gradient(135deg,#4C1D95 0%,#7C3AED 55%,#DB2777 100%)', title: '#FFFFFF', sub: '#E9D5FF', accent: '#FDE68A' }
  };

  const LAYOUTS = [
    { id: 'title', name: '标题页', build: (T) => [
      { type: 'text', x: 90, y: 185, w: 780, h: 96, text: '点击输入标题', size: 46, bold: true, color: T.title, align: 'center', valign: 'middle' },
      { type: 'text', x: 90, y: 296, w: 780, h: 52, text: '点击输入副标题 / 汇报人', size: 20, bold: false, color: T.sub, align: 'center', valign: 'middle' },
      { type: 'rect', x: 400, y: 272, w: 160, h: 4, fill: T.accent, line: null }
    ] },
    { id: 'titleContent', name: '标题+内容', build: (T) => [
      { type: 'text', x: 70, y: 46, w: 820, h: 64, text: '章节标题', size: 32, bold: true, color: T.title, align: 'left', valign: 'middle' },
      { type: 'rect', x: 70, y: 112, w: 96, h: 5, fill: T.accent, line: null },
      { type: 'text', x: 70, y: 150, w: 820, h: 330, text: '· 第一个要点\n· 第二个要点\n· 第三个要点', size: 20, bold: false, color: T.sub, align: 'left', valign: 'top' }
    ] },
    { id: 'twoCol', name: '两栏对比', build: (T) => [
      { type: 'text', x: 70, y: 46, w: 820, h: 60, text: '对比分析', size: 32, bold: true, color: T.title, align: 'left', valign: 'middle' },
      { type: 'rect', x: 70, y: 150, w: 380, h: 320, fill: T.accent, line: null },
      { type: 'rect', x: 510, y: 150, w: 380, h: 320, fill: T.sub, line: null },
      { type: 'text', x: 90, y: 170, w: 340, h: 280, text: '方案 A\n\n优势说明……', size: 18, bold: false, color: '#FFFFFF', align: 'left', valign: 'top' },
      { type: 'text', x: 530, y: 170, w: 340, h: 280, text: '方案 B\n\n优势说明……', size: 18, bold: false, color: '#FFFFFF', align: 'left', valign: 'top' }
    ] },
    { id: 'section', name: '章节过渡', build: (T) => [
      { type: 'rect', x: 0, y: 0, w: 960, h: 540, fill: T.accent, line: null },
      { type: 'text', x: 90, y: 210, w: 780, h: 80, text: '第一部分', size: 48, bold: true, color: '#FFFFFF', align: 'center', valign: 'middle' },
      { type: 'text', x: 90, y: 300, w: 780, h: 44, text: '在这里说明本章内容', size: 20, bold: false, color: 'rgba(255,255,255,.85)', align: 'center', valign: 'middle' }
    ] },
    { id: 'blank', name: '空白页', build: () => [] }
  ];

  function theme() { return THEMES[doc.data.theme] || THEMES.fresh; }
  function slides() { return doc.data.slides; }
  function slide() { return slides()[cur]; }

  /* ---------- 渲染 ---------- */
  function shapeStyle(sh) {
    const st = ['left:' + sh.x + 'px', 'top:' + sh.y + 'px', 'width:' + sh.w + 'px', 'height:' + sh.h + 'px'];
    if (sh.type === 'text') {
      st.push('display:flex', 'flex-direction:column');
      st.push('justify-content:' + (sh.valign === 'middle' ? 'center' : sh.valign === 'bottom' ? 'flex-end' : 'flex-start'));
      st.push('font-size:' + (sh.size || 18) + 'px');
      st.push('color:' + (sh.color || '#1F2328'));
      st.push('text-align:' + (sh.align || 'left'));
      if (sh.bold) st.push('font-weight:700');
      if (sh.italic) st.push('font-style:italic');
      if (sh.underline) st.push('text-decoration:underline');
      if (sh.lineHeight) st.push('line-height:' + sh.lineHeight);
      else st.push('line-height:1.35');
      if (sh.fill) st.push('background:' + sh.fill);
      if (sh.line) st.push('border:' + (sh.lineW || 1) + 'px solid ' + sh.line);
    } else {
      if (sh.fill) st.push('background:' + sh.fill);
      if (sh.line) st.push('border:' + (sh.lineW || 2) + 'px solid ' + sh.line);
      if (sh.type === 'ellipse') st.push('border-radius:50%');
      if (sh.type === 'line') { st.push('height:' + Math.max(1, sh.h) + 'px'); st.push('background:' + (sh.fill || '#333')); }
    }
    if (sh.rotate) st.push('transform:rotate(' + sh.rotate + 'deg)');
    return st.join(';');
  }

  function shapeHtml(sh, forEdit) {
    const inner = sh.type === 'text'
      ? (forEdit ? '' : FW.escapeHtml(String(sh.text == null ? '' : sh.text)).replace(/\n/g, '<br>'))
      : '';
    return '<div class="shape ' + sh.type + (selShape === sh.id && forEdit ? ' sel' : '') + '" data-id="' + sh.id + '" style="' + shapeStyle(sh) + '">' + inner + '</div>';
  }

  function renderCanvas() {
    const c = canvas();
    const sl = slide();
    const T = theme();
    c.style.background = sl.bg || T.bg;
    c.style.width = doc.data.size.w + 'px';
    c.style.height = doc.data.size.h + 'px';
    c.innerHTML = sl.shapes.map((sh) => shapeHtml(sh, true)).join('') +
      (sl.shapes.length ? '' : '<div class="empty-hint">空白页 · 从「插入」选项卡添加文本框或形状</div>');
    if (selShape) addHandles();
    fitStage();
    renderThumbs();
    $('#slideCounter').textContent = (cur + 1) + ' / ' + slides().length;
  }

  function addHandles() {
    const c = canvas();
    const el = c.querySelector('.shape[data-id="' + selShape + '"]');
    if (!el) return;
    const sh = slides()[cur].shapes.find((s) => s.id === selShape);
    if (!sh) return;
    const pos = [['nw', 0, 0], ['ne', 1, 0], ['sw', 0, 1], ['se', 1, 1]];
    pos.forEach((p) => {
      const h = document.createElement('div');
      h.className = 'slide-handle';
      h.dataset.dir = p[0];
      h.style.left = (sh.x + sh.w * p[1] - 5) + 'px';
      h.style.top = (sh.y + sh.h * p[2] - 5) + 'px';
      h.style.cursor = (p[0] === 'nw' || p[0] === 'se') ? 'nwse-resize' : 'nesw-resize';
      c.appendChild(h);
    });
  }

  function fitStage() {
    const box = stage();
    if (!box) return;
    const pad = 44;
    const sw = box.clientWidth - pad, sh = box.clientHeight - pad;
    const W = doc.data.size.w, H = doc.data.size.h;
    scale = Math.min(sw / W, sh / H, 1.25);
    scale = Math.max(0.2, scale);
    canvas().style.transform = 'scale(' + scale + ')';
    canvas().style.margin = ((H * scale - H) / 2) + 'px ' + ((W * scale - W) / 2) + 'px';
  }

  function renderThumbs() {
    const box = $('#slideThumbs');
    const W = doc.data.size.w, H = doc.data.size.h;
    const mini = 150 / W;
    box.innerHTML = slides().map((sl, i) => {
      const inner = sl.shapes.map((sh) => shapeHtml(sh, false)).join('');
      return '<div class="sl-thumb' + (i === cur ? ' active' : '') + '" data-i="' + i + '">' +
        '<span class="num">' + (i + 1) + '</span>' +
        '<div class="sl-mini"><div style="position:absolute;left:0;top:0;width:' + W + 'px;height:' + H + 'px;' +
        'transform:scale(' + mini + ');transform-origin:top left;background:' + (sl.bg || theme().bg) + '">' + inner + '</div></div></div>';
    }).join('');
  }

  function emit() { if (onChange) onChange(); }

  /* ---------- 交互 ---------- */
  function bindEvents() {
    if (bound) return;
    bound = true;
    const c = canvas();

    c.addEventListener('mousedown', (e) => {
      const handle = e.target.closest('.slide-handle');
      const el = e.target.closest('.shape');
      if (handle) {
        const sh = slide().shapes.find((s) => s.id === selShape);
        if (!sh) return;
        drag = { mode: 'resize', dir: handle.dataset.dir, sx: e.clientX, sy: e.clientY, o: Object.assign({}, sh), id: sh.id };
        e.preventDefault(); return;
      }
      if (!el) { selShape = null; renderCanvas(); return; }
      const id = el.dataset.id;
      selShape = id;
      const sh = slide().shapes.find((s) => s.id === id);
      if (el.getAttribute('contenteditable') === 'true') { return; }
      drag = { mode: 'move', sx: e.clientX, sy: e.clientY, o: Object.assign({}, sh), id: id, moved: false };
      renderCanvas();
    });

    window.addEventListener('mousemove', (e) => {
      if (!drag || presenting) return;
      const dx = (e.clientX - drag.sx) / scale;
      const dy = (e.clientY - drag.sy) / scale;
      if (Math.abs(dx) > 1 || Math.abs(dy) > 1) drag.moved = true;
      const sh = slide().shapes.find((s) => s.id === drag.id);
      if (!sh) return;
      if (drag.mode === 'move') {
        sh.x = Math.round(Math.max(-sh.w / 2, Math.min(doc.data.size.w - sh.w / 2, drag.o.x + dx)));
        sh.y = Math.round(Math.max(-sh.h / 2, Math.min(doc.data.size.h - sh.h / 2, drag.o.y + dy)));
        if (e.shiftKey) { // 水平/垂直约束
          if (Math.abs(dx) > Math.abs(dy)) sh.y = drag.o.y; else sh.x = drag.o.x;
        }
      } else {
        const d = drag.dir;
        let x = drag.o.x, y = drag.o.y, w = drag.o.w, h = drag.o.h;
        if (d.indexOf('e') >= 0) w = Math.max(24, drag.o.w + dx);
        if (d.indexOf('s') >= 0) h = Math.max(18, drag.o.h + dy);
        if (d.indexOf('w') >= 0) { w = Math.max(24, drag.o.w - dx); x = drag.o.x + (drag.o.w - w); }
        if (d.indexOf('n') >= 0) { h = Math.max(18, drag.o.h - dy); y = drag.o.y + (drag.o.h - h); }
        sh.x = Math.round(x); sh.y = Math.round(y); sh.w = Math.round(w); sh.h = Math.round(h);
      }
      renderCanvas();
    });

    window.addEventListener('mouseup', () => {
      if (drag && drag.moved) emit();
      drag = null;
    });

    c.addEventListener('dblclick', async (e) => {
      const el = e.target.closest('.shape');
      if (!el) return;
      const sh = slide().shapes.find((s) => s.id === el.dataset.id);
      if (!sh) return;
      if (sh.type !== 'text') {
        const t = await FW.prompt('输入形状上的文字：', sh.text || '', { title: '形状文字', multiline: true, rows: 2 });
        if (t != null) { sh.text = t; sh.type = 'text'; renderCanvas(); emit(); }
        return;
      }
      selShape = sh.id;
      el.setAttribute('contenteditable', 'true');
      el.style.display = 'block';
      el.style.whiteSpace = 'pre-wrap';
      el.focus();
      const r = document.createRange(); r.selectNodeContents(el);
      const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
      const save = () => {
        el.removeAttribute('contenteditable');
        sh.text = el.innerText.replace(/\u00a0/g, ' ');
        renderCanvas(); emit();
      };
      el.addEventListener('blur', save, { once: true });
      el.addEventListener('keydown', (ev) => {
        if (ev.key === 'Escape') { el.blur(); }
        ev.stopPropagation();
      });
    });

    $('#slideThumbs').addEventListener('click', (e) => {
      const t = e.target.closest('.sl-thumb');
      if (!t) return;
      cur = +t.dataset.i; selShape = null; renderCanvas();
    });

    $('#btnSlidePrev').addEventListener('click', () => { if (cur > 0) { cur--; selShape = null; renderCanvas(); } });
    $('#btnSlideNext').addEventListener('click', () => { if (cur < slides().length - 1) { cur++; selShape = null; renderCanvas(); } });
    $('#btnPresent').addEventListener('click', () => startPresent(cur));

    $('#prPrev').addEventListener('click', () => gotoPresent(presentIdx - 1));
    $('#prNext').addEventListener('click', () => gotoPresent(presentIdx + 1));
    $('#prExit').addEventListener('click', stopPresent);
    window.addEventListener('resize', () => { if (global.FW.app && global.FW.app.current() === 'slide') fitStage(); });
    document.addEventListener('keydown', onKey, true);
  }

  function onKey(e) {
    if (presenting) {
      if (e.key === 'Escape') { stopPresent(); e.preventDefault(); }
      else if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') { gotoPresent(presentIdx + 1); e.preventDefault(); }
      else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { gotoPresent(presentIdx - 1); e.preventDefault(); }
      return;
    }
    if (!global.FW.app || global.FW.app.current() !== 'slide') return;
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || e.target.isContentEditable) return;
    if (!selShape) return;
    const sh = slide().shapes.find((s) => s.id === selShape);
    if (!sh) return;
    const step = e.shiftKey ? 10 : 1;
    if (e.key === 'ArrowLeft') { sh.x -= step; }
    else if (e.key === 'ArrowRight') { sh.x += step; }
    else if (e.key === 'ArrowUp') { sh.y -= step; }
    else if (e.key === 'ArrowDown') { sh.y += step; }
    else if (e.key === 'Delete' || e.key === 'Backspace') { delShape(); e.preventDefault(); return; }
    else return;
    e.preventDefault(); renderCanvas(); emit();
  }

  /* ---------- 放映 ---------- */
  function startPresent(idx) {
    presenting = true; presentIdx = idx == null ? cur : idx;
    $('#presentMode').classList.add('on');
    gotoPresent(presentIdx);
  }
  function stopPresent() {
    presenting = false;
    $('#presentMode').classList.remove('on');
    $('#presentStage').innerHTML = '';
  }
  function gotoPresent(i) {
    if (i < 0 || i >= slides().length) return;
    presentIdx = i;
    const sl = slides()[i];
    const T = theme();
    const W = doc.data.size.w, H = doc.data.size.h;
    const box = $('#presentStage');
    const sc = Math.min(box.clientWidth / W, box.clientHeight / H);
    const tr = sl.transition || 'fade';
    const anim = { fade: 'fadeIn .32s ease', slide: 'slideIn .32s ease', zoom: 'zoomIn .3s ease', wipe: 'wipeIn .38s ease', none: 'none' }[tr] || 'fadeIn .32s ease';
    box.innerHTML = '<div class="slide-canvas" style="width:' + W + 'px;height:' + H + 'px;background:' + (sl.bg || T.bg) +
      ';transform:scale(' + sc + ');animation:' + anim + '">' + sl.shapes.map((sh) => shapeHtml(sh, false)).join('') + '</div>';
    $('#prCount').textContent = (i + 1) + ' / ' + slides().length;
  }

  /* ---------- 功能区 ---------- */
  const ribbon = [
    {
      tab: '开始', groups: [
        {
          label: '幻灯片', items: [
            { t: 'btn', g: '＋', label: '新建', cmd: 'newSlide', wide: true },
            { t: 'btn', g: '⧉', label: '复制', cmd: 'dupSlide', wide: true },
            { t: 'btn', g: '🗑', label: '删除', cmd: 'delSlide', wide: true },
            { t: 'btn', g: '↑', label: '上移', cmd: 'moveUp' },
            { t: 'btn', g: '↓', label: '下移', cmd: 'moveDown' }
          ]
        },
        {
          label: '版式', items: [
            { t: 'btn', g: '▤', label: '标题页', cmd: 'layout:title', wide: true },
            { t: 'btn', g: '▥', label: '标题+内容', cmd: 'layout:titleContent', wide: true },
            { t: 'btn', g: '▦', label: '两栏', cmd: 'layout:twoCol', wide: true },
            { t: 'btn', g: '▨', label: '章节页', cmd: 'layout:section', wide: true },
            { t: 'btn', g: '▢', label: '空白', cmd: 'layout:blank', wide: true }
          ]
        },
        {
          label: '主题', items: Object.keys(THEMES).map((k) => ({ t: 'btn', g: '◉', label: THEMES[k].name, cmd: 'theme:' + k, wide: true, color: THEMES[k].accent }))
        }
      ]
    },
    {
      tab: '插入', groups: [
        {
          label: '文本', items: [
            { t: 'btn', g: 'T', label: '文本框', cmd: 'addText', wide: true },
            { t: 'btn', g: 'H', label: '大标题', cmd: 'addTitle', wide: true },
            { t: 'btn', g: '¶', label: '要点列表', cmd: 'addBullets', wide: true }
          ]
        },
        {
          label: '形状', items: [
            { t: 'btn', g: '▭', label: '矩形', cmd: 'addRect' },
            { t: 'btn', g: '◯', label: '圆形', cmd: 'addEllipse' },
            { t: 'btn', g: '╱', label: '直线', cmd: 'addLine' },
            { t: 'btn', g: '▶', label: '三角形', cmd: 'addTriangle' },
            { t: 'btn', g: '★', label: '五角星', cmd: 'addStar' }
          ]
        },
        {
          label: '媒体', items: [
            { t: 'btn', g: '🖼', label: '图片', cmd: 'addImage', wide: true }
          ]
        }
      ]
    },
    {
      tab: '格式', groups: [
        {
          label: '文字', items: [
            { t: 'btn', g: 'B', label: '加粗', cmd: 'bold', style: 'font-weight:800' },
            { t: 'btn', g: 'I', label: '斜体', cmd: 'italic', style: 'font-style:italic' },
            { t: 'btn', g: 'U', label: '下划线', cmd: 'underline', style: 'text-decoration:underline' },
            { t: 'color', g: 'A', label: '字体颜色', cmd: 'color', value: '#D93B2B' },
            { t: 'select', cmd: 'fontSize', width: 66, options: [12, 14, 16, 18, 20, 24, 28, 32, 40, 48, 56, 64, 80].map((s) => ({ v: s, t: s })) },
            { t: 'btn', g: '≡', label: '左', cmd: 'align:left' },
            { t: 'btn', g: '≡', label: '中', cmd: 'align:center' },
            { t: 'btn', g: '≡', label: '右', cmd: 'align:right' }
          ]
        },
        {
          label: '形状', items: [
            { t: 'color', g: '▨', label: '填充', cmd: 'fill', value: '#2B7FE0' },
            { t: 'color', g: '□', label: '边框', cmd: 'line', value: '#1F2328' },
            { t: 'btn', g: '⧉', label: '复制形状', cmd: 'dupShape', wide: true },
            { t: 'btn', g: '🗑', label: '删除形状', cmd: 'delShape', wide: true },
            { t: 'btn', g: '⤒', label: '置于顶层', cmd: 'front', wide: true },
            { t: 'btn', g: '⤓', label: '置于底层', cmd: 'back', wide: true }
          ]
        },
        {
          label: '对齐', items: [
            { t: 'btn', g: '⇤', label: '左对齐', cmd: 'alignL' },
            { t: 'btn', g: '⇹', label: '水平居中', cmd: 'alignC' },
            { t: 'btn', g: '⇥', label: '右对齐', cmd: 'alignR' },
            { t: 'btn', g: '⬒', label: '垂直居中', cmd: 'alignM' },
            { t: 'btn', g: '⇱', label: '铺满画布', cmd: 'alignFull', wide: true }
          ]
        }
      ]
    },
    {
      tab: '切换', groups: [
        {
          label: '页面切换动画', items: [
            { t: 'btn', g: '○', label: '无', cmd: 'trans:none', wide: true },
            { t: 'btn', g: '◐', label: '淡入淡出', cmd: 'trans:fade', wide: true },
            { t: 'btn', g: '⇢', label: '推入', cmd: 'trans:slide', wide: true },
            { t: 'btn', g: '⤢', label: '缩放', cmd: 'trans:zoom', wide: true },
            { t: 'btn', g: '◧', label: '擦除', cmd: 'trans:wipe', wide: true }
          ]
        },
        {
          label: '背景', items: [
            { t: 'color', g: '▤', label: '自定义背景', cmd: 'slideBg', value: '#FFFFFF' },
            { t: 'btn', g: '⟲', label: '恢复主题背景', cmd: 'slideBg:reset', wide: true }
          ]
        }
      ]
    },
    {
      tab: '放映', groups: [
        {
          label: '开始放映', items: [
            { t: 'btn', g: '▶', label: '从头放映', cmd: 'present:0', wide: true },
            { t: 'btn', g: '▶', label: '从当前页放映', cmd: 'present:here', wide: true }
          ]
        },
        {
          label: '导出', items: [
            { t: 'btn', g: 'P', label: '导出 PPTX', cmd: 'export:pptx', wide: true },
            { t: 'btn', g: '<>', label: '导出网页', cmd: 'export:html', wide: true },
            { t: 'btn', g: 'P', label: '打印 / PDF', cmd: 'print', wide: true }
          ]
        }
      ]
    }
  ];

  /* ---------- 模块接口 ---------- */
  global.FW.Editors = global.FW.Editors || {};
  global.FW.Editors.slide = {
    badge: '演示',
    badgeCls: 'slide',
    ribbon: ribbon,

    mount(d) {
      doc = d;
      if (!doc.data.slides || !doc.data.slides.length) {
        doc.data.slides = [{ layout: 'title', bg: null, shapes: LAYOUTS[0].build(THEMES.fresh).map((s) => Object.assign({ id: uid() }, s)) }];
      }
      doc.data.size = doc.data.size || { w: 960, h: 540 };
      cur = 0; selShape = null; presenting = false;
      renderCanvas();
      bindEvents();
    },

    unmount() {
      if (presenting) stopPresent();
      selShape = null;
    },

    getData() { return doc.data; },
    setChangeHandler(fn) { onChange = fn; },

    cmd(name, value) {
      const T = theme();
      const W = doc.data.size.w, H = doc.data.size.h;

      if (name === 'newSlide') {
        const last = slides()[cur];
        const layout = last && last.layout === 'title' ? 'titleContent' : 'titleContent';
        const lay = LAYOUTS.find((l) => l.id === layout);
        slides().splice(cur + 1, 0, { layout: layout, bg: null, shapes: lay.build(T).map((s) => Object.assign({ id: uid() }, s)) });
        cur++; selShape = null; renderCanvas(); emit(); return;
      }
      if (name === 'dupSlide') {
        const cp = JSON.parse(JSON.stringify(slide()));
        cp.shapes.forEach((s) => { s.id = uid(); s.x += 16; s.y += 16; });
        slides().splice(cur + 1, 0, cp); cur++; selShape = null; renderCanvas(); emit(); return;
      }
      if (name === 'delSlide') {
        if (slides().length <= 1) { FW.toast('至少保留一页'); return; }
        slides().splice(cur, 1); cur = Math.max(0, cur - 1); selShape = null; renderCanvas(); emit(); return;
      }
      if (name === 'moveUp') { if (cur > 0) { const s = slides().splice(cur, 1)[0]; slides().splice(cur - 1, 0, s); cur--; renderCanvas(); emit(); } return; }
      if (name === 'moveDown') { if (cur < slides().length - 1) { const s = slides().splice(cur, 1)[0]; slides().splice(cur + 1, 0, s); cur++; renderCanvas(); emit(); } return; }

      if (name.indexOf('layout:') === 0) {
        const lay = LAYOUTS.find((l) => l.id === name.slice(7));
        if (!lay) return;
        if (slide().shapes.length && !confirm('套用版式会替换当前页的内容，继续吗？')) return;
        slide().layout = lay.id;
        slide().shapes = lay.build(T).map((s) => Object.assign({ id: uid() }, s));
        selShape = null; renderCanvas(); emit(); return;
      }
      if (name.indexOf('theme:') === 0) {
        doc.data.theme = name.slice(6);
        const NT = theme();
        slides().forEach((sl) => {
          sl.shapes.forEach((sh) => {
            if (sh.type === 'text' && sh._auto !== false) {
              if (sh.size >= 30) sh.color = NT.title;
              else if (sh.size <= 22) sh.color = NT.sub;
            }
          });
        });
        renderCanvas(); emit(); FW.toast('已应用主题：' + NT.name); return;
      }
      if (name.indexOf('trans:') === 0) { slide().transition = name.slice(6); emit(); FW.toast('已设置切换动画'); return; }
      if (name === 'present:0') { startPresent(0); return; }
      if (name === 'present:here') { startPresent(cur); return; }
      if (name === 'slideBg') { slide().bg = value; renderCanvas(); emit(); return; }
      if (name === 'slideBg:reset') { slide().bg = null; renderCanvas(); emit(); return; }

      /* 插入 */
      if (name === 'addText') return addShape({ type: 'text', x: W / 2 - 200, y: H / 2 - 40, w: 400, h: 80, text: '输入文字', size: 22, color: T.title, align: 'left', valign: 'middle' });
      if (name === 'addTitle') return addShape({ type: 'text', x: 80, y: 60, w: W - 160, h: 80, text: '标题文字', size: 40, bold: true, color: T.title, align: 'left', valign: 'middle' });
      if (name === 'addBullets') return addShape({ type: 'text', x: 90, y: 170, w: W - 200, h: 260, text: '· 要点一\n· 要点二\n· 要点三', size: 22, color: T.sub, align: 'left', valign: 'top' });
      if (name === 'addRect') return addShape({ type: 'rect', x: W / 2 - 130, y: H / 2 - 80, w: 260, h: 160, fill: T.accent, line: null });
      if (name === 'addEllipse') return addShape({ type: 'ellipse', x: W / 2 - 90, y: H / 2 - 90, w: 180, h: 180, fill: T.accent, line: null });
      if (name === 'addLine') return addShape({ type: 'line', x: W / 2 - 150, y: H / 2, w: 300, h: 4, fill: T.accent, line: null });
      if (name === 'addTriangle') return addShape({ type: 'triangle', x: W / 2 - 90, y: H / 2 - 80, w: 180, h: 160, fill: T.accent, line: null });
      if (name === 'addStar') return addShape({ type: 'star', x: W / 2 - 90, y: H / 2 - 90, w: 180, h: 180, fill: '#F5B301', line: null });
      if (name === 'addImage') {
        FW.pickFile('image/*').then((f) => {
          if (!f) return;
          FW.readAsDataURL(f).then((url) => {
            const img = new Image();
            img.onload = () => {
              const maxW = W * 0.6;
              const r = Math.min(maxW / img.width, (H * 0.6) / img.height, 1);
              addShape({ type: 'image', src: url, x: (W - img.width * r) / 2, y: (H - img.height * r) / 2, w: img.width * r, h: img.height * r });
            };
            img.src = url;
          });
        });
        return;
      }

      /* 格式 */
      const sh = selShape ? slide().shapes.find((s) => s.id === selShape) : null;
      const needShape = ['bold', 'italic', 'underline', 'color', 'fontSize', 'align:left', 'align:center', 'align:right', 'fill', 'line', 'dupShape', 'delShape', 'front', 'back', 'alignL', 'alignC', 'alignR', 'alignM', 'alignFull'];
      if (needShape.indexOf(name) >= 0 && !sh) { FW.toast('请先选中一个形状'); return; }

      if (name === 'bold') { sh.bold = !sh.bold; }
      else if (name === 'italic') { sh.italic = !sh.italic; }
      else if (name === 'underline') { sh.underline = !sh.underline; }
      else if (name === 'color') { sh.color = value; }
      else if (name === 'fontSize') { sh.size = parseInt(value, 10); }
      else if (name.indexOf('align:') === 0) { sh.align = name.slice(6); }
      else if (name === 'fill') { sh.fill = value; }
      else if (name === 'line') { sh.line = value; sh.lineW = sh.lineW || 2; }
      else if (name === 'dupShape') {
        const cp = JSON.parse(JSON.stringify(sh)); cp.id = uid(); cp.x += 18; cp.y += 18;
        slide().shapes.push(cp); selShape = cp.id; renderCanvas(); emit(); return;
      }
      else if (name === 'delShape') { delShape(); return; }
      else if (name === 'front') { const arr = slide().shapes; arr.splice(arr.indexOf(sh), 1); arr.push(sh); renderCanvas(); emit(); return; }
      else if (name === 'back') { const arr = slide().shapes; arr.splice(arr.indexOf(sh), 1); arr.unshift(sh); renderCanvas(); emit(); return; }
      else if (name === 'alignL') sh.x = 0;
      else if (name === 'alignR') sh.x = W - sh.w;
      else if (name === 'alignC') sh.x = Math.round((W - sh.w) / 2);
      else if (name === 'alignM') sh.y = Math.round((H - sh.h) / 2);
      else if (name === 'alignFull') { sh.x = 0; sh.y = 0; sh.w = W; sh.h = H; }
      else return;

      renderCanvas(); emit();
    },

    undo() { FW.toast('演示文稿暂不支持逐步撤销'); },
    redo() { FW.toast('演示文稿暂不支持逐步重做'); },

    status() {
      const sl = slide();
      return '<span>第 ' + (cur + 1) + ' / ' + slides().length + ' 页</span>' +
        '<span>形状：' + sl.shapes.length + '</span>' +
        (selShape ? '<span>已选中：' + (sl.shapes.find((s) => s.id === selShape) || {}).type + '</span>' : '') +
        '<span class="sp"></span><span>主题：' + theme().name + '</span>' +
        '<span>画布：' + doc.data.size.w + '×' + doc.data.size.h + '</span>';
    },

    exports: [
      { id: 'pptx', icon: 'P', title: 'PowerPoint 演示文稿 (.pptx)', desc: '生成真实 Office 文件，可用 PowerPoint 打开', ext: 'pptx' },
      { id: 'html', icon: '<>', title: '网页幻灯片 (.html)', desc: '所有页面排列成网页，可直接分享', ext: 'html' },
      { id: 'pdf', icon: 'P', title: '打印 / 另存为 PDF', desc: '调用系统打印输出 PDF', ext: 'pdf' },
      { id: 'png', icon: '🖼', title: '导出当前页为图片 (.png)', desc: '将当前幻灯片渲染为 PNG 图片', ext: 'png' },
      { id: 'json', icon: '{}', title: 'ForFree 工程文件 (.json)', desc: '无损保存，可再次导入继续编辑', ext: 'json' }
    ]
  };

  function addShape(sh) {
    sh.id = uid();
    sh._auto = false;
    slide().shapes.push(sh);
    selShape = sh.id;
    renderCanvas(); emit();
  }

  function delShape() {
    if (!selShape) return;
    const arr = slide().shapes;
    const i = arr.findIndex((s) => s.id === selShape);
    if (i >= 0) arr.splice(i, 1);
    selShape = null;
    renderCanvas(); emit();
  }

  global.FW.SlideHelpers = { THEMES: THEMES, LAYOUTS: LAYOUTS };
})(window);
