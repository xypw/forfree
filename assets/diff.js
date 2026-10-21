/* ============================================================
   diff.js — 文档对比（快速比对）
   文档对比：两份文档 / 同一文档的两个版本
   逐行比对，标出新增、删除、修改，支持双栏与统一两种视图。
   ============================================================ */
(function (global) {
  'use strict';
  const FW = global.FW, $ = FW.$, $$ = FW.$$;

  const MAX_CELLS = 4 * 1000 * 1000;   // DP 规模上限，超过则退化为「整块替换」

  /* ============================================================
     一、序列比对核心
     ============================================================ */
  function lcsOps(a, b) {
    const n = a.length, m = b.length;
    const ops = [];

    // 掐掉公共前后缀，大幅缩小 DP 规模
    let s = 0;
    while (s < n && s < m && a[s] === b[s]) { ops.push({ t: '=', ai: s, bi: s }); s++; }
    let ea = n, eb = m;
    const tail = [];
    while (ea > s && eb > s && a[ea - 1] === b[eb - 1]) { ea--; eb--; tail.unshift({ t: '=', ai: ea, bi: eb }); }

    const A = a.slice(s, ea), B = b.slice(s, eb);
    const p = A.length, q = B.length;

    if (p === 0) {
      for (let j = 0; j < q; j++) ops.push({ t: '+', ai: -1, bi: s + j });
    } else if (q === 0) {
      for (let i = 0; i < p; i++) ops.push({ t: '-', ai: s + i, bi: -1 });
    } else if (p * q > MAX_CELLS) {
      // 太大：不做精细比对，整块当作替换
      for (let i = 0; i < p; i++) ops.push({ t: '-', ai: s + i, bi: -1 });
      for (let j = 0; j < q; j++) ops.push({ t: '+', ai: -1, bi: s + j });
    } else {
      const w = q + 1;
      const dp = new Uint32Array((p + 1) * w);
      for (let i = p - 1; i >= 0; i--) {
        const rowBase = i * w, nextBase = (i + 1) * w;
        for (let j = q - 1; j >= 0; j--) {
          dp[rowBase + j] = (A[i] === B[j])
            ? dp[nextBase + j + 1] + 1
            : Math.max(dp[nextBase + j], dp[rowBase + j + 1]);
        }
      }
      let i = 0, j = 0;
      while (i < p && j < q) {
        if (A[i] === B[j]) { ops.push({ t: '=', ai: s + i, bi: s + j }); i++; j++; }
        else if (dp[(i + 1) * w + j] >= dp[i * w + j + 1]) { ops.push({ t: '-', ai: s + i, bi: -1 }); i++; }
        else { ops.push({ t: '+', ai: -1, bi: s + j }); j++; }
      }
      while (i < p) { ops.push({ t: '-', ai: s + i, bi: -1 }); i++; }
      while (j < q) { ops.push({ t: '+', ai: -1, bi: s + j }); j++; }
    }

    return ops.concat(tail);
  }

  /* 词级比对：用于给「修改」的行做更细的标注 */
  function tokenize(s) {
    return String(s).match(/[A-Za-z0-9_.%]+|\s+|[\s\S]/g) || [];
  }

  function wordOps(a, b) {
    const A = tokenize(a), B = tokenize(b);
    const p = A.length, q = B.length;
    if (p * q > 400 * 1000) {
      return [{ t: '-', a: a, b: '' }, { t: '+', a: '', b: b }];
    }
    const w = q + 1;
    const dp = new Uint32Array((p + 1) * w);
    for (let i = p - 1; i >= 0; i--) {
      const rb = i * w, nb = (i + 1) * w;
      for (let j = q - 1; j >= 0; j--) {
        dp[rb + j] = (A[i] === B[j]) ? dp[nb + j + 1] + 1 : Math.max(dp[nb + j], dp[rb + j + 1]);
      }
    }
    const out = [];
    let i = 0, j = 0;
    while (i < p && j < q) {
      if (A[i] === B[j]) { out.push({ t: '=', a: A[i], b: B[j] }); i++; j++; }
      else if (dp[(i + 1) * w + j] >= dp[i * w + j + 1]) { out.push({ t: '-', a: A[i], b: '' }); i++; }
      else { out.push({ t: '+', a: '', b: B[j] }); j++; }
    }
    while (i < p) { out.push({ t: '-', a: A[i++], b: '' }); }
    while (j < q) { out.push({ t: '+', a: '', b: B[j++] }); }
    // 合并同类相邻项，减少 DOM 节点
    const merged = [];
    out.forEach((o) => {
      const last = merged[merged.length - 1];
      if (last && last.t === o.t) { last.a += o.a; last.b += o.b; }
      else merged.push({ t: o.t, a: o.a, b: o.b });
    });
    return merged;
  }

  /* ============================================================
     二、把各种文档转成可比较的纯文本
     ============================================================ */
  function docToPlain(doc) {
    if (!doc || !doc.data) return '';
    const O = global.OFFICE;
    if (doc.type === 'doc') return O.docToText(doc.data.html || '');
    if (doc.type === 'sheet') {
      return (doc.data.sheets || []).map((s) => '【' + s.name + '】\n' + O.sheetToCsv(s)).join('\n\n');
    }
    if (doc.type === 'slide') {
      return (doc.data.slides || []).map((sl, i) =>
        '【第 ' + (i + 1) + ' 页】\n' + (sl.shapes || []).map((x) => x.text || '').filter(Boolean).join('\n')
      ).join('\n\n');
    }
    return '';
  }

  function splitLines(text) {
    const s = String(text == null ? '' : text);
    // 空文档按 **0 行** 处理，而不是 1 个空行 —— 否则拿空文档和两行的文档对比，
    // 第一行会被判成「修改」而不是「新增」，看起来很莫名其妙。
    if (!s) return [];
    return s.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  }

  /* ============================================================
     三、比对结果
     ============================================================ */
  let state = null;

  function compute(leftText, rightText, ignoreCase, ignoreSpace) {
    const norm = (s) => {
      let t = s;
      if (ignoreSpace) t = t.replace(/\s+/g, ' ').trim();
      if (ignoreCase) t = t.toLowerCase();
      return t;
    };
    const L = splitLines(leftText);
    const R = splitLines(rightText);
    const ops = lcsOps(L.map(norm), R.map(norm));

    // 把相邻的「删 + 增」配对成「修改」
    const rows = [];
    for (let i = 0; i < ops.length; i++) {
      const o = ops[i];
      if (o.t === '=') { rows.push({ t: 'same', left: L[o.ai], right: R[o.bi], ln: o.ai + 1, rn: o.bi + 1 }); continue; }
      if (o.t === '-') {
        const dels = [], ins = [];
        let k = i;
        while (k < ops.length && ops[k].t === '-') { dels.push(ops[k]); k++; }
        while (k < ops.length && ops[k].t === '+') { ins.push(ops[k]); k++; }
        if (ins.length) {
          const pairs = Math.min(dels.length, ins.length);
          for (let x = 0; x < pairs; x++) {
            rows.push({
              t: 'mod', left: L[dels[x].ai], right: R[ins[x].bi],
              ln: dels[x].ai + 1, rn: ins[x].bi + 1,
              word: wordOps(L[dels[x].ai], R[ins[x].bi])
            });
          }
          for (let x = pairs; x < dels.length; x++) rows.push({ t: 'del', left: L[dels[x].ai], right: '', ln: dels[x].ai + 1, rn: null });
          for (let x = pairs; x < ins.length; x++) rows.push({ t: 'ins', left: '', right: R[ins[x].bi], ln: null, rn: ins[x].bi + 1 });
        } else {
          dels.forEach((d) => rows.push({ t: 'del', left: L[d.ai], right: '', ln: d.ai + 1, rn: null }));
        }
        i = k - 1;
        continue;
      }
      if (o.t === '+') rows.push({ t: 'ins', left: '', right: R[o.bi], ln: null, rn: o.bi + 1 });
    }
    return rows;
  }

  function stats(rows) {
    let same = 0, add = 0, del = 0, mod = 0;
    rows.forEach((r) => {
      if (r.t === 'same') same++;
      else if (r.t === 'ins') add++;
      else if (r.t === 'del') del++;
      else mod++;
    });
    return { same: same, add: add, del: del, mod: mod, total: rows.length };
  }

  /* ============================================================
     四、渲染
     ============================================================ */
  function renderText(str, marks, side) {
    if (marks) {
      return marks.map((m) => {
        const txt = side === 'left' ? m.a : m.b;
        if (txt === '') return '';
        const cls = m.t === '=' ? '' : (m.t === '-' ? 'wd' : 'wi');
        return cls ? '<span class="' + cls + '">' + FW.escapeHtml(txt) + '</span>' : FW.escapeHtml(txt);
      }).join('') || '&nbsp;';
    }
    return FW.escapeHtml(str === '' ? '' : str) || '&nbsp;';
  }

  function renderRows() {
    if (!state) return;
    const rows = state.rows;
    const onlyDiff = state.onlyDiff;
    const mode = state.mode;
    const kw = state.keyword.trim().toLowerCase();
    const body = $('#diffBody');

    const visible = rows.filter((r) => {
      if (onlyDiff && r.t === 'same') return false;
      if (kw && ((r.left || '') + (r.right || '')).toLowerCase().indexOf(kw) < 0) return false;
      return true;
    });

    if (!visible.length) {
      body.innerHTML = '<div class="diff-empty">' + (rows.length ? '没有匹配的行' : '两份内容完全一致，没有差异') + '</div>';
      return;
    }

    if (mode === 'split') {
      let h = '<table class="diff-table split"><thead><tr>' +
        '<th class="ln">行</th><th>左侧</th><th class="ln">行</th><th>右侧</th></tr></thead><tbody>';
      visible.forEach((r) => {
        const cls = r.t === 'same' ? '' : r.t;
        h += '<tr class="' + cls + '">' +
          '<td class="ln">' + (r.ln == null ? '' : r.ln) + '</td>' +
          '<td class="c">' + renderText(r.left, r.t === 'mod' ? r.word : null, 'left') + '</td>' +
          '<td class="ln">' + (r.rn == null ? '' : r.rn) + '</td>' +
          '<td class="c">' + renderText(r.right, r.t === 'mod' ? r.word : null, 'right') + '</td>' +
          '</tr>';
      });
      body.innerHTML = h + '</tbody></table>';
    } else {
      let h = '<table class="diff-table unified"><thead><tr>' +
        '<th class="ln">左</th><th class="ln">右</th><th class="mk"></th><th>内容</th></tr></thead><tbody>';
      visible.forEach((r) => {
        const mk = r.t === 'same' ? '' : r.t === 'ins' ? '+' : r.t === 'del' ? '−' : '±';
        const cls = r.t === 'same' ? '' : r.t;
        const text = r.t === 'ins' ? r.right : r.left;
        h += '<tr class="' + cls + '">' +
          '<td class="ln">' + (r.ln == null ? '' : r.ln) + '</td>' +
          '<td class="ln">' + (r.rn == null ? '' : r.rn) + '</td>' +
          '<td class="mk">' + mk + '</td>' +
          '<td class="c">' + renderText(text, r.t === 'mod' ? r.word : null, r.t === 'ins' ? 'right' : 'left') + '</td>' +
          '</tr>';
      });
      body.innerHTML = h + '</tbody></table>';
    }
  }

  function refreshStats() {
    if (!state) return;
    const s = stats(state.rows);
    const box = $('#diffStats');
    if (!box) return;
    box.innerHTML =
      '<span class="ds ds-add">新增 ' + s.add + '</span>' +
      '<span class="ds ds-del">删除 ' + s.del + '</span>' +
      '<span class="ds ds-mod">修改 ' + s.mod + '</span>' +
      '<span class="ds ds-same">相同 ' + s.same + '</span>' +
      (s.add + s.del + s.mod === 0
        ? '<span class="ds ds-ok">两份内容完全一致</span>'
        : '<span class="ds ds-sum">共 ' + s.total + ' 行，差异 ' + (s.add + s.del + s.mod) + ' 处</span>');
  }

  function rerun() {
    if (!state) return;
    state.rows = compute(state.leftText, state.rightText, state.ignoreCase, state.ignoreSpace);
    refreshStats();
    renderRows();
  }

  /* ============================================================
     五、左侧/右侧数据源
     ============================================================ */
  function fillSelects() {
    const docs = FW.Store.list();
    const mk = (sel, cur) => {
      let h = '<option value="">— 选择文档 —</option>';
      h += '<optgroup label="当前文档">';
      docs.forEach((d) => {
        const m = FW.TYPE_META[d.type] || { name: '文档' };
        h += '<option value="d:' + d.id + '">' + FW.escapeHtml(d.title || '未命名') + '（' + m.name + '）</option>';
      });
      h += '</optgroup><optgroup label="回收站">';
      FW.Store.trashList().forEach((d) => {
        h += '<option value="t:' + d.id + '">' + FW.escapeHtml(d.title || '未命名') + '（已删除）</option>';
      });
      h += '</optgroup>';
      sel.innerHTML = h;
      if (cur != null) sel.value = cur;
    };
    mk($('#diffLeftSel'), state.leftKey);
    mk($('#diffRightSel'), state.rightKey);
    fillVersions();
  }

  function fillVersions() {
    const box = $('#diffLeftVer');
    const docId = (state.leftKey || '').indexOf('d:') === 0 ? state.leftKey.slice(2) : null;
    if (!docId) { box.innerHTML = '<option value="">— 无历史版本 —</option>'; box.disabled = true; return; }
    const vs = FW.Store.versions(docId);
    if (!vs.length) { box.innerHTML = '<option value="">— 无历史版本 —</option>'; box.disabled = true; return; }
    box.disabled = false;
    box.innerHTML = '<option value="">当前内容</option>' +
      vs.map((v) => '<option value="' + v.ts + '">' + FW.fmtTime(v.ts) + (v.note ? ' · ' + FW.escapeHtml(v.note) : '') + '</option>').join('');
    box.value = state.leftVer ? String(state.leftVer) : '';
  }

  function loadSide(side) {
    const key = side === 'left' ? state.leftKey : state.rightKey;
    const ver = side === 'left' ? state.leftVer : null;
    if (!key) return { title: '（未选择）', text: '' };

    let doc = null;
    if (key.indexOf('d:') === 0) doc = FW.Store.get(key.slice(2));
    else if (key.indexOf('t:') === 0) doc = FW.Store.trashList().find((d) => d.id === key.slice(2));
    if (!doc) return { title: '（文档不存在）', text: '' };

    if (side === 'left' && ver) {
      const v = FW.Store.getVersion(doc.id, +ver);
      if (v) {
        let data;
        try { data = JSON.parse(v.data); } catch (e) { data = null; }
        if (data) return { title: doc.title + '（' + FW.fmtTime(v.ts) + '）', text: docToPlain({ type: v.type, data: data }) };
      }
    }
    return { title: doc.title, text: docToPlain(doc) };
  }

  function apply() {
    const L = loadSide('left');
    const R = loadSide('right');
    state.leftText = L.text;
    state.rightText = R.text;
    $('#diffLeftName').textContent = L.title;
    $('#diffRightName').textContent = R.title;
    rerun();
  }

  /* ============================================================
     六、打开与事件
     ============================================================ */
  let bound = false;

  function open(opts) {
    opts = opts || {};
    if (!state) state = { mode: 'split', onlyDiff: false, ignoreCase: false, ignoreSpace: false, keyword: '' };

    const docs = FW.Store.list();
    state.leftKey = opts.leftKey || (docs[0] ? 'd:' + docs[0].id : '');
    state.rightKey = opts.rightKey || (docs[1] ? 'd:' + docs[1].id : (docs[0] ? 'd:' + docs[0].id : ''));
    state.leftVer = opts.leftVer || null;

    FW.app.showView('diff');
    bind();
    fillSelects();
    syncToolbar();
    apply();
  }

  /** 快捷入口：同一文档的历史版本 vs 当前 */
  function compareVersions(docId, ts) {
    open({ leftKey: 'd:' + docId, leftVer: ts, rightKey: 'd:' + docId });
  }

  function syncToolbar() {
    $('#diffModeSplit').classList.toggle('on', state.mode === 'split');
    $('#diffModeUnified').classList.toggle('on', state.mode === 'unified');
    $('#diffOnlyDiff').classList.toggle('on', state.onlyDiff);
    $('#diffIgnoreCase').classList.toggle('on', state.ignoreCase);
    $('#diffIgnoreSpace').classList.toggle('on', state.ignoreSpace);
  }

  function bind() {
    if (bound) return;
    bound = true;

    $('#diffLeftSel').addEventListener('change', (e) => { state.leftKey = e.target.value; state.leftVer = null; fillVersions(); apply(); });
    $('#diffRightSel').addEventListener('change', (e) => { state.rightKey = e.target.value; apply(); });
    $('#diffLeftVer').addEventListener('change', (e) => { state.leftVer = e.target.value || null; apply(); });

    $('#diffModeSplit').addEventListener('click', () => { state.mode = 'split'; syncToolbar(); renderRows(); });
    $('#diffModeUnified').addEventListener('click', () => { state.mode = 'unified'; syncToolbar(); renderRows(); });
    $('#diffOnlyDiff').addEventListener('click', () => { state.onlyDiff = !state.onlyDiff; syncToolbar(); renderRows(); });
    $('#diffIgnoreCase').addEventListener('click', () => { state.ignoreCase = !state.ignoreCase; syncToolbar(); rerun(); });
    $('#diffIgnoreSpace').addEventListener('click', () => { state.ignoreSpace = !state.ignoreSpace; syncToolbar(); rerun(); });
    $('#diffKeyword').addEventListener('input', (e) => { state.keyword = e.target.value; renderRows(); });

    $('#diffSwap').addEventListener('click', () => {
      const a = state.leftKey, b = state.rightKey, v = state.leftVer;
      state.leftKey = b; state.rightKey = a; state.leftVer = null;
      fillSelects(); apply();
    });

    $('#diffJumpPrev').addEventListener('click', () => jump(-1));
    $('#diffJumpNext').addEventListener('click', () => jump(1));

    $('#diffExport').addEventListener('click', () => {
      if (!state) return;
      const s = stats(state.rows);
      let out = '文档对比报告\n生成时间：' + new Date().toLocaleString('zh-CN') + '\n';
      out += '左侧：' + $('#diffLeftName').textContent + '\n右侧：' + $('#diffRightName').textContent + '\n';
      out += '统计：新增 ' + s.add + ' / 删除 ' + s.del + ' / 修改 ' + s.mod + ' / 相同 ' + s.same + '\n';
      out += '='.repeat(60) + '\n\n';
      state.rows.forEach((r) => {
        if (r.t === 'same') out += '  ' + r.left + '\n';
        else if (r.t === 'ins') out += '+ ' + r.right + '\n';
        else if (r.t === 'del') out += '- ' + r.left + '\n';
        else out += '- ' + r.left + '\n+ ' + r.right + '\n';
      });
      FW.downloadText('文档对比报告.txt', out, 'text/plain');
      FW.toast('已导出对比报告');
    });
  }

  function jump(dir) {
    const rows = $$('#diffBody tr');
    if (!rows.length) return;
    const changed = rows.filter((tr) => tr.className && tr.className !== '');
    if (!changed.length) { FW.toast('没有差异行'); return; }
    const cur = state._jumpIdx == null ? -1 : state._jumpIdx;
    let next = cur + dir;
    if (next < 0) next = changed.length - 1;
    if (next >= changed.length) next = 0;
    state._jumpIdx = next;
    changed.forEach((tr) => tr.classList.remove('jump'));
    changed[next].classList.add('jump');
    changed[next].scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  global.DIFF = { open, compareVersions, docToPlain, compute, stats };
})(window);
