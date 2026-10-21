/* ============================================================
   editor-doc.js — 文字文档编辑器（富文本）
   ============================================================ */
(function (global) {
  'use strict';
  const FW = global.FW, $ = FW.$, $$ = FW.$$;
  const paper = () => $('#docPaper');

  const PAPERS = { A4: [794, 1123], A3: [1123, 1587], Letter: [816, 1056] };

  let onChange = null;
  let timer = null;
  let bound = false;
  const S = { paper: 'A4', zoom: 100, lineHeight: 1.75 };

  function emit() {
    if (!onChange) return;
    clearTimeout(timer);
    timer = setTimeout(() => onChange(), 700);
  }

  /* ---------- 命令 ---------- */
  function exec(cmd, val) {
    paper().focus();
    try { document.execCommand(cmd, false, val === undefined ? null : val); } catch (e) { console.warn('[文档] 执行命令失败：' + cmd, e); }
    emit();
  }

  function setFontSize(px) {
    const p = paper();
    p.focus();
    const sel = window.getSelection();
    if (!sel.rangeCount || sel.isCollapsed) { exec('fontSize', 3); return; }
    // 先套用 execCommand，再把 font[size] 换成 px 行内样式，绕开 1-7 限制
    document.execCommand('fontSize', false, '7');
    $$('font[size="7"]', p).forEach((f) => {
      const span = document.createElement('span');
      span.style.fontSize = px + 'px';
      while (f.firstChild) span.appendChild(f.firstChild);
      f.parentNode.replaceChild(span, f);
    });
    emit();
  }

  function applyPaper(name) {
    S.paper = name;
    const p = paper();
    const dim = PAPERS[name] || PAPERS.A4;
    p.style.width = dim[0] + 'px';
    p.style.minHeight = dim[1] + 'px';
  }

  function applyZoom(z) {
    S.zoom = z;
    const p = paper();
    p.style.transform = 'scale(' + (z / 100) + ')';
    p.style.transformOrigin = 'top center';
    p.style.marginBottom = (z < 100 ? -(1123 * (1 - z / 100)) : 0) + 'px';
  }

  function countWords() {
    const t = (paper().innerText || '').replace(/\u200b/g, '');
    const noSpace = t.replace(/\s/g, '');
    return { chars: noSpace.length, charsAll: t.length, paras: t.split(/\n+/).filter((x) => x.trim()).length };
  }

  /* ---------- 功能区 ---------- */
  const FONTS = ['微软雅黑', '宋体', '黑体', '楷体', '仿宋', '思源黑体', 'Arial', 'Calibri', 'Times New Roman', 'Consolas'];
  const SIZES = [12, 14, 15, 16, 18, 20, 22, 24, 28, 32, 36, 42, 48, 56, 72];

  const ribbon = [
    {
      tab: '开始', groups: [
        {
          label: '剪贴板', items: [
            { t: 'btn', g: '⧉', label: '复制', cmd: 'copy' },
            { t: 'btn', g: '✂', label: '剪切', cmd: 'cut' },
            { t: 'btn', g: '📋', label: '粘贴', cmd: 'paste' },
            { t: 'btn', g: '⌫', label: '清除格式', cmd: 'removeFormat' }
          ]
        },
        {
          label: '字体', items: [
            { t: 'select', cmd: 'fontName', width: 116, options: FONTS.map((f) => ({ v: f, t: f })) },
            { t: 'select', cmd: 'fontSize', width: 64, options: SIZES.map((s) => ({ v: s, t: s })) },
            { t: 'btn', g: 'B', label: '加粗', cmd: 'bold', toggle: true, style: 'font-weight:800' },
            { t: 'btn', g: 'I', label: '斜体', cmd: 'italic', toggle: true, style: 'font-style:italic;font-family:Georgia' },
            { t: 'btn', g: 'U', label: '下划线', cmd: 'underline', toggle: true, style: 'text-decoration:underline' },
            { t: 'btn', g: 'S', label: '删除线', cmd: 'strikeThrough', toggle: true, style: 'text-decoration:line-through' },
            { t: 'btn', g: 'x²', label: '上标', cmd: 'superscript', toggle: true },
            { t: 'btn', g: 'x₂', label: '下标', cmd: 'subscript', toggle: true },
            { t: 'color', g: 'A', label: '字体颜色', cmd: 'foreColor', value: '#D93B2B' },
            { t: 'color', g: '▨', label: '高亮', cmd: 'hiliteColor', value: '#FFF176' }
          ]
        },
        {
          label: '段落', items: [
            { t: 'btn', g: '☰', label: '左对齐', cmd: 'justifyLeft', toggle: true },
            { t: 'btn', g: '≣', label: '居中', cmd: 'justifyCenter', toggle: true },
            { t: 'btn', g: '☰', label: '右对齐', cmd: 'justifyRight', toggle: true },
            { t: 'btn', g: '≡', label: '两端对齐', cmd: 'justifyFull', toggle: true },
            { t: 'btn', g: '•', label: '项目符号', cmd: 'insertUnorderedList', toggle: true },
            { t: 'btn', g: '1.', label: '编号', cmd: 'insertOrderedList', toggle: true },
            { t: 'btn', g: '⇤', label: '减少缩进', cmd: 'outdent' },
            { t: 'btn', g: '⇥', label: '增加缩进', cmd: 'indent' },
            { t: 'btn', g: '¶', label: '行距', cmd: 'lineHeight', wide: true }
          ]
        },
        {
          label: '样式', items: [
            { t: 'btn', g: 'H1', label: '标题 1', cmd: 'block:h1' },
            { t: 'btn', g: 'H2', label: '标题 2', cmd: 'block:h2' },
            { t: 'btn', g: 'H3', label: '标题 3', cmd: 'block:h3' },
            { t: 'btn', g: '正文', label: '正文', cmd: 'block:p', wide: true },
            { t: 'btn', g: '❝', label: '引用', cmd: 'block:blockquote' }
          ]
        },
        {
          label: '智能工具', items: [
            { t: 'btn', g: '✨', label: '智能排版', cmd: 'typeset', wide: true },
            { t: 'btn', g: '⇄', label: '版本与对比', cmd: 'openHistory', wide: true }
          ]
        }
      ]
    },
    {
      tab: '插入', groups: [
        {
          label: '对象', items: [
            { t: 'btn', g: '▦', label: '表格', cmd: 'insertTable' },
            { t: 'btn', g: '🖼', label: '图片', cmd: 'insertImage' },
            { t: 'btn', g: '🔗', label: '链接', cmd: 'insertLink' },
            { t: 'btn', g: '—', label: '水平线', cmd: 'insertHorizontalRule' },
            { t: 'btn', g: '⏎', label: '分页符', cmd: 'pageBreak' }
          ]
        },
        {
          label: '文本', items: [
            { t: 'btn', g: '📅', label: '日期', cmd: 'insertDate' },
            { t: 'btn', g: '№', label: '页码域', cmd: 'insertPageNo' },
            { t: 'btn', g: '␣', label: '不间断空格', cmd: 'insertNbsp' },
            { t: 'btn', g: '✓', label: '复选框', cmd: 'insertCheckbox' }
          ]
        }
      ]
    },
    {
      tab: '页面', groups: [
        {
          label: '纸张', items: [
            { t: 'btn', g: 'A4', label: 'A4', cmd: 'paper:A4' },
            { t: 'btn', g: 'A3', label: 'A3', cmd: 'paper:A3' },
            { t: 'btn', g: 'L', label: 'Letter', cmd: 'paper:Letter', wide: true }
          ]
        },
        {
          label: '版式', items: [
            { t: 'btn', g: '↕', label: '行距 1.0', cmd: 'lh:1.4', wide: true },
            { t: 'btn', g: '↕', label: '行距 1.75', cmd: 'lh:1.75', wide: true },
            { t: 'btn', g: '↕', label: '行距 2.0', cmd: 'lh:2.2', wide: true }
          ]
        },
        {
          label: '背景', items: [
            { t: 'color', g: '▤', label: '纸张底色', cmd: 'paperColor', value: '#FFFFFF' },
            { t: 'btn', g: '◐', label: '护眼绿', cmd: 'paperColor:#E8F5E9' },
            { t: 'btn', g: '◻', label: '米黄', cmd: 'paperColor:#FFF8E1' }
          ]
        }
      ]
    },
    {
      tab: '视图', groups: [
        {
          label: '显示比例', items: [
            { t: 'btn', g: '−', label: '缩小', cmd: 'zoom:-10' },
            { t: 'btn', g: '100', label: '100%', cmd: 'zoom:100', wide: true },
            { t: 'btn', g: '+', label: '放大', cmd: 'zoom:+10' }
          ]
        },
        {
          label: '统计', items: [
            { t: 'btn', g: '∑', label: '字数统计', cmd: 'wordCount', wide: true }
          ]
        },
        {
          label: '导出', items: [
            { t: 'btn', g: 'W', label: '导出 Word', cmd: 'openExport', wide: true },
            { t: 'btn', g: 'P', label: '打印 / PDF', cmd: 'print', wide: true }
          ]
        }
      ]
    }
  ];

  /* ---------- 模块接口 ---------- */
  global.FW.Editors = global.FW.Editors || {};
  global.FW.Editors.doc = {
    badge: '文字',
    badgeCls: '',
    ribbon: ribbon,

    mount(doc) {
      const p = paper();
      p.innerHTML = (doc.data && doc.data.html) || '';
      S.lineHeight = (doc.data && doc.data.lineHeight) || 1.75;
      p.style.lineHeight = S.lineHeight;
      applyPaper((doc.data && doc.data.paper) || 'A4');
      p.style.background = (doc.data && doc.data.paperColor) || '#fff';
      applyZoom(S.zoom);
      if (!bound) {
        bound = true;
        p.addEventListener('input', emit);
        p.addEventListener('keyup', () => syncToggles());
        p.addEventListener('mouseup', () => syncToggles());
      }
    },

    unmount() { },

    getData() {
      return { html: paper().innerHTML, paper: S.paper, lineHeight: S.lineHeight, paperColor: paper().style.background };
    },

    setChangeHandler(fn) { onChange = fn; },

    async cmd(name, value, btn) {
      const p = paper();
      if (name === 'bold' || name === 'italic' || name === 'underline' || name === 'strikeThrough' ||
        name === 'superscript' || name === 'subscript' || name === 'justifyLeft' || name === 'justifyCenter' ||
        name === 'justifyRight' || name === 'justifyFull' || name === 'insertUnorderedList' || name === 'insertOrderedList' ||
        name === 'outdent' || name === 'indent' || name === 'removeFormat') { exec(name); syncToggles(); return; }

      if (name === 'copy' || name === 'cut' || name === 'paste') { exec(name); return; }
      if (name === 'fontName') { exec('fontName', value); return; }
      if (name === 'fontSize') { setFontSize(parseInt(value, 10)); return; }
      if (name === 'foreColor' || name === 'hiliteColor') { exec(name, value); return; }

      if (name.indexOf('block:') === 0) {
        const tag = name.slice(6);
        p.focus();
        try { document.execCommand('formatBlock', false, tag.toUpperCase()); } catch (e) { console.warn('[文档] 设置段落样式失败：' + tag, e); }
        emit(); return;
      }
      if (name.indexOf('paper:') === 0) { applyPaper(name.slice(6)); emit(); return; }
      if (name.indexOf('paperColor:') === 0) { p.style.background = name.slice(11); emit(); return; }
      if (name === 'paperColor') { p.style.background = value; emit(); return; }
      if (name.indexOf('lh:') === 0) { S.lineHeight = parseFloat(name.slice(3)); p.style.lineHeight = S.lineHeight; emit(); return; }
      if (name === 'lineHeight') {
        const opts = ['1.0', '1.15', '1.5', '1.75', '2.0', '2.5'];
        const cur = await FW.prompt('设置行距（如 1.0 / 1.5 / 1.75 / 2.0）：', String(S.lineHeight), { title: '行距', type: 'number' });
        if (cur && !isNaN(parseFloat(cur))) { S.lineHeight = parseFloat(cur); p.style.lineHeight = S.lineHeight; emit(); }
        return;
      }
      if (name.indexOf('zoom:') === 0) {
        const v = name.slice(5);
        let z = v === '100' ? 100 : S.zoom + parseInt(v, 10);
        z = Math.max(40, Math.min(200, z));
        applyZoom(z); global.FW.app && global.FW.app.refreshStatus();
        return;
      }
      if (name === 'wordCount') {
        const c = countWords();
        FW.toast('字数：' + c.chars + ' 字（不含空格） · 含空格 ' + c.charsAll + ' · 段落 ' + c.paras + ' 段', 3200);
        return;
      }
      if (name === 'insertTable') {
        const n = await FW.prompt('插入表格，输入「行数x列数」，例如 3x4：', '3x3', { title: '插入表格' });
        if (!n) return;
        const m = /^(\d+)\s*[x×,\s]\s*(\d+)$/i.exec(n.trim());
        if (!m) { FW.toast('格式不正确，示例：3x4'); return; }
        const rows = Math.min(40, +m[1]), cols = Math.min(20, +m[2]);
        let h = '<table><tbody>';
        for (let r = 0; r < rows; r++) {
          h += '<tr>';
          for (let c = 0; c < cols; c++) h += (r === 0 ? '<th>标题' : '<td>') + (r === 0 ? (c + 1) + '</th>' : '') + (r === 0 ? '' : '</td>');
          h += '</tr>';
        }
        h += '</tbody></table><p><br></p>';
        exec('insertHTML', h); return;
      }
      if (name === 'insertImage') {
        FW.pickFile('image/*').then((f) => {
          if (!f) return;
          FW.readAsDataURL(f).then(async (url) => {
            const w = await FW.prompt('图片宽度（像素，留空为原始大小）：', '420', { title: '插入图片', type: 'number' });
            const style = w && !isNaN(+w) ? ' style="width:' + (+w) + 'px"' : '';
            exec('insertHTML', '<p><img src="' + url + '"' + style + '></p>');
          });
        });
        return;
      }
      if (name === 'insertLink') {
        const url = await FW.prompt('请输入链接地址：', 'https://', { title: '插入链接' });
        if (url) exec('createLink', url);
        return;
      }
      if (name === 'insertHorizontalRule') { exec('insertHorizontalRule'); return; }
      if (name === 'pageBreak') { exec('insertHTML', '<div style="page-break-after:always;border-top:1px dashed #C9CFD6;margin:24px 0"></div><p><br></p>'); return; }
      if (name === 'insertDate') { exec('insertText', new Date().toLocaleDateString('zh-CN')); return; }
      if (name === 'insertPageNo') { exec('insertHTML', '<span style="color:#8D949E">— 第 X 页 —</span>'); return; }
      if (name === 'insertNbsp') { exec('insertHTML', '&nbsp;&nbsp;&nbsp;&nbsp;'); return; }
      if (name === 'insertCheckbox') { exec('insertHTML', '<span style="font-family:Segoe UI Symbol">☐ </span>'); return; }
      if (name === 'print') { global.print(); return; }
      if (name === 'openExport') { if (global.FW.app) global.FW.app.openExport(); return; }
      if (name === 'typeset') { if (global.TYPESET) global.TYPESET.open(); return; }
      if (name === 'openHistory') {
        const d = global.FW.app && global.FW.app.currentDoc && global.FW.app.currentDoc();
        if (global.HISTORY) global.HISTORY.openPanel(d ? d.id : null);
        return;
      }
    },

    undo() { exec('undo'); },
    redo() { exec('redo'); },

    status() {
      const c = countWords();
      const pages = Math.max(1, Math.ceil(c.charsAll / 780));
      return '<span>字数：' + c.chars + '</span><span>段落：' + c.paras + '</span>' +
        '<span>页数：约 ' + pages + ' 页</span><span class="sp"></span>' +
        '<span>纸张：' + S.paper + '</span><span>缩放：' + S.zoom + '%</span>';
    },

    exports: [
      { id: 'docx', icon: 'W', title: 'Word 文档 (.docx)', desc: '生成真实 Office 文件，可用 Word 打开', ext: 'docx' },
      { id: 'html', icon: '<>', title: '网页 (.html)', desc: '保留排版样式，可直接用浏览器打开', ext: 'html' },
      { id: 'md', icon: 'M↓', title: 'Markdown (.md)', desc: '转换为纯文本标记格式', ext: 'md' },
      { id: 'txt', icon: 'T', title: '纯文本 (.txt)', desc: '只保留文字内容', ext: 'txt' },
      { id: 'pdf', icon: 'P', title: '打印 / 另存为 PDF', desc: '调用系统打印，输出矢量 PDF，中文完美', ext: 'pdf' },
      { id: 'json', icon: '{}', title: 'ForFree 工程文件 (.json)', desc: '无损保存，可再次导入继续编辑', ext: 'json' }
    ]
  };

  function syncToggles() {
    if (!global.FW.app || !global.FW.app.syncRibbonState) return;
    const map = {};
    ['bold', 'italic', 'underline', 'strikeThrough', 'superscript', 'subscript',
      'justifyLeft', 'justifyCenter', 'justifyRight', 'justifyFull',
      'insertUnorderedList', 'insertOrderedList'].forEach((c) => {
        try { map[c] = document.queryCommandState(c); } catch (e) { map[c] = false; }
      });
    global.FW.app.syncRibbonState(map);
  }
})(window);
