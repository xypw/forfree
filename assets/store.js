/* ============================================================
   store.js — 本地文档库 + 通用工具
   ForFree 所有数据保存在浏览器 localStorage，不联网、不上传
   ============================================================ */
(function (global) {
  'use strict';

  /* ---------------- 工具 ---------------- */
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.prototype.slice.call((r || document).querySelectorAll(s));

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function pad(n) { return n < 10 ? '0' + n : '' + n; }

  function fmtTime(ts) {
    const d = new Date(ts), now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    if (sameDay) return '今天 ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
    const y = new Date(now.getTime() - 86400000);
    if (d.toDateString() === y.toDateString()) return '昨天 ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
    if (d.getFullYear() === now.getFullYear())
      return (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function fmtSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1048576).toFixed(2) + ' MB';
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function escapeXml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&apos;')
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
  }

  /* ---------------- Toast ---------------- */
  let toastTimer = null;
  function toast(msg, ms) {
    const t = $('#toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('on'), ms || 1900);
  }

  /* ---------------- 输入框 / 确认框 ----------------
     为什么不用 window.prompt：**Electron 的渲染进程不支持它** ——
     调用会直接抛 "prompt() is and will not be supported."，桌面版里
     重命名、插入表格、水印等十几处功能会静默失效。所以统一换成下面这套
     自己实现的弹窗（复用已有的 .modal-mask / .modal 样式）。
     用法：
       const v = await FW.prompt('重命名：', doc.title);   // 取消返回 null
       const v = await FW.prompt('备注：', '', { multiline: true });
       const ok = await FW.confirm('确定删除？'); */
  function promptBox(message, defaultValue, opts) {
    opts = opts || {};
    return new Promise((resolve) => {
      const mask = document.createElement('div');
      mask.className = 'modal-mask on fw-prompt-mask';
      const multiline = !!opts.multiline;
      const tag = multiline
        ? '<textarea class="fw-prompt-input" rows="' + (opts.rows || 3) + '"></textarea>'
        : '<input class="fw-prompt-input" type="' + (opts.type === 'number' ? 'number' : 'text') + '">';
      mask.innerHTML =
        '<div class="modal" style="max-width:420px">' +
          '<div class="modal-head"><h3>' + escapeHtml(opts.title || '请输入') + '</h3></div>' +
          '<div class="modal-body">' +
            (message ? '<p style="margin-bottom:10px">' + escapeHtml(message) + '</p>' : '') +
            tag +
            '<p class="muted fw-prompt-err" style="color:#D93B2B;margin-top:8px;display:none"></p>' +
          '</div>' +
          '<div class="modal-foot">' +
            '<button class="ghost-btn" data-act="cancel">取消</button>' +
            '<button class="primary-btn" data-act="ok">确定</button>' +
          '</div>' +
        '</div>';
      document.body.appendChild(mask);
      const input = $('.fw-prompt-input', mask);
      const errEl = $('.fw-prompt-err', mask);
      input.value = defaultValue == null ? '' : String(defaultValue);

      let done = false;
      const close = (val) => {
        if (done) return;
        done = true;
        document.removeEventListener('keydown', onKey, true);
        mask.remove();
        resolve(val);
      };
      const tryOk = () => {
        const v = input.value;
        if (opts.validate) {
          const msg = opts.validate(v);
          if (msg) { errEl.textContent = msg; errEl.style.display = 'block'; input.focus(); return; }
        }
        close(v);
      };
      const onKey = (e) => {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(null); }
        else if (e.key === 'Enter' && (!multiline || e.ctrlKey || e.metaKey)) {
          e.preventDefault(); e.stopPropagation(); tryOk();
        }
      };
      document.addEventListener('keydown', onKey, true);
      mask.querySelector('[data-act="ok"]').onclick = tryOk;
      mask.querySelector('[data-act="cancel"]').onclick = () => close(null);
      mask.addEventListener('mousedown', (e) => { if (e.target === mask) close(null); });
      setTimeout(() => { input.focus(); if (!multiline) input.select(); }, 30);
    });
  }

  function confirmBox(message, opts) {
    opts = opts || {};
    return new Promise((resolve) => {
      const mask = document.createElement('div');
      mask.className = 'modal-mask on fw-prompt-mask';
      mask.innerHTML =
        '<div class="modal" style="max-width:400px">' +
          '<div class="modal-head"><h3>' + escapeHtml(opts.title || '请确认') + '</h3></div>' +
          '<div class="modal-body"><p>' + escapeHtml(message || '') + '</p></div>' +
          '<div class="modal-foot">' +
            '<button class="ghost-btn" data-act="cancel">' + escapeHtml(opts.cancelText || '取消') + '</button>' +
            '<button class="primary-btn" data-act="ok">' + escapeHtml(opts.okText || '确定') + '</button>' +
          '</div>' +
        '</div>';
      document.body.appendChild(mask);
      let done = false;
      const close = (val) => {
        if (done) return;
        done = true;
        document.removeEventListener('keydown', onKey, true);
        mask.remove();
        resolve(val);
      };
      const onKey = (e) => {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(false); }
        else if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); close(true); }
      };
      document.addEventListener('keydown', onKey, true);
      mask.querySelector('[data-act="ok"]').onclick = () => close(true);
      mask.querySelector('[data-act="cancel"]').onclick = () => close(false);
      mask.addEventListener('mousedown', (e) => { if (e.target === mask) close(false); });
      setTimeout(() => mask.querySelector('[data-act="ok"]').focus(), 30);
    });
  }

  /* ---------------- 下载 ---------------- */
  function downloadBlob(filename, blob) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1200);
  }

  function downloadBytes(filename, bytes, mime) {
    downloadBlob(filename, new Blob([bytes], { type: mime || 'application/octet-stream' }));
  }

  function downloadText(filename, text, mime) {
    // 加 BOM，保证 Excel / 记事本打开 CSV、TXT 不乱码
    const bom = /csv|txt|md|html/.test(mime || '') ? '\ufeff' : '';
    downloadBlob(filename, new Blob([bom + text], { type: (mime || 'text/plain') + ';charset=utf-8' }));
  }

  /* ---------------- 文件读取 ---------------- */
  function readAsArrayBuffer(file) {
    return new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(new Uint8Array(r.result));
      r.onerror = () => rej(r.error);
      r.readAsArrayBuffer(file);
    });
  }

  function readAsText(file) {
    return new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(String(r.result).replace(/^\ufeff/, ''));
      r.onerror = () => rej(r.error);
      r.readAsText(file, 'utf-8');
    });
  }

  function readAsDataURL(file) {
    return new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result);
      r.onerror = () => rej(r.error);
      r.readAsDataURL(file);
    });
  }

  function pickFile(accept, multiple) {
    return new Promise((resolve) => {
      const inp = $('#filePicker');
      inp.value = '';
      inp.accept = accept || '';
      inp.multiple = !!multiple;
      const done = () => {
        inp.removeEventListener('change', done);
        resolve(multiple ? Array.prototype.slice.call(inp.files) : (inp.files[0] || null));
      };
      inp.addEventListener('change', done);
      inp.click();
    });
  }

  /* ---------------- 文档库 ---------------- */
  const KEY = 'forfree.docs.v1';
  const SETTINGS_KEY = 'forfree.settings.v1';
  const TRASH_KEY = 'forfree.trash.v1';
  const VERSION_KEY = 'forfree.versions.v1';

  const Store = {
    _cache: null,

    _read() {
      if (this._cache) return this._cache;
      let arr = [];
      try {
        const raw = localStorage.getItem(KEY);
        if (raw) arr = JSON.parse(raw);
        if (!Array.isArray(arr)) arr = [];
      } catch (e) { arr = []; }
      this._cache = arr;
      return arr;
    },

    _write(arr) {
      // 必须先写成功再更新缓存。
      // 之前是先更新缓存再写，一旦存储写满、setItem 抛异常，
      // 缓存里就留下了一份「没真正存下去」的数据 ——
      // 界面显示已保存，用户继续编辑，一刷新全丢。
      try {
        localStorage.setItem(KEY, JSON.stringify(arr));
        this._cache = arr;
        return true;
      } catch (e) {
        toast('保存失败：本地存储空间已满，请删除部分旧文档或清空回收站');
        return false;
      }
    },

    list() {
      return this._read().slice().sort((a, b) => b.updated - a.updated);
    },

    get(id) {
      return this._read().find((d) => d.id === id) || null;
    },

    upsert(doc) {
      // 必须拷一份再改：_read() 返回的就是缓存数组本身，
      // 直接 arr[i] = ... 会就地改掉缓存 —— 那样即使 _write 失败，
      // 缓存里也已经是一份「没真正落盘」的数据了。
      const arr = this._read().slice();
      const i = arr.findIndex((d) => d.id === doc.id);
      doc.updated = Date.now();
      if (i >= 0) arr[i] = Object.assign({}, arr[i], doc);
      else { doc.created = doc.created || Date.now(); arr.push(doc); }
      // 写失败时返回 null，调用方要据此提示用户，不能假装保存成功
      return this._write(arr) ? doc : null;
    },

    remove(id) {
      this._write(this._read().filter((d) => d.id !== id));
    },

    duplicate(id) {
      const d = this.get(id);
      if (!d) return null;
      const copy = JSON.parse(JSON.stringify(d));
      copy.id = uid();
      copy.title = d.title + ' 副本';
      copy.created = copy.updated = Date.now();
      this.upsert(copy);
      return copy;
    },

    /* ==================== 回收站 ==================== */
    trashList() {
      let arr = [];
      try { arr = JSON.parse(localStorage.getItem(TRASH_KEY) || '[]'); } catch (e) { arr = []; }
      if (!Array.isArray(arr)) arr = [];
      return arr.slice().sort((a, b) => (b.deletedAt || 0) - (a.deletedAt || 0));
    },

    _trashWrite(arr) {
      try { localStorage.setItem(TRASH_KEY, JSON.stringify(arr)); return true; }
      catch (e) { toast('回收站写入失败：本地存储空间已满'); return false; }
    },

    /** 删除文档 —— 进回收站，不是真删 */
    trashDoc(id) {
      const d = this.get(id);
      if (!d) return false;
      const arr = this.trashList();
      arr.unshift(Object.assign({}, d, { deletedAt: Date.now(), _from: d.updated }));
      // 回收站最多保留 60 项，超出丢弃最旧的
      while (arr.length > 60) arr.pop();
      if (!this._trashWrite(arr)) return false;
      this.remove(id);
      return true;
    },

    restore(id) {
      const arr = this.trashList();
      const i = arr.findIndex((d) => d.id === id);
      if (i < 0) return null;
      const d = arr[i];
      delete d.deletedAt;
      delete d._from;
      d.updated = Date.now();
      this.upsert(d);
      arr.splice(i, 1);
      this._trashWrite(arr);
      return d;
    },

    purge(id) {
      this._trashWrite(this.trashList().filter((d) => d.id !== id));
    },

    emptyTrash() {
      this._trashWrite([]);
    },

    /* ==================== 历史版本 ==================== */
    _verRead() {
      let o = {};
      try { o = JSON.parse(localStorage.getItem(VERSION_KEY) || '{}'); } catch (e) { o = {}; }
      return (o && typeof o === 'object' && !Array.isArray(o)) ? o : {};
    },

    _verWrite(o) {
      try { localStorage.setItem(VERSION_KEY, JSON.stringify(o)); return true; }
      catch (e) {
        // 空间不足：先丢掉最旧的一半再试一次
        try {
          const keys = Object.keys(o);
          keys.forEach((k) => { if (o[k] && o[k].length) o[k] = o[k].slice(0, Math.ceil(o[k].length / 2)); });
          localStorage.setItem(VERSION_KEY, JSON.stringify(o));
          return true;
        } catch (e2) { return false; }
      }
    },

    /** 某个文档的历史版本（不含正文，正文按需读） */
    versions(id) {
      const o = this._verRead();
      return (o[id] || []).map((v) => ({ ts: v.ts, title: v.title, note: v.note || '', size: v.size || 0 }));
    },

    versionCount(id) {
      const o = this._verRead();
      return (o[id] || []).length;
    },

    getVersion(id, ts) {
      const o = this._verRead();
      const list = o[id] || [];
      const v = list.find((x) => x.ts === ts);
      return v ? { ts: v.ts, title: v.title, note: v.note || '', data: v.data, type: v.type } : null;
    },

    /**
     * 存一个历史版本。
     * @param doc  文档对象
     * @param note 备注（可选）
     * @param opts { force:true 时忽略节流与去重 }
     * @returns {ts} 成功返回时间戳，跳过返回 null
     */
    snapshot(doc, note, opts) {
      if (!doc || !doc.data) return null;
      opts = opts || {};
      let data;
      try { data = JSON.stringify(doc.data); } catch (e) { return null; }
      const bytes = data.length * 2;
      if (bytes > 400 * 1024) return null;            // 单份快照超过 400KB 不存，避免撑爆本地存储

      const o = this._verRead();
      const list = o[doc.id] || (o[doc.id] = []);
      const last = list[0];
      if (!opts.force) {
        if (last && last.data === data) return null;                       // 内容没变
        if (last && Date.now() - last.ts < 3 * 60 * 1000) return null;      // 3 分钟内不重复存
      }
      if (last && last.data === data && !opts.force) return null;

      // 时间戳做版本标识，必须保证同一文档内唯一
      // （快速连续保存时 Date.now() 可能落在同一毫秒，撞车会导致删一个删掉两个）
      let ts = Date.now();
      while (list.some((v) => v.ts === ts)) ts++;

      list.unshift({ ts: ts, title: doc.title || '未命名', type: doc.type, note: note || '', size: bytes, data: data });

      // 每个文档最多 12 个版本
      if (list.length > 12) list.length = 12;

      // 全局总量控制在约 2.4MB 以内，超出就砍最旧的
      let total = 0;
      const all = [];
      Object.keys(o).forEach((k) => o[k].forEach((v) => { total += (v.size || 0); all.push({ k: k, v: v }); }));
      if (total > 2.4 * 1024 * 1024) {
        all.sort((a, b) => a.v.ts - b.v.ts);
        let over = total - 2.4 * 1024 * 1024;
        for (const it of all) {
          if (over <= 0) break;
          const arr = o[it.k];
          const i = arr.indexOf(it.v);
          if (i >= 0) { arr.splice(i, 1); over -= (it.v.size || 0); }
        }
      }
      if (!this._verWrite(o)) { toast('历史版本保存失败：本地存储空间不足'); return null; }
      return ts;
    },

    /** 把某个版本的内容写回文档（会先给当前内容存一份快照） */
    restoreVersion(id, ts) {
      const doc = this.get(id);
      const v = this.getVersion(id, ts);
      if (!doc || !v) return null;
      this.snapshot(doc, '还原前自动备份', { force: true });
      let parsed;
      try { parsed = JSON.parse(v.data); } catch (e) { return null; }
      const backup = doc.data;
      doc.data = parsed;
      const saved = this.upsert(doc);
      if (!saved) { doc.data = backup; return null; }   // 写失败就回滚，别让界面显示成还原了
      return doc;
    },

    deleteVersion(id, ts) {
      const o = this._verRead();
      if (!o[id]) return;
      o[id] = o[id].filter((x) => x.ts !== ts);
      if (!o[id].length) delete o[id];
      this._verWrite(o);
    },

    clearVersions(id) {
      const o = this._verRead();
      delete o[id];
      this._verWrite(o);
    },

    versionsUsage() {
      let bytes = 0;
      try { bytes = (localStorage.getItem(VERSION_KEY) || '').length * 2; } catch (e) {}
      return bytes;
    },

    trashUsage() {
      let bytes = 0;
      try { bytes = (localStorage.getItem(TRASH_KEY) || '').length * 2; } catch (e) {}
      return bytes;
    },

    usage() {
      let bytes = 0;
      try { bytes = (localStorage.getItem(KEY) || '').length * 2; } catch (e) {}
      return bytes;
    },

    settings() {
      try { return JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}'); }
      catch (e) { return {}; }
    },
    setSetting(k, v) {
      const s = this.settings(); s[k] = v;
      try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch (e) {}
    }
  };

  /* ---------------- 新文档工厂 ---------------- */
  function createDoc(type) {
    const id = uid();
    const base = { id: id, type: type, created: Date.now(), updated: Date.now() };
    if (type === 'doc') {
      return Object.assign(base, {
        title: '未命名文字文档',
        data: {
          html: '<h1 style="text-align:center">新建文档</h1><p>在这里开始你的创作……</p>',
          paper: 'A4'
        }
      });
    }
    if (type === 'sheet') {
      const sheet = { name: 'Sheet1', cells: {}, cols: {}, rows: {}, colW: 88, rowH: 24 };
      return Object.assign(base, {
        title: '未命名电子表格',
        data: { sheets: [sheet], active: 0, rows: 60, cols: 20 }
      });
    }
    return Object.assign(base, {
      title: '未命名演示文稿',
      data: {
        size: { w: 960, h: 540 },
        theme: 'fresh',
        slides: [{
          layout: 'title',
          bg: null,
          shapes: [
            { id: uid(), type: 'text', x: 130, y: 190, w: 700, h: 90, text: '点击输入标题', size: 44, bold: true, color: '#1F2328', align: 'center', valign: 'middle' },
            { id: uid(), type: 'text', x: 130, y: 300, w: 700, h: 52, text: '点击输入副标题', size: 20, bold: false, color: '#6B7280', align: 'center', valign: 'middle' }
          ]
        }]
      }
    });
  }

  const TYPE_META = {
    doc:   { name: '文字文档', icon: '文', cls: 'nc-doc',   color: '#2B7FE0' },
    sheet: { name: '电子表格', icon: '表', cls: 'nc-sheet', color: '#21A366' },
    slide: { name: '演示文稿', icon: '演', cls: 'nc-slide', color: '#F2994A' }
  };

  global.FW = {
    $, $$, uid, fmtTime, fmtSize, escapeHtml, escapeXml,
    toast, prompt: promptBox, confirm: confirmBox,
    downloadBlob, downloadBytes, downloadText,
    readAsArrayBuffer, readAsText, readAsDataURL, pickFile,
    Store, createDoc, TYPE_META
  };
})(window);
