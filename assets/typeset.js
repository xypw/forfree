/* ============================================================
   typeset.js — 智能排版
   智能排版：一键把全文格式规范化。
   统一字体字号、标题层级、首行缩进、行距段距，
   并可选做中英文间加空格、标点全角化、清理空行与杂色。
   ============================================================ */
(function (global) {
  'use strict';
  const FW = global.FW, $ = FW.$, $$ = FW.$$;

  const DEFAULT_OPTIONS = {
    fontCN: '宋体',
    fontEN: 'Calibri',
    bodySize: 16,        // px，约等于小四（12pt）
    h1Size: 24, h2Size: 20, h3Size: 17,
    lineHeight: 1.75,
    indent: 2,           // 首行缩进字符数，0 = 不缩进
    spaceAfter: 6,       // 段后间距 px
    headingSpacing: 14,  // 标题段前段后 px
    align: 'justify',    // 正文对齐：left | justify
    clearColor: true,    // 清除行内杂色与杂字体
    cnEnSpace: true,     // 中英文之间加空格
    fullPunct: true,     // 标点全角化
    trimBlank: true,     // 清理多余空行
    unifyHeading: true   // 按大纲重排标题层级
  };

  let opts = Object.assign({}, DEFAULT_OPTIONS);
  let saved = null;

  const CJK_CLS = '[\u4e00-\u9fa5]';   // 注意：范围必须放进方括号，否则会被当成字面量

  function addCnEnSpace(text) {
    let t = String(text);
    // 中文 + 英数 → 中间补空格
    t = t.replace(new RegExp('(' + CJK_CLS + ')([A-Za-z0-9@#$%&])', 'g'), '$1 $2');
    // 英数（含收尾符号）+ 中文 → 中间补空格
    t = t.replace(new RegExp('([A-Za-z0-9!%.,:;?)\\]}])(' + CJK_CLS + ')', 'g'), '$1 $2');
    // 去掉可能产生的重复空格
    t = t.replace(/ {2,}/g, ' ');
    return t;
  }

  function fullWidthPunct(text) {
    let t = String(text);
    // 只在与中文相邻时才转换，避免误伤英文句子和小数
    t = t.replace(new RegExp('(' + CJK_CLS + '),', 'g'), '$1\uff0c');
    t = t.replace(new RegExp(',(' + CJK_CLS + ')', 'g'), '\uff0c$1');
    t = t.replace(new RegExp('(' + CJK_CLS + ');', 'g'), '$1\uff1b');
    t = t.replace(new RegExp('(' + CJK_CLS + '):', 'g'), '$1\uff1a');
    t = t.replace(new RegExp('(' + CJK_CLS + ')!', 'g'), '$1\uff01');
    t = t.replace(new RegExp('(' + CJK_CLS + ')\\?', 'g'), '$1\uff1f');
    t = t.replace(new RegExp('(' + CJK_CLS + ')\\.(?=\\s|$)', 'g'), '$1\u3002');
    t = t.replace(new RegExp('(' + CJK_CLS + ')\\(', 'g'), '$1\uff08');
    t = t.replace(new RegExp('\\)(' + CJK_CLS + ')', 'g'), '\uff09$1');
    return t;
  }

  function transformTextNodes(root, fn) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    const list = [];
    while (walker.nextNode()) list.push(walker.currentNode);
    list.forEach((n) => {
      const parent = n.parentNode;
      if (!parent) return;
      const tag = (parent.tagName || '').toLowerCase();
      if (tag === 'pre' || tag === 'code' || tag === 'style' || tag === 'script') return;
      const next = fn(n.nodeValue);
      if (next !== n.nodeValue) n.nodeValue = next;
    });
  }

  /* ============================================================
     二、结构级处理
     ============================================================ */
  function unifyHeadings(root) {
    // 按出现顺序把标题重新分配为 h1 / h2 / h3：
    // 第一个标题为 h1，之后同级或更深的重排为 h2 / h3
    const heads = Array.prototype.filter.call(root.querySelectorAll('h1,h2,h3,h4,h5,h6'), (h) => h.textContent.trim());
    if (!heads.length) return 0;
    let changed = 0;
    // 用原层级做参考：h1/h2 归为一级，h3/h4 归二级，其余归三级
    const first = heads[0];
    heads.forEach((h) => {
      const lv = parseInt(h.tagName.slice(1), 10);
      let target = 'h2';
      if (h === first) target = 'h1';
      else if (lv <= 2) target = 'h1';
      else if (lv === 3 || lv === 4) target = 'h2';
      else target = 'h3';
      if (h.tagName.toLowerCase() !== target) {
        const el = document.createElement(target);
        el.innerHTML = h.innerHTML;
        h.parentNode.replaceChild(el, h);
        changed++;
      }
    });
    return changed;
  }

  function stripInlineFormatting(root) {
    // 清掉行内的杂色、杂字体、杂字号，只保留 粗/斜/下划线/删除线 等语义标记
    let n = 0;
    Array.prototype.forEach.call(root.querySelectorAll('[style]'), (el) => {
      const tag = (el.tagName || '').toLowerCase();
      if (tag === 'table' || tag === 'td' || tag === 'th') return;
      const st = el.style;
      ['color', 'background-color', 'background', 'font-family', 'font-size', 'line-height'].forEach((p) => {
        if (st.getPropertyValue(p)) { st.removeProperty(p); n++; }
      });
      if (!st.cssText || !st.cssText.trim()) el.removeAttribute('style');
    });
    Array.prototype.forEach.call(root.querySelectorAll('font'), (f) => {
      const sp = document.createElement('span');
      sp.innerHTML = f.innerHTML;
      f.parentNode.replaceChild(sp, f);
      n++;
    });
    return n;
  }

  function trimBlank(root) {
    let removed = 0;
    // 连续多个 <br> 收敛成一个
    Array.prototype.forEach.call(root.querySelectorAll('p,div,li'), (el) => {
      if (el.querySelector('img,table,hr')) return;
      const txt = el.textContent.replace(/\u200b/g, '').trim();
      const hasEl = el.querySelector('*');
      if (!txt && !hasEl) { el.parentNode.removeChild(el); removed++; }
    });
    // 末尾空的 <br>
    Array.prototype.forEach.call(root.querySelectorAll('br'), (b) => {
      const p = b.parentNode;
      if (!p) return;
      if (!p.textContent.trim() && p.querySelectorAll('br').length > 1) { b.remove(); removed++; }
    });
    return removed;
  }

  /* ============================================================
     三、套用样式
     ============================================================ */
  function applyStyles(root, o) {
    const fontStack = '"' + o.fontEN + '","' + o.fontCN + '",sans-serif';
    const body = root.querySelectorAll('p,li,td,th,blockquote,div');
    Array.prototype.forEach.call(body, (el) => {
      const tag = el.tagName.toLowerCase();
      if (tag === 'div' && el.querySelector('p,div,h1,h2,h3,ul,ol,table')) return;  // 纯容器不动
      const st = el.style;
      st.fontFamily = fontStack;
      st.fontSize = o.bodySize + 'px';
      st.lineHeight = String(o.lineHeight);
      st.marginTop = '0';
      st.marginBottom = o.spaceAfter + 'px';
      st.color = '';
      if (tag === 'p' || tag === 'li' || tag === 'blockquote') {
        st.textIndent = o.indent ? (o.indent * o.bodySize) + 'px' : '0';
        st.textAlign = o.align;
      }
      if (tag === 'li') { st.textIndent = '0'; st.textAlign = 'left'; }
      if (tag === 'th' || tag === 'td') { st.textIndent = '0'; st.marginBottom = '0'; }
    });

    const sizes = { h1: o.h1Size, h2: o.h2Size, h3: o.h3Size, h4: o.h3Size, h5: o.h3Size, h6: o.h3Size };
    Array.prototype.forEach.call(root.querySelectorAll('h1,h2,h3,h4,h5,h6'), (h) => {
      const tag = h.tagName.toLowerCase();
      const st = h.style;
      st.fontFamily = fontStack;
      st.fontSize = (sizes[tag] || o.h3Size) + 'px';
      st.fontWeight = '700';
      st.lineHeight = '1.4';
      st.marginTop = o.headingSpacing + 'px';
      st.marginBottom = Math.round(o.headingSpacing * 0.6) + 'px';
      st.textIndent = '0';
      st.textAlign = 'left';
    });

    // 表格统一
    Array.prototype.forEach.call(root.querySelectorAll('table'), (tb) => {
      tb.style.borderCollapse = 'collapse';
      tb.style.width = '100%';
      tb.style.margin = o.spaceAfter + 'px 0';
    });
    Array.prototype.forEach.call(root.querySelectorAll('td,th'), (c) => {
      c.style.border = '1px solid #C9CFD6';
      c.style.padding = '6px 10px';
      c.style.fontSize = o.bodySize - 2 + 'px';
      c.style.lineHeight = '1.6';
      if (c.tagName.toLowerCase() === 'th') c.style.background = '#F2F3F5';
    });

    // 引用块
    Array.prototype.forEach.call(root.querySelectorAll('blockquote'), (b) => {
      b.style.borderLeft = '3px solid #D0D5DB';
      b.style.paddingLeft = '12px';
      b.style.color = '#5A616B';
    });

    // 图片不超宽
    Array.prototype.forEach.call(root.querySelectorAll('img'), (im) => {
      im.style.maxWidth = '100%';
      im.style.height = 'auto';
    });
  }

  /* ============================================================
     四、主流程
     ============================================================ */
  function analyze(html) {
    const d = document.createElement('div');
    d.innerHTML = html || '';
    return {
      paras: d.querySelectorAll('p').length,
      headings: d.querySelectorAll('h1,h2,h3,h4,h5,h6').length,
      lists: d.querySelectorAll('li').length,
      tables: d.querySelectorAll('table').length,
      inlineStyles: d.querySelectorAll('[style]').length,
      images: d.querySelectorAll('img').length,
      chars: (d.textContent || '').replace(/\s/g, '').length
    };
  }

  function run(html, o) {
    const d = document.createElement('div');
    d.innerHTML = html || '';
    const report = { unifyHeading: 0, stripInline: 0, trimBlank: 0, cnEnSpace: 0, fullPunct: 0 };

    if (o.unifyHeading) report.unifyHeading = unifyHeadings(d);

    if (o.cnEnSpace || o.fullPunct) {
      let before = '';
      transformTextNodes(d, (t) => {
        before = t;
        let v = t;
        if (o.cnEnSpace) v = addCnEnSpace(v);
        if (o.fullPunct) v = fullWidthPunct(v);
        if (v !== before) { if (o.cnEnSpace) report.cnEnSpace++; if (o.fullPunct) report.fullPunct++; }
        return v;
      });
    }

    if (o.clearColor) report.stripInline = stripInlineFormatting(d);
    if (o.trimBlank) report.trimBlank = trimBlank(d);
    applyStyles(d, o);

    return { html: d.innerHTML, report: report };
  }

  /* ============================================================
     五、界面
     ============================================================ */
  let modal = null;

  function buildModal() {
    if (modal) return modal;
    modal = document.createElement('div');
    modal.className = 'modal-mask';
    modal.id = 'typesetMask';
    modal.innerHTML =
      '<div class="modal modal-wide">' +
      '<div class="modal-head"><h3>智能排版</h3><button class="modal-x" data-ts-close>×</button></div>' +
      '<div class="modal-body ts-body">' +
      '<div class="ts-preview" id="tsPreview"></div>' +
      '<div class="ts-form">' +
      '<div class="ts-group"><h4>字体</h4>' +
      '<label>中文字体 <select id="tsFontCN">' +
      ['宋体', '仿宋', '楷体', '黑体', '微软雅黑', '思源黑体'].map((f) => '<option>' + f + '</option>').join('') +
      '</select></label>' +
      '<label>西文字体 <select id="tsFontEN">' +
      ['Calibri', 'Times New Roman', 'Arial', 'Georgia'].map((f) => '<option>' + f + '</option>').join('') +
      '</select></label>' +
      '<label>正文字号 <select id="tsBodySize">' +
      [['14', '五号 / 14px'], ['15', '小四·小 / 15px'], ['16', '小四 / 16px'], ['18', '四号 / 18px'], ['20', '三号 / 20px']]
        .map((p) => '<option value="' + p[0] + '">' + p[1] + '</option>').join('') +
      '</select></label>' +
      '<label>行距 <select id="tsLineHeight">' +
      [['1.5', '1.5 倍'], ['1.75', '1.75 倍（推荐）'], ['2', '2.0 倍'], ['2.5', '2.5 倍']]
        .map((p) => '<option value="' + p[0] + '">' + p[1] + '</option>').join('') +
      '</select></label>' +
      '<label>首行缩进 <select id="tsIndent">' +
      [['0', '不缩进'], ['1', '1 字符'], ['2', '2 字符（中文公文标准）'], ['4', '4 字符']]
        .map((p) => '<option value="' + p[0] + '">' + p[1] + '</option>').join('') +
      '</select></label>' +
      '</div>' +
      '<div class="ts-group"><h4>正文对齐</h4>' +
      '<label class="ts-radio"><input type="radio" name="tsAlign" value="justify">两端对齐（推荐）</label>' +
      '<label class="ts-radio"><input type="radio" name="tsAlign" value="left">左对齐</label>' +
      '</div>' +
      '<div class="ts-group"><h4>清理与规范</h4>' +
      '<label class="ts-check"><input type="checkbox" id="tsUnifyHeading">标题层级规范化</label>' +
      '<label class="ts-check"><input type="checkbox" id="tsClearColor">清除行内杂色与杂字体</label>' +
      '<label class="ts-check"><input type="checkbox" id="tsCnEnSpace">中英文之间加空格</label>' +
      '<label class="ts-check"><input type="checkbox" id="tsFullPunct">标点符号全角化</label>' +
      '<label class="ts-check"><input type="checkbox" id="tsTrimBlank">清理空段落</label>' +
      '</div>' +
      '</div></div>' +
      '<div class="modal-foot">' +
      '<span class="ts-hint" id="tsHint"></span>' +
      '<button class="ghost-btn" data-ts-close>取消</button>' +
      '<button class="ghost-btn" id="tsReset">恢复默认</button>' +
      '<button class="primary-btn" id="tsApply">应用排版</button>' +
      '</div></div>';
    document.body.appendChild(modal);

    modal.addEventListener('click', (e) => {
      if (e.target === modal || e.target.closest('[data-ts-close]')) modal.classList.remove('on');
    });
    $$('.ts-check input, .ts-group select, .ts-radio input', modal).forEach((el) => {
      el.addEventListener('change', readForm);
    });
    $('#tsReset', modal).addEventListener('click', () => {
      opts = Object.assign({}, DEFAULT_OPTIONS);
      writeForm(); readForm();
    });
    $('#tsApply', modal).addEventListener('click', doApply);
    return modal;
  }

  function readForm() {
    opts.fontCN = $('#tsFontCN').value;
    opts.fontEN = $('#tsFontEN').value;
    opts.bodySize = parseInt($('#tsBodySize').value, 10);
    opts.lineHeight = parseFloat($('#tsLineHeight').value);
    opts.indent = parseInt($('#tsIndent').value, 10);
    opts.align = ($('input[name="tsAlign"]:checked', modal) || {}).value || 'justify';
    opts.unifyHeading = $('#tsUnifyHeading').checked;
    opts.clearColor = $('#tsClearColor').checked;
    opts.cnEnSpace = $('#tsCnEnSpace').checked;
    opts.fullPunct = $('#tsFullPunct').checked;
    opts.trimBlank = $('#tsTrimBlank').checked;
    // 标题字号按正文推算，保持层级比例
    opts.h1Size = Math.round(opts.bodySize * 1.5);
    opts.h2Size = Math.round(opts.bodySize * 1.25);
    opts.h3Size = Math.round(opts.bodySize * 1.06);
    updateHint();
  }

  function writeForm() {
    $('#tsFontCN').value = opts.fontCN;
    $('#tsFontEN').value = opts.fontEN;
    $('#tsBodySize').value = String(opts.bodySize);
    $('#tsLineHeight').value = String(opts.lineHeight);
    $('#tsIndent').value = String(opts.indent);
    const r = $('input[name="tsAlign"][value="' + opts.align + '"]', modal);
    if (r) r.checked = true;
    $('#tsUnifyHeading').checked = opts.unifyHeading;
    $('#tsClearColor').checked = opts.clearColor;
    $('#tsCnEnSpace').checked = opts.cnEnSpace;
    $('#tsFullPunct').checked = opts.fullPunct;
    $('#tsTrimBlank').checked = opts.trimBlank;
  }

  function updateHint() {
    const info = analyze(saved == null ? '' : saved);
    $('#tsHint').textContent = info.chars + ' 字 · ' + info.paras + ' 段 · ' +
      info.headings + ' 个标题 · ' + info.tables + ' 个表格 · ' + info.inlineStyles + ' 处行内样式待清理';
  }

  function doApply() {
    if (saved == null) { FW.toast('没有可排版的内容'); return; }
    const ed = FW.Editors.doc;
    const res = run(saved, opts);
    const paper = document.getElementById('docPaper');
    paper.innerHTML = res.html;
    // 触发保存
    const ev = document.createEvent('Event');
    ev.initEvent('input', true, true);
    paper.dispatchEvent(ev);

    modal.classList.remove('on');
    const r = res.report;
    const parts = [];
    if (r.unifyHeading) parts.push('重排标题 ' + r.unifyHeading + ' 处');
    if (r.stripInline) parts.push('清理样式 ' + r.stripInline + ' 处');
    if (r.trimBlank) parts.push('删除空段 ' + r.trimBlank + ' 处');
    if (r.cnEnSpace) parts.push('中英空格 ' + r.cnEnSpace + ' 处');
    if (r.fullPunct) parts.push('标点规范 ' + r.fullPunct + ' 处');
    FW.toast('排版完成：' + (parts.length ? parts.join(' · ') : '格式已统一'), 3600);
  }

  function open() {
    if (!FW.app || FW.app.current() !== 'doc') {
      FW.toast('智能排版目前用于文字文档');
      return;
    }
    buildModal();
    saved = FW.Editors.doc.getData().html;
    writeForm();
    readForm();
    modal.classList.add('on');
  }

  global.TYPESET = { open, run, analyze, DEFAULT_OPTIONS: DEFAULT_OPTIONS };
})(window);
