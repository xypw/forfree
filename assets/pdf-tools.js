/* ============================================================
   pdf-tools.js — PDF 压缩 + 表单填写
   压缩：把每页重渲染为 JPEG 再重建 PDF（对扫描件效果最明显）
   表单：解析 AcroForm 字段 → 页面叠加输入框 → 回写导出
   全部本机完成，不联网。
   ============================================================ */
(function (global) {
  'use strict';
  const FW = global.FW;

  /* ============================================================
     一、压缩
     ============================================================ */
  const PRESETS = {
    extreme: { name: '极限压缩', dpi: 72, quality: 0.5, desc: '体积最小，画质明显下降，适合纯存档' },
    high: { name: '高压缩', dpi: 96, quality: 0.6, desc: '体积小，屏幕阅读够用' },
    balanced: { name: '均衡', dpi: 150, quality: 0.75, desc: '推荐，画质与体积平衡' },
    quality: { name: '高质量', dpi: 200, quality: 0.88, desc: '接近原画质，压缩比有限' }
  };

  function canvasToJpegBytes(canvas, quality) {
    return new Promise((resolve) => {
      canvas.toBlob((blob) => {
        blob.arrayBuffer().then((ab) => resolve(new Uint8Array(ab)));
      }, 'image/jpeg', quality);
    });
  }

  /**
   * 压缩 PDF
   * @param pdfDoc  pdf.js 文档对象
   * @param preset  PRESETS 的键
   * @param onProgress (当前页, 总页数)
   * @returns {bytes, pages}
   */
  async function compress(pdfDoc, preset, onProgress) {
    const cfg = PRESETS[preset] || PRESETS.balanced;
    const scale = cfg.dpi / 72;
    const out = await PDFLib.PDFDocument.create();

    for (let i = 1; i <= pdfDoc.numPages; i++) {
      if (onProgress) onProgress(i, pdfDoc.numPages);
      const page = await pdfDoc.getPage(i);
      // getViewport 已包含页面自身的 /Rotate，宽高就是旋转后的尺寸
      const vp = page.getViewport({ scale: scale });
      const cv = document.createElement('canvas');
      cv.width = Math.max(1, Math.round(vp.width));
      cv.height = Math.max(1, Math.round(vp.height));
      const ctx = cv.getContext('2d');
      ctx.fillStyle = '#FFFFFF';          // JPEG 不支持透明，先铺白底
      ctx.fillRect(0, 0, cv.width, cv.height);
      await page.render({ canvasContext: ctx, viewport: vp }).promise;

      const jpg = await canvasToJpegBytes(cv, cfg.quality);
      const img = await out.embedJpg(jpg);

      const pw = vp.width / scale;         // 还原成 PDF 点，保持原页面尺寸
      const ph = vp.height / scale;
      const p = out.addPage([pw, ph]);
      p.drawImage(img, { x: 0, y: 0, width: pw, height: ph });
    }
    const bytes = await out.save();
    return { bytes: bytes, pages: pdfDoc.numPages, preset: cfg };
  }

  /** 从原始字节压缩（转换中心用） */
  async function compressBytes(bytes, preset, onProgress) {
    const pdfDoc = await global.pdfjsLib.getDocument({ data: bytes.slice() }).promise;
    return await compress(pdfDoc, preset, onProgress);
  }

  /* ============================================================
     二、表单字段
     ============================================================ */
  function refKey(ref) {
    if (!ref) return null;
    if (typeof ref === 'string') return ref;
    if (ref.tag) return ref.tag;
    return String(ref);
  }

  /**
   * 判断字段类型。
   * 注意：不能用 constructor.name —— 浏览器里加载的是 minified 版 pdf-lib，
   * 类名会被压缩成 fd / hd 这样的短名，必须靠方法特征来判。
   */
  function fieldType(f) {
    const has = (m) => typeof f[m] === 'function';
    if (has('check') && has('uncheck') && has('isChecked')) return 'checkbox';
    if (has('addOptionToPage')) return 'radio';
    if (has('isEditable') && has('getOptions')) return 'dropdown';
    if (has('getOptions') && has('select') && has('isMultiselect')) return 'optionlist';
    if (has('getOptions') && has('select')) return 'dropdown';
    if (has('setText') && has('getText')) return 'text';
    if (has('setImage')) return 'button';
    return 'unknown';
  }

  /**
   * 读取 PDF 里的表单字段
   * @returns [{name, type, page, rect, options, value, readOnly, multiline, maxLength, field}]
   *          rect 是 PDF 用户空间坐标 {x, y, width, height}（y 为矩形下边）
   */
  function readFields(libDoc) {
    let form = null;
    try { form = libDoc.getForm(); } catch (e) { return []; }
    if (!form) return [];
    let fields = [];
    try { fields = form.getFields(); } catch (e) { return []; }
    if (!fields.length) return [];

    const pages = libDoc.getPages();
    const pageKeys = pages.map((p) => refKey(p.ref));
    const out = [];

    fields.forEach((f) => {
      const type = fieldType(f);

      let value = '';
      try {
        if (type === 'text') value = f.getText() || '';
        else if (type === 'checkbox') value = f.isChecked() ? 'on' : '';
        else if (type === 'radio' || type === 'dropdown' || type === 'optionlist') {
          const sel = f.getSelected ? f.getSelected() : [];
          value = sel && sel.length ? sel[0] : '';
        }
      } catch (e) {}

      let options = [];
      try { if (f.getOptions) options = f.getOptions() || []; } catch (e) {}

      let multiline = false, maxLength = null, readOnly = false;
      try { if (f.isMultiline) multiline = !!f.isMultiline(); } catch (e) {}
      try { if (f.getMaxLength) maxLength = f.getMaxLength(); } catch (e) {}
      try { if (f.isReadOnly) readOnly = !!f.isReadOnly(); } catch (e) {}

      let widgets = [];
      try { widgets = f.acroField.getWidgets() || []; } catch (e) {}

      if (!widgets.length) return;
      widgets.forEach((w, wi) => {
        let rect = null;
        try { rect = w.getRectangle(); } catch (e) {}
        if (!rect) return;
        let pi = 0;
        try {
          const k = refKey(w.P());
          const idx = pageKeys.indexOf(k);
          pi = idx >= 0 ? idx : 0;
        } catch (e) {}
        out.push({
          id: f.getName() + '#' + wi,
          name: f.getName(),
          type: type,
          page: pi,
          rect: rect,
          options: options,
          value: value,
          multiline: multiline,
          maxLength: maxLength,
          readOnly: readOnly,
          _field: f
        });
      });
    });
    return out;
  }

  /**
   * 把填写结果写回 PDF 并导出
   *
   * 两个必须注意的坑（都跟 pdf-lib 内置标准字体只支持 WinAnsi 有关）：
   * 1. save() 默认会重建所有字段的外观，字段里只要有中文就会抛
   *    `WinAnsi cannot encode "x"`，所以必须显式传 updateFieldAppearances:false；
   * 2. flatten() 内部同样要重建外观，因此字段含中文时扁平化做不了 ——
   *    捕获异常后退回普通导出，并把原因回传给界面提示用户。
   *
   * @param libDoc   pdf-lib 文档
   * @param values   { 字段名: 值 }，checkbox 用 true/false
   * @param flatten  是否扁平化
   */
  async function fillAndSave(libDoc, values, flatten) {
    const form = libDoc.getForm();
    const fields = form.getFields();
    const applied = [];

    fields.forEach((f) => {
      const name = f.getName();
      if (!(name in values)) return;
      const v = values[name];
      const type = fieldType(f);
      try {
        if (type === 'checkbox') {
          if (v && v !== '') f.check(); else f.uncheck();
        } else if (type === 'radio' || type === 'dropdown' || type === 'optionlist') {
          if (v && v !== '') f.select(String(v));
        } else if (type === 'text') {
          f.setText(String(v == null ? '' : v));
        } else return;
        applied.push(name);
      } catch (e) {
        console.warn('表单字段写入失败', name, e);
      }
    });

    let flattened = false;
    let flattenError = null;
    if (flatten) {
      try { form.flatten(); flattened = true; }
      catch (e) {
        flattenError = e.message || String(e);
        console.warn('扁平化失败', e);
      }
    }

    let bytes;
    try {
      bytes = await libDoc.save({ updateFieldAppearances: flattened });
    } catch (e) {
      // 再退一步：完全不碰外观，只存值
      flattenError = flattenError || (e.message || String(e));
      flattened = false;
      bytes = await libDoc.save({ updateFieldAppearances: false });
    }
    return { bytes: bytes, applied: applied, flattened: flattened, flattenError: flattenError };
  }

  global.PDFTOOLS = {
    PRESETS: PRESETS,
    compress: compress,
    compressBytes: compressBytes,
    readFields: readFields,
    fillAndSave: fillAndSave
  };
})(window);
