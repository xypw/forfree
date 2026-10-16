/* ============================================================
   office.js — Office 文件读写引擎（纯前端，基于 fflate）
   支持 真实 .docx / .xlsx / .pptx 的解析读取与生成写入
   另含 csv / html / txt / markdown 的互转
   ============================================================ */
(function (global) {
  'use strict';

  const F = global.fflate;
  const esc = global.FW.escapeXml;
  const escH = global.FW.escapeHtml;
  const zip = (files, level) => F.zipSync(files, { level: level == null ? 6 : level });
  const unzip = (bytes) => F.unzipSync(bytes);

  const enc = (s) => new TextEncoder().encode(s);
  const dec = (u8) => new TextDecoder('utf-8').decode(u8);

  /* ================= 通用助手 ================= */
  function colName(n) { // 0 -> A
    let s = '', i = n + 1;
    while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); }
    return s;
  }
  function colIndex(s) { // A -> 0
    let n = 0;
    s = String(s).toUpperCase().replace(/[^A-Z]/g, '');
    for (let i = 0; i < s.length; i++) n = n * 26 + (s.charCodeAt(i) - 64);
    return n - 1;
  }
  function refParse(ref) { // "B12" -> {r:11,c:1}
    const m = /^([A-Z]+)(\d+)$/.exec(String(ref).toUpperCase());
    if (!m) return null;
    return { c: colIndex(m[1]), r: parseInt(m[2], 10) - 1 };
  }
  function refStr(c, r) { return colName(c) + (r + 1); }

  // 按 localName 查找（忽略命名空间前缀差异）
  function kids(node, name) {
    const out = [];
    for (let i = 0; i < node.childNodes.length; i++) {
      const n = node.childNodes[i];
      if (n.nodeType === 1 && (n.localName || n.nodeName) === name) out.push(n);
    }
    return out;
  }
  function descend(node, name) {
    const out = [];
    (function walk(n) {
      for (let i = 0; i < n.childNodes.length; i++) {
        const c = n.childNodes[i];
        if (c.nodeType !== 1) continue;
        if ((c.localName || c.nodeName) === name) out.push(c);
        walk(c);
      }
    })(node);
    return out;
  }
  function attr(node, name) {
    return node.getAttribute(name) || node.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', name) || '';
  }
  function xmlDoc(text) {
    return new DOMParser().parseFromString(text, 'application/xml');
  }

  /* ============================================================
     一、DOCX 生成
     ============================================================ */
  const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';

  function pxToHalfPt(v) { return Math.max(2, Math.round(parseFloat(v) * 1.5)); } // px -> half-point

  function inlineXml(node, inh, out) {
    for (let i = 0; i < node.childNodes.length; i++) {
      const n = node.childNodes[i];
      if (n.nodeType === 3) {
        const t = n.nodeValue.replace(/\s+/g, ' ');
        if (t) out.push(run(t, inh));
        continue;
      }
      if (n.nodeType !== 1) continue;
      const tag = n.tagName.toLowerCase();
      if (tag === 'br') { out.push('<w:r><w:br/></w:r>'); continue; }
      if (tag === 'img') continue;
      const s = Object.assign({}, inh);
      const st = n.style || {};
      if (tag === 'b' || tag === 'strong') s.b = 1;
      if (tag === 'i' || tag === 'em') s.i = 1;
      if (tag === 'u') s.u = 1;
      if (tag === 's' || tag === 'del' || tag === 'strike') s.strike = 1;
      if (tag === 'sup') s.vert = 'superscript';
      if (tag === 'sub') s.vert = 'subscript';
      if (tag === 'code') { s.font = 'Consolas'; }
      if (tag === 'a') { s.color = '2B7FE0'; s.u = 1; }
      if (st.fontWeight === 'bold' || st.fontWeight >= 600) s.b = 1;
      if (st.fontStyle === 'italic') s.i = 1;
      if (st.textDecoration && st.textDecoration.indexOf('underline') >= 0) s.u = 1;
      if (st.color) s.color = rgbToHex(st.color);
      if (st.fontSize) s.sz = pxToHalfPt(st.fontSize);
      if (st.fontFamily) s.font = st.fontFamily.split(',')[0].replace(/["']/g, '').trim();
      if (st.backgroundColor && st.backgroundColor !== 'transparent') s.highlight = rgbToHex(st.backgroundColor);
      inlineXml(n, s, out);
    }
  }

  function rgbToHex(c) {
    if (!c) return null;
    if (c[0] === '#') return c.slice(1).toUpperCase();
    const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(c);
    if (!m) return null;
    return [m[1], m[2], m[3]].map((v) => (+v).toString(16).padStart(2, '0')).join('').toUpperCase();
  }

  function run(text, s) {
    const props = [];
    if (s.font) props.push('<w:rFonts w:ascii="' + esc(s.font) + '" w:hAnsi="' + esc(s.font) + '" w:eastAsia="' + esc(s.font) + '"/>');
    if (s.b) props.push('<w:b/>');
    if (s.i) props.push('<w:i/>');
    if (s.strike) props.push('<w:strike/>');
    if (s.color) props.push('<w:color w:val="' + esc(s.color) + '"/>');
    if (s.sz) props.push('<w:sz w:val="' + s.sz + '"/><w:szCs w:val="' + s.sz + '"/>');
    if (s.highlight) props.push('<w:highlight w:val="' + esc(s.highlight) + '"/>');
    if (s.u) props.push('<w:u w:val="single"/>');
    if (s.vert) props.push('<w:vertAlign w:val="' + s.vert + '"/>');
    const rPr = props.length ? '<w:rPr>' + props.join('') + '</w:rPr>' : '';
    return '<w:r>' + rPr + '<w:t xml:space="preserve">' + esc(text) + '</w:t></w:r>';
  }

  function paraXml(runs, opt) {
    opt = opt || {};
    const p = [];
    if (opt.style) p.push('<w:pStyle w:val="' + opt.style + '"/>');
    if (opt.before || opt.after) p.push('<w:spacing w:before="' + (opt.before || 0) + '" w:after="' + (opt.after || 0) + '"/>');
    if (opt.indent) p.push('<w:ind w:left="' + opt.indent + '"/>');
    if (opt.align) p.push('<w:jc w:val="' + opt.align + '"/>');
    const pPr = p.length ? '<w:pPr>' + p.join('') + '</w:pPr>' : '';
    return '<w:p>' + pPr + (runs || '') + '</w:p>';
  }

  function htmlToBody(html) {
    const root = document.createElement('div');
    root.innerHTML = html || '';
    const out = [];

    function walkBlocks(container, listCtx) {
      Array.prototype.forEach.call(container.childNodes, (n) => {
        if (n.nodeType === 3) {
          const t = n.nodeValue.replace(/\s+/g, ' ').trim();
          if (t) { const rs = []; inlineXml({ childNodes: [document.createTextNode(t)] }, {}, rs); out.push(paraXml(rs.join(''))); }
          return;
        }
        if (n.nodeType !== 1) return;
        const tag = n.tagName.toLowerCase();
        const st = n.style || {};
        const align = st.textAlign || n.getAttribute('align') || '';

        if (tag === 'table') { out.push(tableXml(n)); return; }

        const isBlock = ['p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'pre', 'section', 'article'].indexOf(tag) >= 0;
        const isLi = tag === 'li';
        const isList = tag === 'ul' || tag === 'ol';

        if (isList) { walkBlocks(n, { type: tag, i: 0 }); return; }

        if (isLi) {
          const rs = [];
          const prefix = listCtx && listCtx.type === 'ol' ? (++listCtx.i) + '. ' : '• ';
          inlineXml(n, {}, rs);
          out.push(paraXml(run(prefix, {}) + rs.join(''), { indent: 420 }));
          return;
        }

        if (isBlock) {
          // 如果内部还嵌套着块级元素，继续向下拆分，避免把结构压平
          const BLOCK_TAGS = ['p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'table', 'blockquote', 'section', 'article', 'pre'];
          const hasBlockChild = Array.prototype.some.call(n.childNodes, (ch) =>
            ch.nodeType === 1 && BLOCK_TAGS.indexOf(ch.tagName.toLowerCase()) >= 0);
          if (hasBlockChild) { walkBlocks(n, listCtx); return; }

          const rs = [];
          inlineXml(n, {}, rs);
          let opt = { align: align === 'center' ? 'center' : align === 'right' ? 'right' : align === 'justify' ? 'both' : '' };
          if (tag === 'h1') { opt.style = 'Heading1'; opt.after = 180; }
          else if (tag === 'h2') { opt.style = 'Heading2'; opt.after = 160; }
          else if (tag === 'h3') { opt.style = 'Heading3'; opt.after = 140; }
          else opt.after = 100;
          if (st.paddingLeft || st.marginLeft) opt.indent = Math.round(parseFloat(st.paddingLeft || st.marginLeft) * 15);
          if (tag === 'blockquote') opt.indent = 420;
          if (!rs.length && tag === 'p') { out.push(paraXml('')); return; }
          out.push(paraXml(rs.join(''), opt));
          return;
        }

        // 行内元素裸奔在根上
        const rs = [];
        inlineXml(n, {}, rs);
        if (rs.length) out.push(paraXml(rs.join('')));
      });
    }

    function tableXml(tbl) {
      const rows = descend(tbl, 'tr');
      if (!rows.length) return '';
      let maxC = 0;
      const grid = rows.map((tr) => kids(tr, 'td').concat(kids(tr, 'th')));
      grid.forEach((r) => { maxC = Math.max(maxC, r.length); });
      const totalW = 9360;
      const cw = maxC ? Math.floor(totalW / maxC) : totalW;
      let xml = '<w:tbl><w:tblPr><w:tblW w:w="' + totalW + '" w:type="dxa"/>' +
        '<w:tblBorders>' +
        ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map((s) =>
          '<w:' + s + ' w:val="single" w:sz="4" w:space="0" w:color="C9CFD6"/>').join('') +
        '</w:tblBorders></w:tblPr><w:tblGrid>' +
        Array.from({ length: maxC }, () => '<w:gridCol w:w="' + cw + '"/>').join('') + '</w:tblGrid>';
      grid.forEach((cells) => {
        xml += '<w:tr>';
        cells.forEach((td) => {
          const isTh = td.tagName.toLowerCase() === 'th';
          const rs = [];
          inlineXml(td, isTh ? { b: 1 } : {}, rs);
          xml += '<w:tc><w:tcPr><w:tcW w:w="' + cw + '" w:type="dxa"/>' +
            (isTh ? '<w:shd w:val="clear" w:fill="F2F3F5"/>' : '') + '</w:tcPr>' +
            paraXml(rs.join('')) + '</w:tc>';
        });
        xml += '</w:tr>';
      });
      return xml + '</w:tbl>' + paraXml('');
    }

    walkBlocks(root, null);
    return out.join('');
  }

  function buildDocx(doc) {
    const body = htmlToBody(doc.data.html);
    const title = esc(doc.title || '文档');
    const sect = '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>' +
      '<w:pgMar w:top="1440" w:right="1418" w:bottom="1440" w:left="1418" w:header="851" w:footer="992" w:gutter="0"/></w:sectPr>';

    const documentXml =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<w:document ' + W + ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<w:body>' + body + sect + '</w:body></w:document>';

    const stylesXml =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<w:styles ' + W + '>' +
      '<w:docDefaults><w:rPrDefault><w:rPr>' +
      '<w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="宋体" w:cs="Times New Roman"/>' +
      '<w:sz w:val="21"/><w:szCs w:val="21"/></w:rPr></w:rPrDefault>' +
      '<w:pPrDefault><w:pPr><w:spacing w:after="100" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault>' +
      '</w:docDefaults>' +
      '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>' +
      ['Heading1|标题 1|36|1F2328', 'Heading2|标题 2|32|1F2328', 'Heading3|标题 3|28|1F2328']
        .map((s) => {
          const p = s.split('|');
          return '<w:style w:type="paragraph" w:styleId="' + p[0] + '"><w:name w:val="' + p[1] + '"/>' +
            '<w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:outlineLvl w:val="' + (parseInt(p[0].slice(-1)) - 1) + '"/></w:pPr>' +
            '<w:rPr><w:b/><w:sz w:val="' + p[2] + '"/><w:szCs w:val="' + p[2] + '"/><w:color w:val="' + p[3] + '"/></w:rPr></w:style>';
        }).join('') +
      '</w:styles>';

    const contentTypes =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
      '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
      '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>' +
      '</Types>';

    const rootRels =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
      '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
      '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>' +
      '</Relationships>';

    const docRels =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
      '</Relationships>';

    const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
    const core =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" ' +
      'xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
      '<dc:title>' + title + '</dc:title><dc:creator>ForFree</dc:creator><cp:lastModifiedBy>ForFree</cp:lastModifiedBy>' +
      '<dcterms:created xsi:type="dcterms:W3CDTF">' + now + '</dcterms:created>' +
      '<dcterms:modified xsi:type="dcterms:W3CDTF">' + now + '</dcterms:modified></cp:coreProperties>';

    const app =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" ' +
      'xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">' +
      '<Application>ForFree</Application><AppVersion>1.0</AppVersion></Properties>';

    return zip({
      '[Content_Types].xml': enc(contentTypes),
      '_rels/.rels': enc(rootRels),
      'word/document.xml': enc(documentXml),
      'word/styles.xml': enc(stylesXml),
      'word/_rels/document.xml.rels': enc(docRels),
      'docProps/core.xml': enc(core),
      'docProps/app.xml': enc(app)
    });
  }

  /* ============================================================
     二、DOCX 解析
     ============================================================ */
  function parseDocx(bytes) {
    const files = unzip(bytes);
    const entry = files['word/document.xml'];
    if (!entry) throw new Error('不是有效的 .docx 文件（缺少 word/document.xml）');
    const dom = xmlDoc(dec(entry));
    const body = descend(dom, 'body')[0] || dom.documentElement;
    const html = [];
    renderDocxBlocks(body, html, {});
    return { html: html.join('') || '<p></p>' };
  }

  function docxRunsToHtml(p) {
    const parts = [];
    descend(p, 'r').forEach((r) => {
      const rPr = kids(r, 'rPr')[0];
      let b = false, i = false, u = false, strike = false, color = null, sz = null, font = null, hl = null;
      if (rPr) {
        b = kids(rPr, 'b').length > 0;
        i = kids(rPr, 'i').length > 0;
        u = kids(rPr, 'u').length > 0;
        strike = kids(rPr, 'strike').length > 0;
        const c = kids(rPr, 'color')[0]; if (c) { const v = c.getAttribute('w:val') || c.getAttribute('val'); if (v && v !== 'auto') color = '#' + v; }
        const s = kids(rPr, 'sz')[0]; if (s) { const v = s.getAttribute('w:val') || s.getAttribute('val'); if (v) sz = Math.round(parseInt(v, 10) / 1.5); }
        const f = kids(rPr, 'rFonts')[0]; if (f) font = f.getAttribute('w:eastAsia') || f.getAttribute('w:ascii');
        const h = kids(rPr, 'highlight')[0]; if (h) { const v = h.getAttribute('w:val') || h.getAttribute('val'); if (v && v !== 'none') hl = '#' + (v === 'yellow' ? 'FFF176' : v); }
      }
      let text = '';
      Array.prototype.forEach.call(r.childNodes, (n) => {
        if (n.nodeType !== 1) return;
        const ln = n.localName || n.nodeName;
        if (ln === 't') text += n.textContent;
        else if (ln === 'br') text += '\n';
        else if (ln === 'tab') text += '\t';
      });
      if (!text) return;
      const styles = [];
      if (color) styles.push('color:' + color);
      if (sz) styles.push('font-size:' + sz + 'px');
      if (font) styles.push('font-family:' + font);
      if (hl) styles.push('background-color:' + hl);
      let t = escH(text).replace(/\n/g, '<br>');
      if (u) t = '<u>' + t + '</u>';
      if (strike) t = '<s>' + t + '</s>';
      if (i) t = '<em>' + t + '</em>';
      if (b) t = '<strong>' + t + '</strong>';
      parts.push(styles.length ? '<span style="' + styles.join(';') + '">' + t + '</span>' : t);
    });
    return parts.join('');
  }

  function docxAlign(pPr) {
    if (!pPr) return '';
    const jc = kids(pPr, 'jc')[0];
    if (!jc) return '';
    const v = jc.getAttribute('w:val') || jc.getAttribute('val');
    return v === 'center' ? 'center' : v === 'right' ? 'right' : v === 'both' ? 'justify' : 'left';
  }

  function renderDocxBlocks(container, out, opt) {
    Array.prototype.forEach.call(container.childNodes, (node) => {
      if (node.nodeType !== 1) return;
      const ln = node.localName || node.nodeName;
      if (ln === 'p') {
        const pPr = kids(node, 'pPr')[0];
        const inner = docxRunsToHtml(node);
        const styleNode = pPr && kids(pPr, 'pStyle')[0];
        const styleId = styleNode ? (styleNode.getAttribute('w:val') || styleNode.getAttribute('val')) : '';
        const align = docxAlign(pPr);
        const numPr = pPr && kids(pPr, 'numPr')[0];
        let tag = 'p';
        if (/Heading1|^1$/.test(styleId)) tag = 'h1';
        else if (/Heading2|^2$/.test(styleId)) tag = 'h2';
        else if (/Heading3|^3$/.test(styleId)) tag = 'h3';
        const st = align ? ' style="text-align:' + align + '"' : '';
        if (numPr) out.push('<p' + st + '>• ' + (inner || '') + '</p>');
        else out.push('<' + tag + st + '>' + (inner || '<br>') + '</' + tag + '>');
      } else if (ln === 'tbl') {
        const rows = kids(node, 'tr');
        let h = '<table>';
        rows.forEach((tr) => {
          h += '<tr>';
          kids(tr, 'tc').forEach((tc) => {
            const isHead = opt.headerRow !== false && rows.indexOf(tr) === 0;
            h += (isHead ? '<th>' : '<td>') + (docxRunsToHtml(tc) || '') + (isHead ? '</th>' : '</td>');
          });
          h += '</tr>';
        });
        out.push(h + '</table>');
      } else if (ln === 'sdt') {
        const content = kids(node, 'sdtContent')[0];
        if (content) renderDocxBlocks(content, out, opt);
      }
    });
  }

  /* ============================================================
     三、XLSX 生成
     ============================================================ */
  function buildXlsx(doc) {
    const sheets = doc.data.sheets || [];
    const styleReg = { fonts: [], fills: [], borders: [], xfs: [], map: {} };

    function idx(list, obj, keyFn) {
      const k = keyFn(obj);
      const found = list.findIndex((x) => keyFn(x) === k);
      if (found >= 0) return found;
      list.push(obj);
      return list.length - 1;
    }

    // 基础填充：0=none 1=gray125（Excel 约定）
    styleReg.fills.push({ patternType: 'none' });
    styleReg.fills.push({ patternType: 'gray125' });

    function styleIdFor(cell) {
      const b = !!cell.b, i = !!cell.i, u = !!cell.u;
      const color = (cell.color || '').replace('#', '').toUpperCase();
      const bg = (cell.bg || '').replace('#', '').toUpperCase();
      const sz = cell.size ? Math.round(cell.size * 0.75) : 11;
      const align = cell.align || '';
      if (!b && !i && !u && !color && !bg && !align) return 0;
      const fId = idx(styleReg.fonts, { b: b, i: i, u: u, color: color, sz: sz }, (o) => [o.b, o.i, o.u, o.color, o.sz].join('|'));
      const flId = bg ? idx(styleReg.fills, { patternType: 'solid', fgColor: bg }, (o) => o.patternType + (o.fgColor || '')) : 0;
      const bdId = 0;
      const xfKey = [fId, flId, bdId, align].join('|');
      let xf = styleReg.map[xfKey];
      if (xf == null) {
        xf = styleReg.xfs.length;
        styleReg.xfs.push({ fId: fId, flId: flId, bdId: bdId, align: align });
        styleReg.map[xfKey] = xf;
      }
      return xf + 1; // 0 号留给默认
    }

    function colLetterOfCell(ref) { const p = refParse(ref); return p ? colName(p.c) : 'A'; }

    const sheetXmls = {};
    sheets.forEach((sheet, si) => {
      const cells = sheet.cells || {};
      const rowsMap = {};
      Object.keys(cells).forEach((key) => {
        const p = /^(\d+),(\d+)$/.exec(key);
        if (!p) return;
        const r = +p[1], c = +p[2];
        (rowsMap[r] = rowsMap[r] || []).push({ r: r, c: c, cell: cells[key] });
      });
      const rowNums = Object.keys(rowsMap).map(Number).sort((a, b) => a - b);
      let maxC = 0, maxR = 0;
      let sd = '<sheetData>';
      rowNums.forEach((r) => {
        const list = rowsMap[r].sort((a, b) => a.c - b.c);
        const ht = (sheet.rows && sheet.rows[r]) || null;
        sd += '<row r="' + (r + 1) + '"' + (ht ? ' ht="' + ht + '" customHeight="1"' : '') + '>';
        list.forEach((it) => {
          const ref = refStr(it.c, it.r);
          maxC = Math.max(maxC, it.c); maxR = Math.max(maxR, it.r);
          const raw = it.cell.v;
          const formula = it.cell.f;
          const sAttr = ' s="' + styleIdFor(it.cell) + '"';
          if (formula) {
            sd += '<c r="' + ref + '"' + sAttr + '><f>' + esc(String(formula).replace(/^=/, '')) + '</f>' +
              (raw != null && raw !== '' ? '<v>' + esc(String(raw)) + '</v>' : '') + '</c>';
          } else if (raw == null || raw === '') {
            sd += '<c r="' + ref + '"' + sAttr + '/>';
          } else if (typeof raw === 'number' && isFinite(raw)) {
            sd += '<c r="' + ref + '"' + sAttr + '><v>' + raw + '</v></c>';
          } else if (typeof raw === 'boolean') {
            sd += '<c r="' + ref + '" t="b"' + sAttr + '><v>' + (raw ? 1 : 0) + '</v></c>';
          } else {
            sd += '<c r="' + ref + '" t="inlineStr"' + sAttr + '><is><t xml:space="preserve">' + esc(String(raw)) + '</t></is></c>';
          }
        });
        sd += '</row>';
      });
      sd += '</sheetData>';

      const cols = [];
      Object.keys(sheet.cols || {}).forEach((c) => {
        const w = sheet.cols[c];
        if (w) cols.push('<col min="' + (+c + 1) + '" max="' + (+c + 1) + '" width="' + (w / 7).toFixed(2) + '" customWidth="1"/>');
      });
      const dim = maxR || maxC ? '<dimension ref="A1:' + refStr(Math.max(maxC, 0), Math.max(maxR, 0)) + '"/>' : '';
      const pane = sheet.freeze
        ? '<sheetViews><sheetView workbookViewId="0"><pane ySplit="' + sheet.freeze + '" topLeftCell="A' + (sheet.freeze + 1) + '" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'
        : '<sheetViews><sheetView workbookViewId="0"/></sheetViews>';

      sheetXmls['xl/worksheets/sheet' + (si + 1) + '.xml'] =
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' + dim + pane +
        (cols.length ? '<cols>' + cols.join('') + '</cols>' : '') + sd + '</worksheet>';
    });

    // styles.xml
    const fontsXml = ['<font><sz val="11"/><color theme="1"/><name val="Calibri"/></font>']
      .concat(styleReg.fonts.map((f) =>
        '<font>' + (f.b ? '<b/>' : '') + (f.i ? '<i/>' : '') + (f.u ? '<u/>' : '') +
        '<sz val="' + f.sz + '"/>' + (f.color ? '<color rgb="FF' + f.color + '"/>' : '<color theme="1"/>') +
        '<name val="Calibri"/></font>')).join('');

    const fillsXml = styleReg.fills.map((f) =>
      '<fill><patternFill patternType="' + f.patternType + '">' +
      (f.fgColor ? '<fgColor rgb="FF' + f.fgColor + '"/><bgColor indexed="64"/>' : '') +
      '</patternFill></fill>').join('');

    const xfsXml = ['<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>']
      .concat(styleReg.xfs.map((x) =>
        '<xf numFmtId="0" fontId="' + (x.fId + 1) + '" fillId="' + x.flId + '" borderId="0" xfId="0" applyFont="1"' +
        (x.flId ? ' applyFill="1"' : '') + '>' +
        (x.align ? '<alignment horizontal="' + x.align + '" vertical="center"/>' : '') +
        '</xf>')).join('');

    const stylesXml =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<fonts count="' + (styleReg.fonts.length + 1) + '">' + fontsXml + '</fonts>' +
      '<fills count="' + styleReg.fills.length + '">' + fillsXml + '</fills>' +
      '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
      '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
      '<cellXfs count="' + (styleReg.xfs.length + 1) + '">' + xfsXml + '</cellXfs>' +
      '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
      '</styleSheet>';

    const sheetTags = sheets.map((s, i) =>
      '<sheet name="' + esc(s.name || ('Sheet' + (i + 1))) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>').join('');
    const workbookXml =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<sheets>' + sheetTags + '</sheets></workbook>';

    const wbRels =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      sheets.map((s, i) => '<Relationship Id="rId' + (i + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>').join('') +
      '<Relationship Id="rId' + (sheets.length + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
      '</Relationships>';

    const contentTypes =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      sheets.map((s, i) => '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>').join('') +
      '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
      '</Types>';

    const rootRels =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
      '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
      '</Relationships>';

    const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
    const core =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" ' +
      'xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
      '<dc:title>' + esc(doc.title || '表格') + '</dc:title><dc:creator>ForFree</dc:creator>' +
      '<dcterms:created xsi:type="dcterms:W3CDTF">' + now + '</dcterms:created>' +
      '<dcterms:modified xsi:type="dcterms:W3CDTF">' + now + '</dcterms:modified></cp:coreProperties>';

    const files = {
      '[Content_Types].xml': enc(contentTypes),
      '_rels/.rels': enc(rootRels),
      'xl/workbook.xml': enc(workbookXml),
      'xl/_rels/workbook.xml.rels': enc(wbRels),
      'xl/styles.xml': enc(stylesXml),
      'docProps/core.xml': enc(core)
    };
    Object.keys(sheetXmls).forEach((k) => { files[k] = enc(sheetXmls[k]); });
    return zip(files);
  }

  /* ============================================================
     四、XLSX 解析
     ============================================================ */
  function parseXlsx(bytes) {
    const files = unzip(bytes);
    const wbEntry = files['xl/workbook.xml'];
    if (!wbEntry) throw new Error('不是有效的 .xlsx 文件（缺少 xl/workbook.xml）');
    const wbDom = xmlDoc(dec(wbEntry));
    const relsEntry = files['xl/_rels/workbook.xml.rels'];
    const relMap = {};
    if (relsEntry) {
      descend(xmlDoc(dec(relsEntry)), 'Relationship').forEach((r) => {
        relMap[r.getAttribute('Id')] = r.getAttribute('Target').replace(/^\/?xl\//, '').replace(/^\//, '');
      });
    }
    // 共享字符串
    let shared = [];
    if (files['xl/sharedStrings.xml']) {
      shared = descend(xmlDoc(dec(files['xl/sharedStrings.xml'])), 'si').map((si) =>
        descend(si, 't').map((t) => t.textContent).join(''));
    }
    // 单元格样式（字体 / 颜色 / 填充 / 对齐 / 数字格式）
    const styles = files['xl/styles.xml'] ? parseXlsxStyles(xmlDoc(dec(files['xl/styles.xml']))) : null;

    const sheets = [];
    const sheetNodes = descend(wbDom, 'sheet');
    sheetNodes.forEach((sn, i) => {
      const name = sn.getAttribute('name') || ('Sheet' + (i + 1));
      const rid = sn.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id') || sn.getAttribute('r:id');
      let target = relMap[rid] || ('worksheets/sheet' + (i + 1) + '.xml');
      let entry = files['xl/' + target] || files[target] || files['xl/' + target.replace(/^\.\//, '')];
      if (!entry) { target = target.replace(/^\.\.\//, ''); entry = files[target] || files['xl/' + target]; }
      const sheet = { name: name, cells: {}, cols: {}, rows: {}, colW: 88, rowH: 24 };
      if (entry) {
        const sdom = xmlDoc(dec(entry));
        descend(sdom, 'col').forEach((c) => {
          const mn = parseInt(c.getAttribute('min'), 10), mx = parseInt(c.getAttribute('max'), 10);
          const w = parseFloat(c.getAttribute('width'));
          if (w) for (let k = mn; k <= mx && k <= 200; k++) sheet.cols[k - 1] = Math.round(w * 7);
        });
        descend(sdom, 'row').forEach((row) => {
          const rNum = parseInt(row.getAttribute('r'), 10);
          if (!rNum) return;
          const ht = parseFloat(row.getAttribute('ht'));
          if (ht) sheet.rows[rNum - 1] = Math.round(ht * 1.333);
          kids(row, 'c').forEach((c) => {
            const ref = refParse(c.getAttribute('r') || '');
            if (!ref) return;
            const t = c.getAttribute('t');
            const fNode = kids(c, 'f')[0];
            const vNode = kids(c, 'v')[0];
            let val = null;
            if (t === 'inlineStr') {
              val = descend(c, 't').map((x) => x.textContent).join('');
            } else if (t === 's') {
              const idx2 = vNode ? parseInt(vNode.textContent, 10) : -1;
              val = shared[idx2] != null ? shared[idx2] : '';
            } else if (t === 'b') {
              val = vNode && vNode.textContent === '1' ? 'TRUE' : 'FALSE';
            } else if (vNode) {
              const num = Number(vNode.textContent);
              val = isNaN(num) ? vNode.textContent : num;
            }
            const cell = { v: val == null ? '' : val };
            if (fNode) cell.f = '=' + fNode.textContent;
            const sIdx = parseInt(c.getAttribute('s') || '0', 10);
            if (sIdx > 0 && styles && styles[sIdx]) Object.assign(cell, styles[sIdx]);
            if (cell.v !== '' || cell.f) sheet.cells[ref.r + ',' + ref.c] = cell;
          });
        });
      }
      sheets.push(sheet);
    });
    return { sheets: sheets.length ? sheets : [{ name: 'Sheet1', cells: {}, cols: {}, rows: {}, colW: 88, rowH: 24 }] };
  }

  // 解析 xl/styles.xml -> cellXfs 索引对应的单元格样式对象数组
  function parseXlsxStyles(sdom) {
    const numFmts = {};
    descend(sdom, 'numFmt').forEach((n) => {
      numFmts[parseInt(n.getAttribute('numFmtId'), 10)] = n.getAttribute('formatCode') || '';
    });
    const builtin = {
      1: '0', 2: '0.00', 3: '#,##0', 4: '#,##0.00', 9: '0%', 10: '0.00%',
      11: '0.00E+00', 37: '#,##0', 38: '#,##0', 39: '#,##0', 40: '#,##0',
      44: 'currency', 48: '0.00E+00'
    };
    const fmtOf = (id) => {
      const code = numFmts[id] != null ? numFmts[id] : builtin[id];
      if (!code) return null;
      if (/%/.test(code)) return 'percent';
      if (/E\+|e\+/.test(code)) return 'sci';
      if (/[$€£¥￥]|\[red\]|\[blue\]/.test(code) || code === 'currency') return 'currency';
      if (/#,##/.test(code)) return 'thousand';
      if (/\.0/.test(code)) return 'number';
      if (/0/.test(code)) return 'int';
      return null;
    };

    const fonts = [];
    const fontsNode = descend(sdom, 'fonts')[0];
    if (fontsNode) kids(fontsNode, 'font').forEach((f) => {
      const o = {};
      if (kids(f, 'b')[0]) o.b = true;
      if (kids(f, 'i')[0]) o.i = true;
      if (kids(f, 'u')[0]) o.u = true;
      const col = kids(f, 'color')[0];
      if (col) {
        const rgb = col.getAttribute('rgb');
        if (rgb && rgb.length >= 6) o.color = '#' + rgb.slice(-6).toUpperCase();
      }
      fonts.push(o);
    });

    const fills = [];
    const fillsNode = descend(sdom, 'fills')[0];
    if (fillsNode) kids(fillsNode, 'fill').forEach((f) => {
      const pf = kids(f, 'patternFill')[0];
      let bg = null;
      if (pf && pf.getAttribute('patternType') && pf.getAttribute('patternType') !== 'none') {
        const fg = kids(pf, 'fgColor')[0];
        if (fg) {
          const rgb = fg.getAttribute('rgb');
          if (rgb && rgb.length >= 6) bg = '#' + rgb.slice(-6).toUpperCase();
        }
      }
      fills.push(bg);
    });

    const out = [];
    const xfsNode = descend(sdom, 'cellXfs')[0];
    if (xfsNode) kids(xfsNode, 'xf').forEach((xf) => {
      const o = {};
      const fid = parseInt(xf.getAttribute('fontId') || '0', 10);
      const flid = parseInt(xf.getAttribute('fillId') || '0', 10);
      const nfid = parseInt(xf.getAttribute('numFmtId') || '0', 10);
      if (fonts[fid]) Object.assign(o, fonts[fid]);
      if (fills[flid]) o.bg = fills[flid];
      const al = kids(xf, 'alignment')[0];
      if (al) {
        const h = al.getAttribute('horizontal');
        if (h === 'center' || h === 'centerContinuous') o.align = 'center';
        else if (h === 'right') o.align = 'right';
        else if (h === 'left') o.align = 'left';
      }
      const fmt = fmtOf(nfid);
      if (fmt) o.fmt = fmt;
      out.push(o);
    });
    return out;
  }

  /* ============================================================
     五、PPTX 生成
     ============================================================ */
  const EMU = 9525; // 1px(96dpi) -> EMU
  const PTX = (px) => Math.round(px * EMU);

  // dataURL 图片 -> { ext, mime, bytes }，供 PPTX 内嵌图片使用
  function dataUrlToImage(url) {
    const m = /^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i.exec(url || '');
    if (!m) return null;
    const mime = m[1].toLowerCase();
    let ext = mime.split('/')[1].replace('jpeg', 'jpg');
    if (ext === 'svg+xml') ext = 'svg';
    try {
      const bin = atob(m[2]);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return { ext: ext, mime: mime, bytes: bytes };
    } catch (e) { return null; }
  }

  function buildPptx(doc) {
    const data = doc.data;
    const Wpx = data.size.w, Hpx = data.size.h;
    const slides = data.slides || [];
    const files = {};
    const slideRelsList = [];

    const media = [];      // 内嵌图片资源 { name, bytes }
    const mediaExts = {};  // 扩展名 -> content type
    slides.forEach((sl, i) => {
      const rels = ['<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>'];
      let nextRid = 2;
      const shapes = (sl.shapes || []).map((sh, si) => {
        let imgRid = null;
        if (sh.type === 'image' && sh.src) {
          const parsed = dataUrlToImage(sh.src);
          if (parsed) {
            const mediaName = 'image' + (media.length + 1) + '.' + parsed.ext;
            media.push({ name: mediaName, bytes: parsed.bytes });
            mediaExts[parsed.ext] = parsed.mime;
            imgRid = 'rId' + (nextRid++);
            rels.push('<Relationship Id="' + imgRid + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/' + mediaName + '"/>');
          }
        }
        return shapeXml(sh, si + 2, imgRid);
      }).join('');
      const bgXml = sl.bg ? '<p:bg><p:bgPr><a:solidFill><a:srgbClr val="' + sl.bg.replace('#', '').toUpperCase() + '"/></a:solidFill><a:effectLst/></p:bgPr></p:bg>' : '';
      const xml =
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
        '<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
        'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">' +
        '<p:cSld>' + bgXml + '<p:spTree>' +
        '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>' +
        '<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>' +
        shapes +
        '</p:spTree></p:cSld><p:clrMapOvr><a:overrideClrMapping bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/></p:clrMapOvr></p:sld>';
      files['ppt/slides/slide' + (i + 1) + '.xml'] = enc(xml);
      slideRelsList.push(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        rels.join('') +
        '</Relationships>');
    });

    files['ppt/slides/_rels/slide1.xml.rels'] = enc(slideRelsList[0] || '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>');
    for (let i = 1; i < slideRelsList.length; i++) files['ppt/slides/_rels/slide' + (i + 1) + '.xml.rels'] = enc(slideRelsList[i]);

    // presentation.xml
    const sldIds = slides.map((s, i) => '<p:sldId id="' + (256 + i) + '" r:id="rId' + (i + 2) + '"/>').join('');
    files['ppt/presentation.xml'] = enc(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
      'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" saveSubsetFonts="1">' +
      '<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>' +
      '<p:sldIdLst>' + sldIds + '</p:sldIdLst>' +
      '<p:sldSz cx="' + PTX(Wpx) + '" cy="' + PTX(Hpx) + '"/>' +
      '<p:notesSz cx="' + PTX(Hpx) + '" cy="' + PTX(Wpx) + '"/>' +
      '</p:presentation>');

    files['ppt/_rels/presentation.xml.rels'] = enc(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>' +
      slides.map((s, i) => '<Relationship Id="rId' + (i + 2) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide' + (i + 1) + '.xml"/>').join('') +
      '<Relationship Id="rId' + (slides.length + 2) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="theme/theme1.xml"/>' +
      '</Relationships>');

    // slideMaster
    files['ppt/slideMasters/slideMaster1.xml'] = enc(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
      'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">' +
      '<p:cSld><p:spTree>' +
      '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>' +
      '<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>' +
      '</p:spTree></p:cSld>' +
      '<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>' +
      '<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst>' +
      '<p:txStyles><p:titleStyle><a:lvl1pPr algn="l"><a:defRPr sz="4400" b="1"><a:solidFill><a:srgbClr val="1F2328"/></a:solidFill><a:latin typeface="+mj-lt"/><a:ea typeface="+mj-ea"/></a:defRPr></a:lvl1pPr></p:titleStyle>' +
      '<p:bodyStyle><a:lvl1pPr algn="l"><a:defRPr sz="2000"><a:solidFill><a:srgbClr val="3C4149"/></a:solidFill><a:latin typeface="+mn-lt"/><a:ea typeface="+mn-ea"/></a:defRPr></a:lvl1pPr></p:bodyStyle>' +
      '<p:otherStyle><a:defPPr><a:defRPr lang="zh-CN"/></a:defPPr></p:otherStyle></p:txStyles></p:sldMaster>');

    files['ppt/slideMasters/_rels/slideMaster1.xml.rels'] = enc(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>' +
      '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/>' +
      '</Relationships>');

    // slideLayout
    files['ppt/slideLayouts/slideLayout1.xml'] = enc(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
      'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" type="blank" preserve="1">' +
      '<p:cSld name="空白"><p:spTree>' +
      '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>' +
      '<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>' +
      '</p:spTree></p:cSld>' +
      '<p:clrMapOvr><a:overrideClrMapping bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/></p:clrMapOvr></p:sldLayout>');

    files['ppt/slideLayouts/_rels/slideLayout1.xml.rels'] = enc(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/>' +
      '</Relationships>');

    // theme
    files['ppt/theme/theme1.xml'] = enc(themeXml());

    // content types
    files['[Content_Types].xml'] = enc(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      Object.keys(mediaExts).map((ext) => '<Default Extension="' + ext + '" ContentType="' + mediaExts[ext] + '"/>').join('') +
      '<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>' +
      '<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>' +
      '<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>' +
      '<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>' +
      slides.map((s, i) => '<Override PartName="/ppt/slides/slide' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>').join('') +
      '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
      '</Types>');

    const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
    files['_rels/.rels'] = enc(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>' +
      '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
      '</Relationships>');

    files['docProps/core.xml'] = enc(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" ' +
      'xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
      '<dc:title>' + esc(doc.title || '演示文稿') + '</dc:title><dc:creator>ForFree</dc:creator>' +
      '<dcterms:created xsi:type="dcterms:W3CDTF">' + now + '</dcterms:created>' +
      '<dcterms:modified xsi:type="dcterms:W3CDTF">' + now + '</dcterms:modified></cp:coreProperties>');

    media.forEach((m) => { files['ppt/media/' + m.name] = m.bytes; });

    return zip(files);
  }

  function shapeXml(sh, id, imgRid) {
    if (sh.type === 'image') {
      if (!imgRid) return '';
      return '<p:pic><p:nvPicPr>' +
        '<p:cNvPr id="' + id + '" name="Picture ' + id + '"/>' +
        '<p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr>' +
        '<p:blipFill><a:blip r:embed="' + imgRid + '"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>' +
        '<p:spPr><a:xfrm><a:off x="' + PTX(sh.x) + '" y="' + PTX(sh.y) + '"/>' +
        '<a:ext cx="' + PTX(sh.w) + '" cy="' + PTX(sh.h) + '"/></a:xfrm>' +
        '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>';
    }
    const fill = sh.fill ? '<a:solidFill><a:srgbClr val="' + sh.fill.replace('#', '').toUpperCase() + '"/></a:solidFill>' : '<a:noFill/>';
    const line = sh.line ? '<a:ln w="' + Math.round((sh.lineW || 1) * 12700) + '"><a:solidFill><a:srgbClr val="' + sh.line.replace('#', '').toUpperCase() + '"/></a:solidFill></a:ln>' : '<a:ln><a:noFill/></a:ln>';

    const text = String(sh.text == null ? '' : sh.text);
    const lines = text.split('\n');
    const sz = Math.round((sh.size || 18) * 100);
    const color = (sh.color || '#1F2328').replace('#', '').toUpperCase();
    const algn = sh.align === 'center' ? 'ctr' : sh.align === 'right' ? 'r' : 'l';
    const anchor = sh.valign === 'middle' ? 'ctr' : sh.valign === 'bottom' ? 'b' : 't';

    const paras = lines.map((ln) =>
      '<a:p><a:pPr algn="' + algn + '"/><a:r><a:rPr lang="zh-CN" sz="' + sz + '"' + (sh.bold ? ' b="1"' : '') +
      (sh.italic ? ' i="1"' : '') + (sh.underline ? ' u="sng"' : '') + ' dirty="0">' +
      '<a:solidFill><a:srgbClr val="' + color + '"/></a:solidFill>' +
      '<a:latin typeface="微软雅黑"/><a:ea typeface="微软雅黑"/></a:rPr>' +
      '<a:t>' + esc(ln) + '</a:t></a:r></a:p>').join('');

    const geom = sh.type === 'rect' ? 'rect' : sh.type === 'ellipse' ? 'ellipse' : 'rect';
    const isText = sh.type === 'text';

    return '<p:sp><p:nvSpPr><p:cNvPr id="' + id + '" name="Shape ' + id + '"/>' +
      '<p:cNvSpPr' + (isText ? ' txBox="1"' : '') + '/><p:nvPr/></p:nvSpPr>' +
      '<p:spPr><a:xfrm><a:off x="' + PTX(sh.x) + '" y="' + PTX(sh.y) + '"/>' +
      '<a:ext cx="' + PTX(sh.w) + '" cy="' + PTX(sh.h) + '"/></a:xfrm>' +
      '<a:prstGeom prst="' + geom + '"><a:avLst/></a:prstGeom>' +
      (isText ? '<a:noFill/><a:ln><a:noFill/></a:ln>' : fill + line) +
      '</p:spPr>' +
      '<p:txBody><a:bodyPr wrap="square" lIns="45720" tIns="27432" rIns="45720" bIns="27432" anchor="' + anchor + '"' + (isText ? ' rtlCol="0"' : '') + '/><a:lstStyle/>' +
      (paras || '<a:p><a:endParaRPr lang="zh-CN"/></a:p>') +
      '</p:txBody></p:sp>';
  }

  function themeXml() {
    const clr = (n, v) => '<a:' + n + '><a:srgbClr val="' + v + '"/></a:' + n + '>';
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="ForFree">' +
      '<a:themeElements>' +
      '<a:clrScheme name="ForFree">' +
      clr('dk1', '1F2328') + clr('lt1', 'FFFFFF') + clr('dk2', '3C4149') + clr('lt2', 'F2F3F5') +
      clr('accent1', '2B7FE0') + clr('accent2', '21A366') + clr('accent3', 'F2994A') +
      clr('accent4', 'D93B2B') + clr('accent5', '8B5CF6') + clr('accent6', '0EA5E9') +
      clr('hlink', '2B7FE0') + clr('folHlink', '8D949E') +
      '</a:clrScheme>' +
      '<a:fontScheme name="ForFree">' +
      '<a:majorFont><a:latin typeface="微软雅黑"/><a:ea typeface="微软雅黑"/><a:cs typeface=""/></a:majorFont>' +
      '<a:minorFont><a:latin typeface="微软雅黑"/><a:ea typeface="微软雅黑"/><a:cs typeface=""/></a:minorFont>' +
      '</a:fontScheme>' +
      '<a:fmtScheme name="ForFree">' +
      '<a:fillStyleLst>' +
      '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>' +
      '<a:solidFill><a:schemeClr val="phClr"><a:tint val="88000"/></a:schemeClr></a:solidFill>' +
      '<a:solidFill><a:schemeClr val="phClr"><a:shade val="88000"/></a:schemeClr></a:solidFill>' +
      '</a:fillStyleLst>' +
      '<a:lnStyleLst>' +
      '<a:ln w="6350" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln>' +
      '<a:ln w="12700" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln>' +
      '<a:ln w="19050" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln>' +
      '</a:lnStyleLst>' +
      '<a:effectStyleLst>' +
      '<a:effectStyle><a:effectLst/></a:effectStyle>' +
      '<a:effectStyle><a:effectLst/></a:effectStyle>' +
      '<a:effectStyle><a:effectLst/></a:effectStyle>' +
      '</a:effectStyleLst>' +
      '<a:bgFillStyleLst>' +
      '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>' +
      '<a:solidFill><a:schemeClr val="phClr"><a:tint val="95000"/></a:schemeClr></a:solidFill>' +
      '<a:solidFill><a:schemeClr val="phClr"><a:shade val="93000"/></a:schemeClr></a:solidFill>' +
      '</a:bgFillStyleLst>' +
      '</a:fmtScheme></a:themeElements>' +
      '<a:objectDefaults/><a:extraClrSchemeLst/></a:theme>';
  }

  /* ============================================================
     六、PPTX 解析
     ============================================================ */
  function parsePptx(bytes) {
    const files = unzip(bytes);
    const pres = files['ppt/presentation.xml'];
    if (!pres) throw new Error('不是有效的 .pptx 文件（缺少 ppt/presentation.xml）');
    const presDom = xmlDoc(dec(pres));

    // 画布尺寸
    let Wpx = 960, Hpx = 540;
    const szNode = descend(presDom, 'sldSz')[0];
    if (szNode) {
      Wpx = Math.round(parseInt(szNode.getAttribute('cx'), 10) / EMU);
      Hpx = Math.round(parseInt(szNode.getAttribute('cy'), 10) / EMU);
    }

    const rels = files['ppt/_rels/presentation.xml.rels'];
    const relMap = {};
    if (rels) descend(xmlDoc(dec(rels)), 'Relationship').forEach((r) => {
      relMap[r.getAttribute('Id')] = r.getAttribute('Target');
    });

    const order = [];
    descend(presDom, 'sldId').forEach((s) => {
      const rid = s.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id') || s.getAttribute('r:id');
      if (relMap[rid]) order.push(relMap[rid]);
    });
    // 若关系表缺失，退化为按文件名排序
    if (!order.length) {
      Object.keys(files).filter((k) => /^ppt\/slides\/slide\d+\.xml$/.test(k))
        .sort((a, b) => parseInt(a.match(/(\d+)/)[1], 10) - parseInt(b.match(/(\d+)/)[1], 10))
        .forEach((k) => order.push(k.replace('ppt/', '')));
    }

    const slides = order.map((target) => {
      const path = 'ppt/' + target.replace(/^\/?ppt\//, '').replace(/^\.\.\//, '');
      const entry = files[path] || files[target];
      const sl = { layout: 'blank', bg: null, shapes: [] };
      if (!entry) return sl;
      const dom = xmlDoc(dec(entry));

      // 背景
      const bgPr = descend(dom, 'bgPr')[0];
      if (bgPr) {
        const c = descend(bgPr, 'srgbClr')[0];
        if (c) sl.bg = '#' + c.getAttribute('val');
      }

      descend(dom, 'sp').forEach((sp, i) => {
        const xfrm = descend(sp, 'xfrm')[0];
        let x = 60, y = 60 + i * 70, w = 400, h = 60;
        if (xfrm) {
          const off = kids(xfrm, 'off')[0], ext = kids(xfrm, 'ext')[0];
          if (off) { x = Math.round(parseInt(off.getAttribute('x') || 0, 10) / EMU); y = Math.round(parseInt(off.getAttribute('y') || 0, 10) / EMU); }
          if (ext) { w = Math.round(parseInt(ext.getAttribute('cx') || 0, 10) / EMU); h = Math.round(parseInt(ext.getAttribute('cy') || 0, 10) / EMU); }
        }
        const txBody = kids(sp, 'txBody')[0];
        let text = '', size = 18, bold = false, italic = false, color = '#1F2328', align = 'left';
        if (txBody) {
          const paras = kids(txBody, 'a:p').concat(descend(txBody, 'p').filter((p) => p.localName === 'p'));
          const lines = [];
          kids(txBody, 'p').forEach((p) => {
            let line = '';
            descend(p, 'r').forEach((r) => {
              const t = descend(r, 't')[0];
              if (t) line += t.textContent;
              const rPr = kids(r, 'rPr')[0];
              if (rPr) {
                const szv = rPr.getAttribute('sz'); if (szv) size = Math.round(parseInt(szv, 10) / 100);
                if (rPr.getAttribute('b') === '1') bold = true;
                if (rPr.getAttribute('i') === '1') italic = true;
                const c = descend(rPr, 'srgbClr')[0]; if (c) color = '#' + c.getAttribute('val');
              }
            });
            const pPr = kids(p, 'pPr')[0];
            if (pPr) { const al = pPr.getAttribute('algn'); if (al === 'ctr') align = 'center'; else if (al === 'r') align = 'right'; }
            lines.push(line);
          });
          text = lines.join('\n');
        }
        if (!text && !txBody) return;
        const prst = descend(sp, 'prstGeom')[0];
        const prstVal = prst ? prst.getAttribute('prst') : 'rect';
        const isTxBox = /txBox="1"/.test(sp.textContent) || /txBox="1"/.test(sp.outerHTML || '');
        const cNvSpPr = descend(sp, 'cNvSpPr')[0];
        const txBox = cNvSpPr && cNvSpPr.getAttribute('txBox') === '1';
        let type = txBox || !prst ? 'text' : prstVal === 'ellipse' ? 'ellipse' : 'rect';
        if (!txBody) type = prstVal === 'ellipse' ? 'ellipse' : 'rect';

        const shape = { id: 's' + i, type: type, x: x, y: y, w: w, h: h, text: text };
        if (type === 'text') { shape.size = size; shape.bold = bold; shape.italic = italic; shape.color = color; shape.align = align; shape.valign = 'middle'; }
        else {
          const sf = descend(sp, 'solidFill')[0];
          if (sf) { const c = descend(sf, 'srgbClr')[0]; if (c) shape.fill = '#' + c.getAttribute('val'); }
        }
        sl.shapes.push(shape);
      });
      if (sl.shapes.length && sl.shapes[0].text) sl.layout = 'title';
      return sl;
    });

    return { size: { w: Wpx, h: Hpx }, slides: slides.length ? slides : [{ layout: 'blank', bg: null, shapes: [] }] };
  }

  /* ============================================================
     七、CSV / HTML / TXT / MD 互转
     ============================================================ */
  function sheetToCsv(sheet) {
    const cells = sheet.cells || {};
    let maxR = -1, maxC = -1;
    Object.keys(cells).forEach((k) => {
      const m = /^(\d+),(\d+)$/.exec(k);
      if (!m) return;
      maxR = Math.max(maxR, +m[1]); maxC = Math.max(maxC, +m[2]);
    });
    const lines = [];
    for (let r = 0; r <= maxR; r++) {
      const row = [];
      for (let c = 0; c <= maxC; c++) {
        const cell = cells[r + ',' + c];
        let v = cell ? (cell.v == null ? '' : String(cell.v)) : '';
        if (/[",\n\r]/.test(v)) v = '"' + v.replace(/"/g, '""') + '"';
        row.push(v);
      }
      lines.push(row.join(','));
    }
    return lines.join('\r\n');
  }

  function csvToCells(text) {
    const rows = [];
    let row = [], cur = '', q = false;
    const s = String(text).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (q) {
        if (ch === '"') { if (s[i + 1] === '"') { cur += '"'; i++; } else q = false; }
        else cur += ch;
      } else {
        if (ch === '"') q = true;
        else if (ch === ',') { row.push(cur); cur = ''; }
        else if (ch === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
        else cur += ch;
      }
    }
    if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
    const cells = {};
    rows.forEach((r, ri) => r.forEach((v, ci) => {
      if (v === '') return;
      const num = Number(v);
      cells[ri + ',' + ci] = { v: v !== '' && !isNaN(num) && /^-?\d+(\.\d+)?$/.test(v.trim()) ? num : v };
    }));
    return cells;
  }

  function docToText(html) {
    const d = document.createElement('div');
    d.innerHTML = String(html || '');
    d.querySelectorAll('br').forEach((b) => b.replaceWith('\n'));
    d.querySelectorAll('p,h1,h2,h3,h4,li,tr,div,blockquote').forEach((b) => b.append('\n'));
    d.querySelectorAll('td,th').forEach((b) => b.append('\t'));
    return (d.textContent || '').replace(/\n{3,}/g, '\n\n').replace(/[ \t]+\n/g, '\n').trim();
  }

  function docToMarkdown(html) {
    const d = document.createElement('div');
    d.innerHTML = String(html || '');
    function inline(n) {
      let out = '';
      Array.prototype.forEach.call(n.childNodes, (c) => {
        if (c.nodeType === 3) { out += c.nodeValue; return; }
        if (c.nodeType !== 1) return;
        const t = c.tagName.toLowerCase();
        const inner = inline(c);
        if (t === 'br') out += '  \n';
        else if (t === 'strong' || t === 'b') out += '**' + inner + '**';
        else if (t === 'em' || t === 'i') out += '*' + inner + '*';
        else if (t === 'u') out += '<u>' + inner + '</u>';
        else if (t === 's' || t === 'del') out += '~~' + inner + '~~';
        else if (t === 'code') out += '`' + inner + '`';
        else if (t === 'a') out += '[' + inner + '](' + (c.getAttribute('href') || '') + ')';
        else out += inner;
      });
      return out;
    }
    const lines = [];
    Array.prototype.forEach.call(d.childNodes, (n) => {
      if (n.nodeType === 3) { const t = n.nodeValue.trim(); if (t) lines.push(t); return; }
      if (n.nodeType !== 1) return;
      const t = n.tagName.toLowerCase();
      const txt = inline(n).trim();
      if (!txt && t !== 'hr') return;
      if (t === 'h1') lines.push('# ' + txt);
      else if (t === 'h2') lines.push('## ' + txt);
      else if (t === 'h3') lines.push('### ' + txt);
      else if (t === 'h4') lines.push('#### ' + txt);
      else if (t === 'li') lines.push('- ' + txt);
      else if (t === 'blockquote') lines.push('> ' + txt);
      else if (t === 'hr') lines.push('---');
      else if (t === 'table') {
        const rows = n.querySelectorAll('tr');
        rows.forEach((tr, ri) => {
          const cs = Array.prototype.map.call(tr.children, (c) => inline(c).trim().replace(/\|/g, '\\|'));
          lines.push('| ' + cs.join(' | ') + ' |');
          if (ri === 0) lines.push('| ' + cs.map(() => '---').join(' | ') + ' |');
        });
      } else lines.push(txt);
      lines.push('');
    });
    return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  function markdownToHtml(md) {
    const lines = String(md || '').replace(/\r\n/g, '\n').split('\n');
    const out = [];
    let inList = false, inCode = false, codeBuf = [];
    const inl = (s) => escH(s)
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2">$1</a>');
    lines.forEach((ln) => {
      if (/^```/.test(ln)) {
        if (inCode) { out.push('<pre>' + escH(codeBuf.join('\n')) + '</pre>'); codeBuf = []; }
        inCode = !inCode; return;
      }
      if (inCode) { codeBuf.push(ln); return; }
      let m;
      if ((m = /^(#{1,6})\s+(.*)$/.exec(ln))) { out.push('<h' + m[1].length + '>' + inl(m[2]) + '</h' + m[1].length + '>'); return; }
      if (/^\s*[-*+]\s+/.test(ln)) { if (!inList) { out.push('<ul>'); inList = true; } out.push('<li>' + inl(ln.replace(/^\s*[-*+]\s+/, '')) + '</li>'); return; }
      if (inList) { out.push('</ul>'); inList = false; }
      if (/^>\s?/.test(ln)) { out.push('<blockquote>' + inl(ln.replace(/^>\s?/, '')) + '</blockquote>'); return; }
      if (/^(---|\*\*\*)$/.test(ln.trim())) { out.push('<hr>'); return; }
      if (!ln.trim()) { out.push(''); return; }
      out.push('<p>' + inl(ln) + '</p>');
    });
    if (inList) out.push('</ul>');
    if (inCode) out.push('<pre>' + escH(codeBuf.join('\n')) + '</pre>');
    return out.join('\n');
  }

  function sheetToHtml(sheet, title) {
    const cells = sheet.cells || {};
    let maxR = -1, maxC = -1;
    Object.keys(cells).forEach((k) => {
      const m = /^(\d+),(\d+)$/.exec(k); if (!m) return;
      maxR = Math.max(maxR, +m[1]); maxC = Math.max(maxC, +m[2]);
    });
    let h = '<table border="1" cellspacing="0" cellpadding="4" style="border-collapse:collapse;font-family:微软雅黑;font-size:13px">';
    for (let r = 0; r <= maxR; r++) {
      h += '<tr>';
      for (let c = 0; c <= maxC; c++) {
        const cell = cells[r + ',' + c];
        const st = [];
        if (cell) {
          if (cell.b) st.push('font-weight:bold');
          if (cell.i) st.push('font-style:italic');
          if (cell.color) st.push('color:' + cell.color);
          if (cell.bg) st.push('background:' + cell.bg);
          if (cell.align) st.push('text-align:' + cell.align);
        }
        h += '<td' + (st.length ? ' style="' + st.join(';') + '"' : '') + '>' + escH(cell ? (cell.v == null ? '' : cell.v) : '') + '</td>';
      }
      h += '</tr>';
    }
    return h + '</table>';
  }

  function slideToHtml(doc) {
    const d = doc.data;
    const slides = d.slides || [];
    const parts = slides.map((sl, i) => {
      const shapes = (sl.shapes || []).map((sh) => {
        const st = ['position:absolute', 'left:' + sh.x + 'px', 'top:' + sh.y + 'px', 'width:' + sh.w + 'px', 'height:' + sh.h + 'px'];
        if (sh.type === 'text') {
          st.push('display:flex', 'align-items:' + (sh.valign === 'middle' ? 'center' : sh.valign === 'bottom' ? 'flex-end' : 'flex-start'));
          st.push('justify-content:' + (sh.align === 'center' ? 'center' : sh.align === 'right' ? 'flex-end' : 'flex-start'));
          st.push('font-size:' + (sh.size || 18) + 'px', 'color:' + (sh.color || '#1F2328'));
          if (sh.bold) st.push('font-weight:700');
          if (sh.italic) st.push('font-style:italic');
          if (sh.underline) st.push('text-decoration:underline');
        } else {
          if (sh.fill) st.push('background:' + sh.fill);
          if (sh.line) st.push('border:' + (sh.lineW || 1) + 'px solid ' + sh.line);
          if (sh.type === 'ellipse') st.push('border-radius:50%');
        }
        const inner = sh.type === 'text' ? '<div style="width:100%;text-align:' + (sh.align || 'left') + '">' +
          escH(String(sh.text || '')).replace(/\n/g, '<br>') + '</div>' : '';
        return '<div style="' + st.join(';') + '">' + inner + '</div>';
      }).join('');
      return '<section style="width:' + d.size.w + 'px;height:' + d.size.h + 'px;position:relative;overflow:hidden;background:' +
        (sl.bg || '#fff') + ';margin:0 auto 22px;box-shadow:0 2px 10px rgba(0,0,0,.16);font-family:微软雅黑">' + shapes + '</section>';
    }).join('');
    return '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><title>' + escH(doc.title) + '</title></head>' +
      '<body style="margin:0;padding:22px;background:#E8EAED">' + parts + '</body></html>';
  }

  /* ============================================================
     八、统一入口
     ============================================================ */
  global.OFFICE = {
    buildDocx, parseDocx,
    buildXlsx, parseXlsx,
    buildPptx, parsePptx,
    sheetToCsv, csvToCells, sheetToHtml,
    docToText, docToMarkdown, markdownToHtml,
    slideToHtml,
    colName, colIndex, refParse, refStr
  };
})(window);
