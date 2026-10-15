/* ============================================================
   pdf-convert.js — PDF 转 Word / Excel
   把 PDF 的文字与表格结构提取出来，生成可编辑的 Word / Excel。
   做法：pdf.js 提取文本与坐标 → 按 Y 聚合成行、按段落合并 → 生成 docx；
        按 X/Y 聚合成行列网格 → 生成 xlsx。全部本机完成。
   ============================================================ */
(function (global) {
  'use strict';
  const FW = global.FW;

  const isCJK = (ch) => /[\u3000-\u303f\u4e00-\u9fa5\uff00-\uffef]/.test(ch);

  /* ============================================================
     一、从 pdf.js 页面提取带坐标的文本项
     ============================================================ */
  async function extractPage(page) {
    const vp = page.getViewport({ scale: 1 });
    const tc = await page.getTextContent();
    const items = [];
    (tc.items || []).forEach((it) => {
      const str = it.str;
      if (!str || !str.trim()) return;
      const tr = it.transform || [1, 0, 0, 1, 0, 0];
      const x = tr[4];
      const baseline = tr[5];
      const size = Math.abs(it.height || tr[3] || 10);
      items.push({
        str: str,
        x: x,
        top: vp.height - baseline,          // 转成「从上往下」的坐标，方便理解
        w: it.width || 0,
        h: size,
        font: it.fontName || '',
        bold: /bold|black|heavy|semibold/i.test(it.fontName || ''),
        italic: /italic|oblique/i.test(it.fontName || '')
      });
    });
    return { items: items, w: vp.width, h: vp.height, rotation: page.rotate || 0 };
  }

  /* ============================================================
     二、聚合成行
     ============================================================ */
  function median(arr) {
    if (!arr.length) return 0;
    const a = arr.slice().sort((x, y) => x - y);
    const m = Math.floor(a.length / 2);
    return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
  }

  function groupLines(items) {
    if (!items.length) return [];
    const tol = Math.max(2, median(items.map((i) => i.h)) * 0.5);
    // top 是「距页面顶部」的距离，所以升序 = 从上到下，才是正确的阅读顺序
    const sorted = items.slice().sort((a, b) => (a.top - b.top) || (a.x - b.x));
    const lines = [];
    sorted.forEach((it) => {
      const last = lines[lines.length - 1];
      if (last && Math.abs(last.top - it.top) <= tol) last.items.push(it);
      else lines.push({ top: it.top, items: [it] });
    });
    lines.forEach((l) => {
      l.items.sort((a, b) => a.x - b.x);
      l.text = l.items.map((i) => i.str).join('').replace(/\s+$/, '');
      l.h = median(l.items.map((i) => i.h));
      l.left = Math.min.apply(null, l.items.map((i) => i.x));
      l.right = Math.max.apply(null, l.items.map((i) => i.x + i.w));
      l.bold = l.items.filter((i) => i.bold).length >= l.items.length / 2;
    });
    return lines;
  }

  /* 行与行之间该不该拼成同一段 */
  function joinLines(lines) {
    let out = '';
    lines.forEach((l, i) => {
      const t = l.text;
      if (i === 0) { out = t; return; }
      const prev = out[out.length - 1] || '';
      const cur = t[0] || '';
      // 中文之间直接接；中英之间留一个空格
      if (isCJK(prev) && isCJK(cur)) out += t;
      else out += ' ' + t;
    });
    return out;
  }

  /* ============================================================
     三、段落分组 + 表格识别
     ============================================================ */
  function toBlocks(pageData) {
    const lines = groupLines(pageData.items);
    if (!lines.length) return [];
    const bodyH = median(lines.map((l) => l.h)) || 12;

    // 同一行里有多个「被大间隙分开的片段」→ 可能是表格的一行
    function cellsOf(line) {
      const cells = [];
      let cur = null;
      line.items.forEach((it) => {
        if (cur == null) { cur = { x: it.x, text: it.str, right: it.x + it.w }; return; }
        const gap = it.x - cur.right;
        if (gap > Math.max(10, it.h * 0.9)) { cells.push(cur); cur = { x: it.x, text: it.str, right: it.x + it.w }; }
        else { cur.text += it.str; cur.right = it.x + it.w; }
      });
      if (cur) cells.push(cur);
      return cells;
    }

    const blocks = [];
    let i = 0;
    while (i < lines.length) {
      // 先看是否进入表格区：连续 ≥2 行都是多单元格
      const rowCells = [];
      let k = i;
      while (k < lines.length) {
        const cs = cellsOf(lines[k]);
        if (cs.length >= 2) { rowCells.push(cs); k++; }
        else break;
      }
      if (rowCells.length >= 2) {
        const maxCols = Math.max.apply(null, rowCells.map((r) => r.length));
        blocks.push({ type: 'table', rows: rowCells, cols: maxCols });
        i = k;
        continue;
      }

      // 否则按段落合并
      const para = [lines[i]];
      let j = i + 1;
      while (j < lines.length) {
        const gap = lines[j].top - lines[j - 1].top;
        const sameSize = Math.abs(lines[j].h - para[0].h) < bodyH * 0.35;
        const nextIsTable = cellsOf(lines[j]).length >= 2 && cellsOf(lines[j + 1] || { items: [] }).length >= 2;
        if (nextIsTable) break;
        if (gap > bodyH * 2.1 || !sameSize) break;
        para.push(lines[j]);
        j++;
      }
      const first = para[0];
      let kind = 'p';
      if (first.h > bodyH * 1.75) kind = 'h1';
      else if (first.h > bodyH * 1.32) kind = 'h2';
      blocks.push({
        type: kind,
        text: joinLines(para),
        size: first.h,
        bold: first.bold,
        left: first.left,
        pageW: pageData.w
      });
      i = j;
    }
    return blocks;
  }

  /* ============================================================
     四、生成 HTML（给 docx 用）
     ============================================================ */
  function esc(s) { return FW.escapeHtml(s); }

  function blocksToHtml(blocks) {
    const out = [];
    blocks.forEach((b) => {
      if (b.type === 'table') {
        let h = '<table><tbody>';
        b.rows.forEach((row) => {
          h += '<tr>';
          row.forEach((c) => { h += '<td>' + esc(c.text) + '</td>'; });
          for (let x = row.length; x < b.cols; x++) h += '<td></td>';
          h += '</tr>';
        });
        out.push(h + '</tbody></table><p><br></p>');
        return;
      }
      const text = esc(b.text);
      if (b.type === 'h1') out.push('<h1>' + text + '</h1>');
      else if (b.type === 'h2') out.push('<h2>' + text + '</h2>');
      else {
        // 居中判断：左右留白接近且明显大于页边距
        const margin = b.left;
        const rightGap = (b.pageW || 595) - (b.right || 0);
        const centered = margin > 60 && Math.abs(margin - rightGap) < 40;
        out.push('<p' + (centered ? ' style="text-align:center"' : '') + '>' + text + '</p>');
      }
    });
    return out.join('\n');
  }

  /* ============================================================
     五、生成表格数据（给 xlsx 用）
     ============================================================ */
  function clusterAxis(values, tol) {
    const sorted = values.slice().sort((a, b) => a - b);
    const centers = [];
    let sum = 0, n = 0, last = null;
    sorted.forEach((v) => {
      if (last == null || v - last <= tol) { sum += v; n++; last = v; }
      else { centers.push(sum / n); sum = v; n = 1; last = v; }
    });
    if (n) centers.push(sum / n);
    return centers;
  }

  function pageToGrid(pageData) {
    const items = pageData.items;
    if (!items.length) return { cells: {}, rows: 0, cols: 0 };
    const bodyH = median(items.map((i) => i.h)) || 12;
    const rowCenters = clusterAxis(items.map((i) => i.top), Math.max(3, bodyH * 0.6));
    const colCenters = clusterAxis(items.map((i) => i.x), Math.max(8, bodyH * 0.7));

    const nearest = (centers, v) => {
      let best = 0, bd = Infinity;
      centers.forEach((c, idx) => { const d = Math.abs(c - v); if (d < bd) { bd = d; best = idx; } });
      return best;
    };

    // 同一格内的多个片段按 x 拼接
    const buckets = {};
    items.forEach((it) => {
      const r = nearest(rowCenters, it.top);
      const c = nearest(colCenters, it.x);
      const k = r + ',' + c;
      if (!buckets[k]) buckets[k] = [];
      buckets[k].push(it);
    });

    const cells = {};
    let maxR = 0, maxC = 0;
    Object.keys(buckets).forEach((k) => {
      const parts = buckets[k].sort((a, b) => a.x - b.x);
      let text = '';
      parts.forEach((p, i) => {
        if (i === 0) { text = p.str; return; }
        const prev = text[text.length - 1] || '', cur = p.str[0] || '';
        text += (isCJK(prev) && isCJK(cur)) ? p.str : ' ' + p.str;
      });
      text = text.trim();
      if (!text) return;
      const p = k.split(',');
      const r = +p[0], c = +p[1];
      maxR = Math.max(maxR, r); maxC = Math.max(maxC, c);
      const num = Number(text.replace(/[,，¥$%\s]/g, ''));
      const isPct = /%$/.test(text);
      let cell;
      if (!isNaN(num) && /^[-+¥$]?[\d,，.\s]+%?$/.test(text)) {
        cell = { v: isPct ? num / 100 : num };
        if (isPct) cell.fmt = 'percent';
      } else cell = { v: text };
      cells[r + ',' + c] = cell;
    });
    return { cells: cells, rows: maxR + 1, cols: maxC + 1 };
  }

  /* ============================================================
     六、对外：整个文档
     ============================================================ */
  async function loadDoc(bytes) {
    if (!global.pdfjsLib) throw new Error('PDF 引擎未加载');
    return await global.pdfjsLib.getDocument({ data: bytes.slice() }).promise;
  }

  async function toDocx(pdfDoc, title, onProgress) {
    const parts = [];
    for (let i = 1; i <= pdfDoc.numPages; i++) {
      if (onProgress) onProgress(i, pdfDoc.numPages);
      const page = await pdfDoc.getPage(i);
      const data = await extractPage(page);
      const blocks = toBlocks(data);
      if (i > 1) parts.push('<div style="page-break-after:always;border-top:1px dashed #C9CFD6;margin:20px 0"></div>');
      parts.push(blocksToHtml(blocks));
    }
    const doc = {
      title: title || 'PDF 转换结果',
      type: 'doc',
      data: { html: parts.join('\n'), paper: 'A4' }
    };
    return { bytes: global.OFFICE.buildDocx(doc), doc: doc };
  }

  async function toXlsx(pdfDoc, title, onProgress) {
    const sheets = [];
    for (let i = 1; i <= pdfDoc.numPages; i++) {
      if (onProgress) onProgress(i, pdfDoc.numPages);
      const page = await pdfDoc.getPage(i);
      const data = await extractPage(page);
      const g = pageToGrid(data);
      sheets.push({
        name: '第' + i + '页',
        cells: g.cells,
        cols: {}, rows: {}, colW: 110, rowH: 24,
        _rows: g.rows, _cols: g.cols
      });
    }
    const doc = {
      title: title || 'PDF 转换结果',
      type: 'sheet',
      data: { sheets: sheets, active: 0, rows: 80, cols: 30 }
    };
    return { bytes: global.OFFICE.buildXlsx(doc), doc: doc };
  }

  /** 从 File 对象直接转换 */
  async function fromFile(file, target, onProgress) {
    const bytes = await FW.readAsArrayBuffer(file);
    const pdfDoc = await loadDoc(bytes);
    const title = (file.name || 'PDF').replace(/\.pdf$/i, '');
    if (target === 'docx') return await toDocx(pdfDoc, title, onProgress);
    if (target === 'xlsx') return await toXlsx(pdfDoc, title, onProgress);
    throw new Error('不支持的目标格式：' + target);
  }

  /** 从已加载的 PDF 会话转换（PDF 工作台里用） */
  async function fromSession(state, target, onProgress) {
    if (!state || !state.sources || !state.sources.length) throw new Error('请先打开一个 PDF');
    const bytes = state.sources[0].bytes;
    const pdfDoc = await loadDoc(bytes);
    const title = state.title || 'PDF';
    if (target === 'docx') return await toDocx(pdfDoc, title, onProgress);
    if (target === 'xlsx') return await toXlsx(pdfDoc, title, onProgress);
    throw new Error('不支持的目标格式：' + target);
  }

  global.PDFCONV = {
    loadDoc: loadDoc,
    extractPage: extractPage,
    toBlocks: toBlocks,
    toDocx: toDocx,
    toXlsx: toXlsx,
    fromFile: fromFile,
    fromSession: fromSession,
    blocksToHtml: blocksToHtml,
    pageToGrid: pageToGrid
  };
})(window);
