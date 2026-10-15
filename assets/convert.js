/* ============================================================
   convert.js — 格式转换中心 & 文件读写改入口
   ============================================================ */
(function (global) {
  'use strict';
  const FW = global.FW, $ = FW.$, $$ = FW.$$;

  const KINDS = {
    docx: { name: 'Word 文档', icon: 'W', color: '#2B7FE0' },
    xlsx: { name: 'Excel 表格', icon: 'X', color: '#21A366' },
    pptx: { name: 'PPT 演示', icon: 'P', color: '#F2994A' },
    pdf: { name: 'PDF 文档', icon: 'PDF', color: '#D93B2B' },
    csv: { name: 'CSV 表格', icon: ',', color: '#21A366' },
    txt: { name: '纯文本', icon: 'T', color: '#6B7280' },
    md: { name: 'Markdown', icon: 'M', color: '#6B7280' },
    html: { name: '网页', icon: '<>', color: '#0EA5E9' },
    json: { name: 'ForFree 工程', icon: '{}', color: '#8B5CF6' },
    image: { name: '图片', icon: '🖼', color: '#F5B301' }
  };

  function kindOf(file) {
    const n = (file.name || '').toLowerCase();
    if (/\.docx?$/.test(n)) return 'docx';
    if (/\.xlsx?$/.test(n)) return 'xlsx';
    if (/\.pptx?$/.test(n)) return 'pptx';
    if (/\.pdf$/.test(n)) return 'pdf';
    if (/\.csv$/.test(n)) return 'csv';
    if (/\.txt$/.test(n)) return 'txt';
    if (/\.md$|\.markdown$/.test(n)) return 'md';
    if (/\.html?$/.test(n)) return 'html';
    if (/\.json$/.test(n)) return 'json';
    if (/^image\//.test(file.type) || /\.(png|jpe?g|webp|gif|bmp)$/.test(n)) return 'image';
    return null;
  }

  const TARGETS = {
    docx: [['html', '网页'], ['md', 'Markdown'], ['txt', '纯文本'], ['pdf', 'PDF'], ['json', '工程文件']],
    xlsx: [['csv', 'CSV'], ['html', '网页'], ['pdf', 'PDF'], ['json', '工程文件']],
    pptx: [['html', '网页'], ['pdf', 'PDF'], ['json', '工程文件']],
    pdf: [['docx', 'Word'], ['xlsx', 'Excel'], ['compress', '压缩'], ['txt', '文本'], ['png', '图片包']],
    csv: [['xlsx', 'Excel'], ['html', '网页'], ['json', '工程文件']],
    txt: [['docx', 'Word'], ['html', '网页'], ['md', 'Markdown']],
    md: [['docx', 'Word'], ['html', '网页'], ['txt', '纯文本']],
    html: [['docx', 'Word'], ['txt', '纯文本'], ['md', 'Markdown']],
    json: [['docx', 'Word'], ['xlsx', 'Excel'], ['pptx', 'PPT'], ['html', '网页'], ['pdf', 'PDF']],
    image: [['pdf', 'PDF']]
  };

  /* ============================================================
     基础转换函数
     ============================================================ */
  const b64ToU8 = (b64) => { const bin = atob(b64); const u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i); return u8; };
  const u8ToB64 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]); return btoa(s); };

  function wrapHtml(title, body, extraCss) {
    return '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><title>' + FW.escapeHtml(title) + '</title>' +
      '<style>body{font-family:"Microsoft YaHei","PingFang SC",sans-serif;max-width:820px;margin:0 auto;padding:44px 28px;line-height:1.8;color:#1F2328}' +
      'h1,h2,h3{color:#1F2328;margin:.8em 0 .4em}h1{font-size:26px}h2{font-size:21px}h3{font-size:17px}' +
      'table{border-collapse:collapse;width:100%;margin:1em 0}td,th{border:1px solid #C9CFD6;padding:7px 11px}th{background:#F2F3F5}' +
      'blockquote{border-left:3px solid #D0D5DB;margin:1em 0;padding:.4em 0 .4em 1em;color:#5A616B}' +
      'pre{background:#F5F6F8;padding:14px;border-radius:6px;overflow:auto}img{max-width:100%}' +
      (extraCss || '') + '</style></head><body>' + body + '</body></html>';
  }

  function textToHtml(text) {
    return String(text).replace(/\r\n/g, '\n').split(/\n{2,}/).map((para) =>
      '<p>' + FW.escapeHtml(para).replace(/\n/g, '<br>') + '</p>').join('');
  }

  async function fileToPdfBytes(file) {
    if (!global.PDFLib) throw new Error('PDF 写入引擎未加载');
    const doc = await PDFLib.PDFDocument.create();
    const bytes = await FW.readAsArrayBuffer(file);
    let img;
    const n = (file.name || '').toLowerCase();
    if (/\.png$/.test(n)) img = await doc.embedPng(bytes);
    else if (/\.jpe?g$/.test(n)) img = await doc.embedJpg(bytes);
    else {
      const url = await FW.readAsDataURL(file);
      const png = await new Promise((res) => {
        const im = new Image();
        im.onload = () => {
          const cv = document.createElement('canvas');
          cv.width = im.naturalWidth; cv.height = im.naturalHeight;
          cv.getContext('2d').drawImage(im, 0, 0);
          cv.toBlob((b) => b.arrayBuffer().then((ab) => res(new Uint8Array(ab))), 'image/png');
        };
        im.src = url;
      });
      img = await doc.embedPng(png);
    }
    const pw = img.width, ph = img.height;
    const page = doc.addPage([pw, ph]);
    page.drawImage(img, { x: 0, y: 0, width: pw, height: ph });
    return await doc.save();
  }

  async function imagesToPdf(files) {
    const doc = await PDFLib.PDFDocument.create();
    for (const f of files) {
      const bytes = await FW.readAsArrayBuffer(f);
      let img;
      const n = (f.name || '').toLowerCase();
      try {
        if (/\.png$/.test(n)) img = await doc.embedPng(bytes);
        else if (/\.jpe?g$/.test(n)) img = await doc.embedJpg(bytes);
        else throw new Error('need convert');
      } catch (e) {
        const url = await FW.readAsDataURL(f);
        const png = await new Promise((res) => {
          const im = new Image();
          im.onload = () => {
            const cv = document.createElement('canvas');
            cv.width = im.naturalWidth; cv.height = im.naturalHeight;
            cv.getContext('2d').drawImage(im, 0, 0);
            cv.toBlob((b) => b.arrayBuffer().then((ab) => res(new Uint8Array(ab))), 'image/png');
          };
          im.src = url;
        });
        img = await doc.embedPng(png);
      }
      const page = doc.addPage([img.width, img.height]);
      page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
    }
    return await doc.save();
  }

  async function mergePdfs(files) {
    const out = await PDFLib.PDFDocument.create();
    let total = 0;
    for (const f of files) {
      const bytes = await FW.readAsArrayBuffer(f);
      const src = await PDFLib.PDFDocument.load(bytes, { ignoreEncryption: true });
      const pages = await out.copyPages(src, src.getPageIndices());
      pages.forEach((p) => out.addPage(p));
      total += pages.length;
    }
    return { bytes: await out.save(), pages: total };
  }

  async function pdfToText(file) {
    const bytes = await FW.readAsArrayBuffer(file);
    const doc = await global.pdfjsLib.getDocument({ data: bytes.slice() }).promise;
    let out = '';
    for (let i = 1; i <= doc.numPages; i++) {
      const pg = await doc.getPage(i);
      const tc = await pg.getTextContent();
      out += '===== 第 ' + i + ' 页 =====\n' + tc.items.map((it) => it.str).join('') + '\n\n';
    }
    return out;
  }

  async function pdfToPngZip(file) {
    const bytes = await FW.readAsArrayBuffer(file);
    const doc = await global.pdfjsLib.getDocument({ data: bytes.slice() }).promise;
    const zipFiles = {};
    for (let i = 1; i <= doc.numPages; i++) {
      const pg = await doc.getPage(i);
      const vp = pg.getViewport({ scale: 2 });
      const cv = document.createElement('canvas');
      cv.width = vp.width; cv.height = vp.height;
      await pg.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise;
      zipFiles['page-' + String(i).padStart(3, '0') + '.png'] = b64ToU8(cv.toDataURL('image/png').split(',')[1]);
    }
    return global.fflate.zipSync(zipFiles, { level: 6 });
  }

  /* ============================================================
     读取任意文件 → ForFree 文档对象
     ============================================================ */
  async function readAsDoc(file) {
    const kind = kindOf(file);
    const bytes = await FW.readAsArrayBuffer(file);
    const baseName = (file.name || '未命名').replace(/\.[^.]+$/, '');

    if (kind === 'docx') {
      const r = global.OFFICE.parseDocx(bytes);
      const d = FW.createDoc('doc');
      d.title = baseName;
      d.data.html = r.html;
      return d;
    }
    if (kind === 'xlsx') {
      const r = global.OFFICE.parseXlsx(bytes);
      const d = FW.createDoc('sheet');
      d.title = baseName;
      d.data.sheets = r.sheets;
      d.data.active = 0;
      return d;
    }
    if (kind === 'pptx') {
      const r = global.OFFICE.parsePptx(bytes);
      const d = FW.createDoc('slide');
      d.title = baseName;
      d.data.size = r.size;
      d.data.slides = r.slides;
      return d;
    }
    if (kind === 'csv') {
      const text = new TextDecoder('utf-8').decode(bytes).replace(/^\ufeff/, '');
      const cells = global.OFFICE.csvToCells(text);
      const d = FW.createDoc('sheet');
      d.title = baseName;
      d.data.sheets = [{ name: 'Sheet1', cells: cells, cols: {}, rows: {}, colW: 88, rowH: 24 }];
      return d;
    }
    if (kind === 'txt' || kind === 'md') {
      const text = new TextDecoder('utf-8').decode(bytes).replace(/^\ufeff/, '');
      const d = FW.createDoc('doc');
      d.title = baseName;
      d.data.html = kind === 'md' ? global.OFFICE.markdownToHtml(text) : textToHtml(text);
      return d;
    }
    if (kind === 'html') {
      const text = new TextDecoder('utf-8').decode(bytes).replace(/^\ufeff/, '');
      const m = /<body[^>]*>([\s\S]*?)<\/body>/i.exec(text);
      const d = FW.createDoc('doc');
      d.title = baseName;
      d.data.html = m ? m[1] : text;
      return d;
    }
    if (kind === 'json') {
      const obj = JSON.parse(new TextDecoder('utf-8').decode(bytes));
      if (obj && obj.type && obj.data) {
        const d = FW.createDoc(obj.type);
        d.title = obj.title || baseName;
        d.data = obj.data;
        if (obj.type === 'slide') {
          d.data.size = d.data.size || { w: 960, h: 540 };
          if (!Array.isArray(d.data.slides) || !d.data.slides.length) {
            d.data.slides = [{ layout: 'title', bg: null, shapes: [] }];
          }
        }
        if (obj.type === 'sheet') {
          // 工程文件损坏/被手动编辑导致缺表时兜底，避免后续 sheets[0] 崩溃
          if (!Array.isArray(d.data.sheets) || !d.data.sheets.length) {
            d.data.sheets = [{ name: 'Sheet1', cells: {}, cols: {}, rows: {}, colW: 88, rowH: 24 }];
            d.data.active = 0;
          }
        }
        return d;
      }
      throw new Error('不是 ForFree 工程文件');
    }
    throw new Error('不支持直接打开该格式');
  }

  /* ============================================================
     单个转换
     ============================================================ */
  async function convertOne(file, target) {
    const kind = kindOf(file);
    const base = (file.name || '未命名').replace(/\.[^.]+$/, '');

    // 图片 → PDF（多张时由批量入口处理）
    if (kind === 'image' && target === 'pdf') {
      return { bytes: await fileToPdfBytes(file), name: base + '.pdf', mime: 'application/pdf' };
    }

    // PDF → Word / Excel
    if (kind === 'pdf' && (target === 'docx' || target === 'xlsx')) {
      const res = await global.PDFCONV.fromFile(file, target, (i, n) => {
        if (i === n || i % 5 === 0) FW.toast('正在解析第 ' + i + '/' + n + ' 页…', 1400);
      });
      return {
        bytes: res.bytes, name: base + '.' + target,
        mime: target === 'docx'
          ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
          : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      };
    }

    // PDF → 压缩（均衡档）
    if (kind === 'pdf' && target === 'compress') {
      const bytes = await FW.readAsArrayBuffer(file);
      const r = await global.PDFTOOLS.compressBytes(bytes, 'balanced', (i, n) => {
        if (i === n || i % 3 === 0) FW.toast('正在压缩第 ' + i + '/' + n + ' 页…', 1200);
      });
      if (r.bytes.length >= bytes.length) throw new Error('压缩后体积未减小（原文件已足够小）');
      return {
        bytes: r.bytes, name: base + '_压缩.pdf', mime: 'application/pdf',
        note: FW.fmtSize(bytes.length) + ' → ' + FW.fmtSize(r.bytes.length) +
          '（减小 ' + Math.round((1 - r.bytes.length / bytes.length) * 100) + '%）'
      };
    }

    // PDF → 文本 / 图片
    if (kind === 'pdf' && target === 'txt') {
      const t = await pdfToText(file);
      return { text: t, name: base + '.txt', mime: 'text/plain' };
    }
    if (kind === 'pdf' && target === 'png') {
      return { bytes: await pdfToPngZip(file), name: base + '_图片.zip', mime: 'application/zip' };
    }

    // 需要先解析成 ForFree 文档
    const doc = await readAsDoc(file);

    if (target === 'json') {
      return { text: JSON.stringify({ app: 'ForFree', version: 1, type: doc.type, title: doc.title, data: doc.data }, null, 2), name: base + '.forfree.json', mime: 'application/json' };
    }
    if (target === 'docx') {
      return { bytes: global.OFFICE.buildDocx(doc), name: base + '.docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' };
    }
    if (target === 'xlsx') {
      return { bytes: global.OFFICE.buildXlsx(doc), name: base + '.xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };
    }
    if (target === 'pptx') {
      if (doc.type !== 'slide') throw new Error('只有演示文稿可以转成 PPTX');
      return { bytes: global.OFFICE.buildPptx(doc), name: base + '.pptx', mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' };
    }
    if (target === 'csv') {
      if (doc.type !== 'sheet') throw new Error('只有表格可以转成 CSV');
      return { text: global.OFFICE.sheetToCsv(doc.data.sheets[0]), name: base + '.csv', mime: 'text/csv' };
    }
    if (target === 'txt') {
      if (doc.type === 'doc') return { text: global.OFFICE.docToText(doc.data.html), name: base + '.txt', mime: 'text/plain' };
      if (doc.type === 'sheet') return { text: global.OFFICE.sheetToCsv(doc.data.sheets[0]).replace(/,/g, '\t'), name: base + '.txt', mime: 'text/plain' };
      if (doc.type === 'slide') return { text: doc.data.slides.map((s, i) => '【第 ' + (i + 1) + ' 页】\n' + s.shapes.map((x) => x.text || '').filter(Boolean).join('\n')).join('\n\n'), name: base + '.txt', mime: 'text/plain' };
    }
    if (target === 'md') {
      if (doc.type === 'doc') return { text: global.OFFICE.docToMarkdown(doc.data.html), name: base + '.md', mime: 'text/markdown' };
      if (doc.type === 'sheet') {
        const s = doc.data.sheets[0];
        const cells = s.cells;
        let maxR = -1, maxC = -1;
        Object.keys(cells).forEach((k) => { const m = /^(\d+),(\d+)$/.exec(k); if (m) { maxR = Math.max(maxR, +m[1]); maxC = Math.max(maxC, +m[2]); } });
        const lines = [];
        for (let r = 0; r <= maxR; r++) {
          const row = [];
          for (let c = 0; c <= maxC; c++) { const cl = cells[r + ',' + c]; row.push(cl ? String(cl.v == null ? '' : cl.v).replace(/\|/g, '\\|') : ''); }
          lines.push('| ' + row.join(' | ') + ' |');
          if (r === 0) lines.push('| ' + row.map(() => '---').join(' | ') + ' |');
        }
        return { text: lines.join('\n'), name: base + '.md', mime: 'text/markdown' };
      }
      return { text: doc.data.slides.map((s, i) => '## 第 ' + (i + 1) + ' 页\n\n' + s.shapes.map((x) => x.text || '').filter(Boolean).join('\n\n')).join('\n\n'), name: base + '.md', mime: 'text/markdown' };
    }
    if (target === 'html') {
      let body;
      if (doc.type === 'doc') body = doc.data.html;
      else if (doc.type === 'sheet') body = doc.data.sheets.map((s) => '<h3>' + FW.escapeHtml(s.name) + '</h3>' + global.OFFICE.sheetToHtml(s)).join('');
      else body = doc.data.slides.map((sl, i) =>
        '<section style="width:' + doc.data.size.w + 'px;height:' + doc.data.size.h + 'px;position:relative;overflow:hidden;background:' + (sl.bg || '#fff') +
        ';margin:0 auto 22px;box-shadow:0 2px 10px rgba(0,0,0,.16)">' +
        sl.shapes.map((sh) => {
          const st = 'position:absolute;left:' + sh.x + 'px;top:' + sh.y + 'px;width:' + sh.w + 'px;height:' + sh.h + 'px;';
          if (sh.type === 'text') return '<div style="' + st + 'display:flex;align-items:' + (sh.valign === 'middle' ? 'center' : 'flex-start') +
            ';justify-content:' + (sh.align === 'center' ? 'center' : sh.align === 'right' ? 'flex-end' : 'flex-start') +
            ';font-size:' + (sh.size || 18) + 'px;color:' + (sh.color || '#000') + (sh.bold ? ';font-weight:700' : '') +
            ';text-align:' + (sh.align || 'left') + '">' + FW.escapeHtml(String(sh.text || '')).replace(/\n/g, '<br>') + '</div>';
          return '<div style="' + st + (sh.fill ? 'background:' + sh.fill : '') + (sh.type === 'ellipse' ? ';border-radius:50%' : '') + '"></div>';
        }).join('') + '</section>').join('');
      return { text: wrapHtml(doc.title, body, 'body{max-width:none;background:#E8EAED}'), name: base + '.html', mime: 'text/html' };
    }
    if (target === 'pdf') {
      // 交给编辑器打印，中文最可靠
      if (global.FW.app) global.FW.app.openDoc(doc);
      setTimeout(() => { global.FW.toast('已打开文档，请在打印对话框中选择「另存为 PDF」', 3600); global.print(); }, 700);
      return { deferred: true };
    }
    throw new Error('不支持的转换：' + kind + ' → ' + target);
  }

  /* ============================================================
     转换中心界面
     ============================================================ */
  let queue = [];

  function renderQueue() {
    const box = $('#cvQueue');
    if (!queue.length) { box.innerHTML = ''; return; }
    box.innerHTML = queue.map((item, i) => {
      const k = KINDS[item.kind] || { name: '未知', icon: '?', color: '#8D949E' };
      const tg = TARGETS[item.kind] || [];
      return '<div class="cv-card" data-i="' + i + '">' +
        '<div class="cv-ico" style="background:' + k.color + '">' + k.icon + '</div>' +
        '<div class="cv-info"><strong>' + FW.escapeHtml(item.file.name) + '</strong>' +
        '<span>' + k.name + ' · ' + FW.fmtSize(item.file.size) + (item.status ? ' · <b style="color:' + (item.error ? '#D93B2B' : '#21A366') + '">' + FW.escapeHtml(item.status) + '</b>' : '') + '</span></div>' +
        '<div class="cv-acts">' +
        (['docx', 'xlsx', 'pptx', 'csv', 'txt', 'md', 'html', 'json'].indexOf(item.kind) >= 0
          ? '<button class="mini-btn" data-act="edit">打开编辑</button>' : '') +
        (item.kind === 'pdf' ? '<button class="mini-btn" data-act="pdfedit">PDF 批注</button>' : '') +
        tg.map((t) => '<button class="mini-btn" data-act="conv" data-target="' + t[0] + '">转 ' + t[1] + '</button>').join('') +
        '<button class="mini-btn danger" data-act="remove">移除</button>' +
        '</div></div>';
    }).join('');

    // 批量操作
    const pdfs = queue.filter((q) => q.kind === 'pdf');
    const imgs = queue.filter((q) => q.kind === 'image');
    let extra = '';
    if (pdfs.length > 1) extra += '<button class="primary-btn" id="cvMergePdf">合并 ' + pdfs.length + ' 个 PDF</button>';
    if (imgs.length > 1) extra += '<button class="primary-btn" id="cvImagesPdf">' + imgs.length + ' 张图片合并为一个 PDF</button>';
    if (extra) box.insertAdjacentHTML('beforeend', '<div class="cv-batch">' + extra + '</div>');

    const mp = $('#cvMergePdf');
    if (mp) mp.addEventListener('click', async () => {
      mp.textContent = '正在合并……';
      try {
        const r = await mergePdfs(pdfs.map((p) => p.file));
        FW.downloadBytes('合并文档.pdf', r.bytes, 'application/pdf');
        FW.toast('已合并 ' + pdfs.length + ' 个 PDF，共 ' + r.pages + ' 页');
      } catch (e) { FW.toast('合并失败：' + e.message); }
      mp.textContent = '合并 ' + pdfs.length + ' 个 PDF';
    });
    const ip = $('#cvImagesPdf');
    if (ip) ip.addEventListener('click', async () => {
      ip.textContent = '正在生成……';
      try {
        const bytes = await imagesToPdf(imgs.map((p) => p.file));
        FW.downloadBytes('图片合集.pdf', bytes, 'application/pdf');
        FW.toast('已生成 PDF');
      } catch (e) { FW.toast('生成失败：' + e.message); }
      ip.textContent = imgs.length + ' 张图片合并为一个 PDF';
    });
  }

  async function addFiles(files) {
    const list = Array.prototype.slice.call(files);
    let unknown = 0;
    list.forEach((f) => {
      const k = kindOf(f);
      if (!k) { unknown++; return; }
      queue.push({ file: f, kind: k, status: '', error: false });
    });
    if (unknown) FW.toast(unknown + ' 个文件格式无法识别，已跳过');
    renderQueue();
    if (!unknown) FW.toast('已添加 ' + (list.length - unknown) + ' 个文件');
  }

  function bind() {
    const drop = $('#cvDrop');
    const pick = $('#cvPick');
    pick.addEventListener('click', async () => {
      const files = await FW.pickFile('', true);
      if (files && files.length) addFiles(files);
    });
    ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
    ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
    drop.addEventListener('drop', (e) => { if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files); });
    drop.addEventListener('click', async (e) => {
      if (e.target.closest('#cvPick')) return;
      const files = await FW.pickFile('', true);
      if (files && files.length) addFiles(files);
    });

    $('#cvQueue').addEventListener('click', async (e) => {
      const card = e.target.closest('.cv-card');
      const btn = e.target.closest('button');
      if (!card || !btn) return;
      const i = +card.dataset.i;
      const item = queue[i];
      if (!item) return;
      const act = btn.dataset.act;

      if (act === 'remove') { queue.splice(i, 1); renderQueue(); return; }

      if (act === 'edit') {
        try {
          btn.textContent = '读取中…';
          const doc = await readAsDoc(item.file);
          doc.id = FW.uid();
          FW.Store.upsert(doc);
          if (global.FW.app) global.FW.app.openDoc(doc);
        } catch (err) { FW.toast('打开失败：' + err.message, 3000); btn.textContent = '打开编辑'; }
        return;
      }
      if (act === 'pdfedit') {
        const bytes = await FW.readAsArrayBuffer(item.file);
        if (global.FW.app) global.FW.app.openPdf(bytes, item.file.name);
        return;
      }
      if (act === 'conv') {
        const target = btn.dataset.target;
        const old = btn.textContent;
        btn.textContent = '转换中…';
        try {
          const r = await convertOne(item.file, target);
          if (r && r.deferred) { item.status = '已打开，待打印为 PDF'; renderQueue(); return; }
          if (r.text != null) FW.downloadText(r.name, r.text, r.mime);
          else FW.downloadBytes(r.name, r.bytes, r.mime);
          item.status = '已转换：' + r.name + (r.note ? '（' + r.note + '）' : '');
          item.error = false;
          FW.toast('转换完成：' + r.name);
        } catch (err) {
          item.status = '失败：' + err.message;
          item.error = true;
          FW.toast('转换失败：' + err.message, 3200);
        }
        renderQueue();
      }
    });
  }

  global.CONVERT = { bind, addFiles, readAsDoc, convertOne, kindOf, KINDS, mergePdfs, imagesToPdf, fileToPdfBytes, pdfToText };
})(window);
