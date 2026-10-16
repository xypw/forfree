/* ============================================================
   editor-sheet.js — 电子表格编辑器（含公式引擎）
   ============================================================ */
(function (global) {
  'use strict';
  const FW = global.FW, $ = FW.$, $$ = FW.$$;
  const colName = (n) => { let s = '', i = n + 1; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
  const colIndex = (s) => { let n = 0; s = String(s).toUpperCase(); for (let i = 0; i < s.length; i++) n = n * 26 + (s.charCodeAt(i) - 64); return n - 1; };

  /* ==========================================================
     公式引擎
     ========================================================== */
  const ERR = (t) => ({ err: t });

  function tokenize(src) {
    const t = [];
    let i = 0;
    const s = String(src);
    while (i < s.length) {
      const ch = s[i];
      if (/\s/.test(ch)) { i++; continue; }
      if (ch === '"') {
        let v = ''; i++;
        while (i < s.length) { if (s[i] === '"') { if (s[i + 1] === '"') { v += '"'; i += 2; } else { i++; break; } } else { v += s[i++]; } }
        t.push({ k: 'str', v: v }); continue;
      }
      if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(s[i + 1]))) {
        let v = '';
        while (i < s.length && /[0-9.]/.test(s[i])) v += s[i++];
        if (s[i] === 'e' || s[i] === 'E') { v += s[i++]; if (s[i] === '+' || s[i] === '-') v += s[i++]; while (i < s.length && /[0-9]/.test(s[i])) v += s[i++]; }
        t.push({ k: 'num', v: parseFloat(v) }); continue;
      }
      // 单元格引用 / 区域 / 工作表名
      const rest = s.slice(i);
      let m = /^(?:'([^']+)'|([A-Za-z_\u4e00-\u9fa5][A-Za-z0-9_\u4e00-\u9fa5]*))!(\$?[A-Za-z]{1,3}\$?\d+)/.exec(rest);
      if (m) { t.push({ k: 'ref', v: m[3].replace(/\$/g, ''), sheet: m[1] || m[2] }); i += m[0].length; continue; }
      m = /^(\$?[A-Za-z]{1,3}\$?\d+)(?::(\$?[A-Za-z]{1,3}\$?\d+))?/.exec(rest);
      if (m) {
        if (m[2]) { t.push({ k: 'range', a: m[1].replace(/\$/g, ''), b: m[2].replace(/\$/g, '') }); }
        else t.push({ k: 'ref', v: m[1].replace(/\$/g, '') });
        i += m[0].length; continue;
      }
      m = /^[A-Za-z_][A-Za-z0-9_.]*/.exec(rest);
      if (m) {
        const word = m[0];
        // 可能是布尔常量或函数名
        const up = word.toUpperCase();
        if (up === 'TRUE') t.push({ k: 'bool', v: true });
        else if (up === 'FALSE') t.push({ k: 'bool', v: false });
        else t.push({ k: 'id', v: up });
        i += word.length; continue;
      }
      if ('+-*/^&%(),:<>='.indexOf(ch) >= 0) {
        if ((ch === '<' || ch === '>') && s[i + 1] === '=') { t.push({ k: 'op', v: ch + '=' }); i += 2; continue; }
        if (ch === '<' && s[i + 1] === '>') { t.push({ k: 'op', v: '<>' }); i += 2; continue; }
        t.push({ k: 'op', v: ch }); i++; continue;
      }
      i++;
    }
    return t;
  }

  function parse(tokens) {
    let p = 0;
    const peek = () => tokens[p];
    const eat = (v) => { const tk = tokens[p]; if (tk && (v == null || tk.v === v)) { p++; return tk; } return null; };

    function parseExpr() { return parseCmp(); }
    function parseCmp() {
      let l = parseConcat();
      while (peek() && peek().k === 'op' && ['=', '<>', '<', '>', '<=', '>='].indexOf(peek().v) >= 0) {
        const op = eat().v; l = { t: 'bin', op: op, l: l, r: parseConcat() };
      }
      return l;
    }
    function parseConcat() {
      let l = parseAdd();
      while (peek() && peek().k === 'op' && peek().v === '&') { eat(); l = { t: 'bin', op: '&', l: l, r: parseAdd() }; }
      return l;
    }
    function parseAdd() {
      let l = parseMul();
      while (peek() && peek().k === 'op' && (peek().v === '+' || peek().v === '-')) { const op = eat().v; l = { t: 'bin', op: op, l: l, r: parseMul() }; }
      return l;
    }
    function parseMul() {
      let l = parsePow();
      while (peek() && peek().k === 'op' && (peek().v === '*' || peek().v === '/')) { const op = eat().v; l = { t: 'bin', op: op, l: l, r: parsePow() }; }
      return l;
    }
    function parsePow() {
      let l = parseUnary();
      while (peek() && peek().k === 'op' && peek().v === '^') { eat(); l = { t: 'bin', op: '^', l: l, r: parseUnary() }; }
      return l;
    }
    function parseUnary() {
      if (peek() && peek().k === 'op' && (peek().v === '-' || peek().v === '+')) {
        const op = eat().v; return { t: 'un', op: op, e: parseUnary() };
      }
      return parsePostfix();
    }
    function parsePostfix() {
      let e = parsePrimary();
      while (peek() && peek().k === 'op' && peek().v === '%') { eat(); e = { t: 'pct', e: e }; }
      return e;
    }
    function parsePrimary() {
      const tk = peek();
      if (!tk) return { t: 'lit', v: 0 };
      if (tk.k === 'num') { eat(); return { t: 'lit', v: tk.v }; }
      if (tk.k === 'str') { eat(); return { t: 'lit', v: tk.v }; }
      if (tk.k === 'bool') { eat(); return { t: 'lit', v: tk.v }; }
      if (tk.k === 'ref') { eat(); return { t: 'ref', ref: tk.v, sheet: tk.sheet }; }
      if (tk.k === 'range') { eat(); return { t: 'range', a: tk.a, b: tk.b }; }
      if (tk.k === 'id') {
        eat();
        if (peek() && peek().k === 'op' && peek().v === '(') {
          eat();
          const args = [];
          if (!(peek() && peek().k === 'op' && peek().v === ')')) {
            args.push(parseExpr());
            while (peek() && peek().k === 'op' && peek().v === ',') { eat(); if (peek() && peek().k === 'op' && peek().v === ')') break; args.push(parseExpr()); }
          }
          eat(')');
          return { t: 'call', name: tk.v, args: args };
        }
        return { t: 'name', v: tk.v };
      }
      if (tk.k === 'op' && tk.v === '(') { eat(); const e = parseExpr(); eat(')'); return e; }
      eat();
      return { t: 'lit', v: 0 };
    }
    return parseExpr();
  }

  const num = (v) => (typeof v === 'number' ? v : (v === '' || v == null ? 0 : (isNaN(Number(v)) ? NaN : Number(v))));
  const toStr = (v) => (v == null ? '' : typeof v === 'boolean' ? (v ? 'TRUE' : 'FALSE') : String(v));
  const flatten = (arr) => { const o = []; (function f(a) { a.forEach((x) => Array.isArray(x) ? f(x) : o.push(x)); })(arr); return o; };

  const FN = {
    SUM: (a) => flatten(a).reduce((s, v) => s + (typeof v === 'number' ? v : (isNaN(num(v)) ? 0 : (v === '' ? 0 : num(v)))), 0),
    PRODUCT: (a) => flatten(a).reduce((s, v) => s * (num(v) || 1), 1),
    AVERAGE: (a) => { const n = flatten(a).filter((v) => typeof v === 'number'); return n.length ? n.reduce((s, v) => s + v, 0) / n.length : ERR('#DIV/0!'); },
    AVG: (a) => FN.AVERAGE(a),
    MAX: (a) => { const n = flatten(a).filter((v) => typeof v === 'number'); return n.length ? Math.max.apply(null, n) : 0; },
    MIN: (a) => { const n = flatten(a).filter((v) => typeof v === 'number'); return n.length ? Math.min.apply(null, n) : 0; },
    COUNT: (a) => flatten(a).filter((v) => typeof v === 'number').length,
    COUNTA: (a) => flatten(a).filter((v) => v !== '' && v != null).length,
    COUNTBLANK: (a) => flatten(a).filter((v) => v === '' || v == null).length,
    MEDIAN: (a) => { const n = flatten(a).filter((v) => typeof v === 'number').sort((x, y) => x - y); if (!n.length) return ERR('#NUM!'); const m = Math.floor(n.length / 2); return n.length % 2 ? n[m] : (n[m - 1] + n[m]) / 2; },
    STDEV: (a) => { const n = flatten(a).filter((v) => typeof v === 'number'); if (n.length < 2) return ERR('#DIV/0!'); const m = n.reduce((s, v) => s + v, 0) / n.length; return Math.sqrt(n.reduce((s, v) => s + (v - m) * (v - m), 0) / (n.length - 1)); },
    IF: (a) => (a[0] ? a[1] : (a.length > 2 ? a[2] : false)),
    AND: (a) => flatten(a).every((v) => !!v),
    OR: (a) => flatten(a).some((v) => !!v),
    NOT: (a) => !a[0],
    IFS: (a) => { for (let i = 0; i + 1 < a.length; i += 2) if (a[i]) return a[i + 1]; return ERR('#N/A'); },
    ABS: (a) => Math.abs(num(a[0])),
    ROUND: (a) => { const p = Math.pow(10, num(a[1]) || 0); return Math.round(num(a[0]) * p) / p; },
    ROUNDUP: (a) => { const p = Math.pow(10, num(a[1]) || 0); return Math.ceil(num(a[0]) * p) / p; },
    ROUNDDOWN: (a) => { const p = Math.pow(10, num(a[1]) || 0); return Math.floor(num(a[0]) * p) / p; },
    INT: (a) => Math.floor(num(a[0])),
    TRUNC: (a) => Math.trunc(num(a[0])),
    MOD: (a) => (num(a[1]) === 0 ? ERR('#DIV/0!') : num(a[0]) % num(a[1])),
    POWER: (a) => Math.pow(num(a[0]), num(a[1])),
    SQRT: (a) => (num(a[0]) < 0 ? ERR('#NUM!') : Math.sqrt(num(a[0]))),
    EXP: (a) => Math.exp(num(a[0])),
    LN: (a) => Math.log(num(a[0])),
    LOG: (a) => (a.length > 1 ? Math.log(num(a[0])) / Math.log(num(a[1])) : Math.log10(num(a[0]))),
    LOG10: (a) => Math.log10(num(a[0])),
    PI: () => Math.PI,
    RAND: () => Math.random(),
    RANDBETWEEN: (a) => Math.floor(Math.random() * (num(a[1]) - num(a[0]) + 1)) + num(a[0]),
    SIGN: (a) => Math.sign(num(a[0])),
    CEILING: (a) => Math.ceil(num(a[0]) / (num(a[1]) || 1)) * (num(a[1]) || 1),
    FLOOR: (a) => Math.floor(num(a[0]) / (num(a[1]) || 1)) * (num(a[1]) || 1),
    LEN: (a) => toStr(a[0]).length,
    LEFT: (a) => toStr(a[0]).slice(0, a.length > 1 ? num(a[1]) : 1),
    RIGHT: (a) => { const n = a.length > 1 ? num(a[1]) : 1; return n === 0 ? '' : toStr(a[0]).slice(-n); },
    MID: (a) => toStr(a[0]).substr(num(a[1]) - 1, num(a[2])),
    UPPER: (a) => toStr(a[0]).toUpperCase(),
    LOWER: (a) => toStr(a[0]).toLowerCase(),
    PROPER: (a) => toStr(a[0]).replace(/\w\S*/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase()),
    TRIM: (a) => toStr(a[0]).trim().replace(/\s+/g, ' '),
    CONCAT: (a) => flatten(a).map(toStr).join(''),
    CONCATENATE: (a) => flatten(a).map(toStr).join(''),
    TEXTJOIN: (a) => flatten(a.slice(1)).map(toStr).filter((x) => x !== '').join(toStr(a[0])),
    REPT: (a) => toStr(a[0]).repeat(Math.max(0, Math.min(200, num(a[1])))),
    SUBSTITUTE: (a) => toStr(a[0]).split(toStr(a[1])).join(toStr(a[2])),
    REPLACE: (a) => { const s = toStr(a[0]); return s.slice(0, num(a[1]) - 1) + toStr(a[3]) + s.slice(num(a[1]) - 1 + num(a[2])); },
    FIND: (a) => { const i = toStr(a[1]).indexOf(toStr(a[0]), a.length > 2 ? num(a[2]) - 1 : 0); return i < 0 ? ERR('#VALUE!') : i + 1; },
    SEARCH: (a) => { const i = toStr(a[1]).toLowerCase().indexOf(toStr(a[0]).toLowerCase(), a.length > 2 ? num(a[2]) - 1 : 0); return i < 0 ? ERR('#VALUE!') : i + 1; },
    VALUE: (a) => num(toStr(a[0]).replace(/,/g, '')),
    TEXT: (a) => { const v = num(a[0]); const f = toStr(a[1]); if (/0\.0+%|%/.test(f)) return (v * 100).toFixed((f.match(/0\.(0+)/) || [, ''])[1].length) + '%'; if (/0\.0+/.test(f)) return v.toFixed((f.match(/0\.(0+)/) || [, '0'])[1].length); if (/,/.test(f)) return v.toLocaleString('zh-CN'); return String(v); },
    ISBLANK: (a) => a[0] === '' || a[0] == null,
    ISNUMBER: (a) => typeof a[0] === 'number',
    ISTEXT: (a) => typeof a[0] === 'string' && a[0] !== '',
    ISERROR: (a) => typeof a[0] === 'object' && a[0] && a[0].err,
    ISLOGICAL: (a) => typeof a[0] === 'boolean',
    NA: () => ERR('#N/A'),
    COUNTIF: (a) => {
      const list = flatten(a[0] || []), crit = a[1];
      return list.filter((v) => matchCrit(v, crit)).length;
    },
    SUMIF: (a) => {
      const list = flatten(a[0] || []), crit = a[1], sumList = a.length > 2 ? flatten(a[2]) : list;
      let s = 0;
      list.forEach((v, i) => { if (matchCrit(v, crit)) s += num(sumList[i]); });
      return s;
    },
    AVERAGEIF: (a) => {
      const list = flatten(a[0] || []), crit = a[1];
      const hit = list.filter((v) => matchCrit(v, crit)).map(num).filter((v) => !isNaN(v));
      return hit.length ? hit.reduce((s, v) => s + v, 0) / hit.length : ERR('#DIV/0!');
    },
    SUMPRODUCT: (a) => {
      const lists = a.map(flatten);
      let s = 0;
      for (let i = 0; i < lists[0].length; i++) { let p = 1; for (let j = 0; j < lists.length; j++) p *= num(lists[j][i]); s += p; }
      return s;
    },
    RANK: (a) => {
      const list = flatten(a[1] || []).filter((v) => typeof v === 'number').sort((x, y) => num(a[2]) === 0 ? x - y : y - x);
      const i = list.indexOf(num(a[0]));
      return i < 0 ? ERR('#N/A') : i + 1;
    },
    LARGE: (a) => { const l = flatten(a[0]).filter((v) => typeof v === 'number').sort((x, y) => y - x); return l[num(a[1]) - 1] == null ? ERR('#NUM!') : l[num(a[1]) - 1]; },
    SMALL: (a) => { const l = flatten(a[0]).filter((v) => typeof v === 'number').sort((x, y) => x - y); return l[num(a[1]) - 1] == null ? ERR('#NUM!') : l[num(a[1]) - 1]; },
    VLOOKUP: (a) => {
      const table = a[1], key = a[0], colIdx = num(a[2]), approx = a.length > 3 ? !!a[3] : true;
      if (!Array.isArray(table) || !table.length) return ERR('#REF!');
      for (let i = 0; i < table.length; i++) {
        const row = Array.isArray(table[i]) ? table[i] : [table[i]];
        if (approx ? num(row[0]) <= num(key) : toStr(row[0]) === toStr(key)) {
          if (!approx) return row[colIdx - 1] == null ? ERR('#REF!') : row[colIdx - 1];
          if (i === table.length - 1 || num(table[i + 1][0]) > num(key)) return row[colIdx - 1] == null ? ERR('#REF!') : row[colIdx - 1];
        }
      }
      return ERR('#N/A');
    },
    INDEX: (a) => {
      const t = a[0];
      if (!Array.isArray(t)) return t;
      const r = a.length > 1 ? num(a[1]) : 1, c = a.length > 2 ? num(a[2]) : 1;
      const row = Array.isArray(t[0]) ? t[r - 1] : t;
      return Array.isArray(row) ? (row[c - 1] == null ? ERR('#REF!') : row[c - 1]) : (row == null ? ERR('#REF!') : row);
    },
    MATCH: (a) => {
      const list = flatten(a[1]), k = a[0];
      for (let i = 0; i < list.length; i++) if (toStr(list[i]) === toStr(k) || num(list[i]) === num(k)) return i + 1;
      return ERR('#N/A');
    },
    TODAY: () => new Date().toLocaleDateString('zh-CN'),
    NOW: () => new Date().toLocaleString('zh-CN'),
    YEAR: (a) => new Date(a[0]).getFullYear(),
    MONTH: (a) => new Date(a[0]).getMonth() + 1,
    DAY: (a) => new Date(a[0]).getDate(),
    ROW: () => ERR('#N/A'),
    COLUMN: () => ERR('#N/A')
  };

  function matchCrit(v, crit) {
    const c = toStr(crit);
    const m = /^(>=|<=|<>|>|<|=)?(.*)$/.exec(c);
    const op = m[1] || '=', target = m[2];
    const a = num(v), b = num(target);
    const bothNum = !isNaN(a) && !isNaN(b) && target.trim() !== '';
    switch (op) {
      case '>': return bothNum ? a > b : toStr(v) > target;
      case '<': return bothNum ? a < b : toStr(v) < target;
      case '>=': return bothNum ? a >= b : toStr(v) >= target;
      case '<=': return bothNum ? a <= b : toStr(v) <= target;
      case '<>': return toStr(v) !== target;
      default:
        if (/[*?]/.test(target)) {
          const re = new RegExp('^' + target.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$', 'i');
          return re.test(toStr(v));
        }
        return bothNum ? a === b : toStr(v).toLowerCase() === target.toLowerCase();
    }
  }

  function makeEvaluator(getCell) {
    function ev(node) {
      switch (node.t) {
        case 'lit': return node.v;
        case 'ref': {
          const c = getCell(node.ref);
          if (!c) return '';
          if (c.err) return ERR(c.err);
          return c.v;
        }
        case 'range': return rangeVals(node.a, node.b);
        case 'name': {
          if (node.v === 'PI') return Math.PI;
          return ERR('#NAME?');
        }
        case 'un': { const v = num(ev(node.e)); return node.op === '-' ? -v : v; }
        case 'pct': return num(ev(node.e)) / 100;
        case 'bin': {
          const op = node.op;
          if (op === '&') return toStr(ev(node.l)) + toStr(ev(node.r));
          const l = ev(node.l), r = ev(node.r);
          if (l && l.err) return l; if (r && r.err) return r;
          if (['=', '<>', '<', '>', '<=', '>='].indexOf(op) >= 0) {
            const ls = toStr(l), rs = toStr(r), ln = num(l), rn = num(r);
            const numeric = !isNaN(ln) && !isNaN(rn) && ls !== '' && rs !== '';
            switch (op) {
              case '=': return numeric ? ln === rn : ls === rs;
              case '<>': return numeric ? ln !== rn : ls !== rs;
              case '<': return numeric ? ln < rn : ls < rs;
              case '>': return numeric ? ln > rn : ls > rs;
              case '<=': return numeric ? ln <= rn : ls <= rs;
              case '>=': return numeric ? ln >= rn : ls >= rs;
            }
          }
          const a = num(l), b = num(r);
          if (isNaN(a) || isNaN(b)) return ERR('#VALUE!');
          switch (op) {
            case '+': return a + b; case '-': return a - b; case '*': return a * b;
            case '/': return b === 0 ? ERR('#DIV/0!') : a / b;
            case '^': return Math.pow(a, b);
          }
          return ERR('#VALUE!');
        }
        case 'call': {
          const fn = FN[node.name];
          if (!fn) return ERR('#NAME?');
          const args = node.args.map((a) => {
            if (a.t === 'range') return rangeVals(a.a, a.b);
            return ev(a);
          });
          try {
            const r = fn(args);
            return r === undefined ? ERR('#VALUE!') : r;
          } catch (e) { return ERR('#VALUE!'); }
        }
      }
      return ERR('#ERROR!');
    }
    function rangeVals(a, b) {
      const pa = /^([A-Za-z]+)(\d+)$/.exec(a), pb = /^([A-Za-z]+)(\d+)$/.exec(b);
      if (!pa || !pb) return [];
      const c1 = Math.min(colIndex(pa[1]), colIndex(pb[1])), c2 = Math.max(colIndex(pa[1]), colIndex(pb[1]));
      const r1 = Math.min(+pa[2], +pb[2]) - 1, r2 = Math.max(+pa[2], +pb[2]) - 1;
      const out = [];
      for (let r = r1; r <= r2; r++) {
        const row = [];
        for (let c = c1; c <= c2; c++) { const cell = getCell(colName(c) + (r + 1)); row.push(cell && cell.err ? cell.err : (cell ? cell.v : '')); }
        out.push(row);
      }
      return out;
    }
    return ev;
  }

  /* ==========================================================
     工作表计算与渲染
     ========================================================== */
  let doc = null, sheetIdx = 0, ROWS = 60, COLS = 20;
  let sel = { r: 0, c: 0 }, range = null, editing = null, onChange = null;
  let undoStack = [], redoStack = [];
  let computed = {};   // 'r,c' -> {v, err}
  let clipboard = null;
  let bound = false;
  const colW = {}, rowH = {};

  const sheet = () => doc.data.sheets[sheetIdx];

  function compute() {
    const sh = sheet();
    const cache = {}, stack = {};
    function getByRef(ref) {
      const m = /^([A-Za-z]+)(\d+)$/.exec(ref);
      if (!m) return null;
      return get(+m[2] - 1, colIndex(m[1]));   // 注意：get(行, 列)
    }
    function get(r, c) {
      const k = r + ',' + c;
      if (cache[k] !== undefined) return cache[k];
      if (stack[k]) return { v: '', err: '#CIRC!' };
      const cell = sh.cells[k];
      if (!cell) { cache[k] = { v: '' }; return cache[k]; }
      stack[k] = 1;
      let res;
      if (cell.f) {
        try {
          const ev = makeEvaluator(getByRef);
          const ast = parse(tokenize(cell.f.replace(/^=/, '')));
          const v = ev(ast);
          res = (v && v.err) ? { v: '', err: v.err } : { v: v };
        } catch (e) { res = { v: '', err: '#ERROR!' }; }
      } else res = { v: cell.v };
      delete stack[k];
      cache[k] = res;
      return res;
    }
    computed = { get: get, cache: cache };
    // 预计算可见区域
    const out = {};
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) { const k = r + ',' + c; if (sh.cells[k]) out[k] = get(r, c); }
    return out;
  }

  function fmtValue(v, cell) {
    if (v == null || v === '') return '';
    if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
    const fmt = cell && cell.fmt;
    if (typeof v === 'number' && fmt) {
      switch (fmt) {
        case 'number': return v.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        case 'int': return Math.round(v).toLocaleString('zh-CN');
        case 'currency': return '¥' + v.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        case 'percent': return (v * 100).toFixed(2) + '%';
        case 'sci': return v.toExponential(2);
        case 'thousand': return v.toLocaleString('zh-CN');
      }
    }
    return String(v);
  }

  function render() {
    const sh = sheet();
    const table = $('#sheetTable');
    const vals = compute();
    let h = '<thead><tr><th class="corner"></th>';
    for (let c = 0; c < COLS; c++) h += '<th data-col="' + c + '" style="width:' + (sh.cols[c] || sh.colW) + 'px">' + colName(c) + '</th>';
    h += '</tr></thead><tbody>';
    for (let r = 0; r < ROWS; r++) {
      h += '<tr><th data-row="' + r + '" style="height:' + (sh.rows[r] || sh.rowH) + 'px">' + (r + 1) + '</th>';
      for (let c = 0; c < COLS; c++) {
        const k = r + ',' + c;
        const cell = sh.cells[k];
        const cv = vals[k] || computed.cache[k] || { v: '' };
        const st = [];
        if (cell) {
          if (cell.b) st.push('font-weight:700');
          if (cell.i) st.push('font-style:italic');
          if (cell.u) st.push('text-decoration:underline');
          if (cell.color) st.push('color:' + cell.color);
          if (cell.bg) st.push('background:' + cell.bg);
          if (cell.align) st.push('text-align:' + cell.align);
          if (cell.wrap) st.push('white-space:normal;word-break:break-word');
        }
        const cls = ['cell-fill'];
        const text = cv.err ? cv.err : fmtValue(cv.v, cell);
        if (cv.err) cls.push('err');
        else if (typeof cv.v === 'number') cls.push('num');
        h += '<td class="' + cls.join(' ') + '" data-r="' + r + '" data-c="' + c + '"' +
          (st.length ? ' style="' + st.join(';') + '"' : '') + '>' + FW.escapeHtml(text) + '</td>';
      }
      h += '</tr>';
    }
    table.innerHTML = h + '</tbody>';
    paintSelection();
    renderTabs();
  }

  function renderTabs() {
    const box = $('#sheetTabs');
    let h = '';
    doc.data.sheets.forEach((s, i) => {
      h += '<button class="st-tab' + (i === sheetIdx ? ' active' : '') + '" data-sheet="' + i + '"' +
        (i === sheetIdx ? ' ondblclick="FW.Editors.sheet.renameSheet()"' : '') + '>' + FW.escapeHtml(s.name) + '</button>';
    });
    h += '<button class="st-add" id="stAdd" title="新建工作表">+</button>';
    box.innerHTML = h;
  }

  function cellEl(r, c) { return $('#sheetTable').querySelector('td[data-r="' + r + '"][data-c="' + c + '"]'); }

  function paintSelection() {
    const table = $('#sheetTable');
    if (!table) return;
    $$('td.sel,td.inrange', table).forEach((td) => td.classList.remove('sel', 'inrange'));
    $$('th.hl', table).forEach((th) => th.classList.remove('hl'));
    if (range) {
      const r1 = Math.min(range.r1, range.r2), r2 = Math.max(range.r1, range.r2);
      const c1 = Math.min(range.c1, range.c2), c2 = Math.max(range.c1, range.c2);
      for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) {
        const td = cellEl(r, c); if (td) td.classList.add('inrange');
      }
      $$('th[data-col]', table).forEach((th) => { const c = +th.dataset.col; if (c >= c1 && c <= c2) th.classList.add('hl'); });
      $$('th[data-row]', table).forEach((th) => { const r = +th.dataset.row; if (r >= r1 && r <= r2) th.classList.add('hl'); });
      const a = cellEl(r1, c1), b = cellEl(r2, c2);
      if (a) a.classList.add('sel'); if (b) b.classList.add('sel');
      $('#cellRef').textContent = r1 === r2 && c1 === c2 ? colName(c1) + (r1 + 1) : colName(c1) + (r1 + 1) + ':' + colName(c2) + (r2 + 1);
    } else {
      const td = cellEl(sel.r, sel.c);
      if (td) td.classList.add('sel');
      $$('th[data-col="' + sel.c + '"]', table).forEach((th) => th.classList.add('hl'));
      $$('th[data-row="' + sel.r + '"]', table).forEach((th) => th.classList.add('hl'));
      $('#cellRef').textContent = colName(sel.c) + (sel.r + 1);
    }
    const cell = sheet().cells[sel.r + ',' + sel.c];
    $('#formulaInput').value = cell ? (cell.f || cell.v || '') : '';
    if (global.FW.app) global.FW.app.refreshStatus();
  }

  function scrollToCell() {
    const td = cellEl(sel.r, sel.c);
    const box = $('#sheetScroll');
    if (!td || !box) return;
    const tr = td.getBoundingClientRect(), br = box.getBoundingClientRect();
    if (tr.bottom > br.bottom - 4) box.scrollTop += tr.bottom - br.bottom + 30;
    if (tr.top < br.top + 30) box.scrollTop -= (br.top + 30 - tr.top);
    if (tr.right > br.right - 4) box.scrollLeft += tr.right - br.right + 60;
    if (tr.left < br.left + 48) box.scrollLeft -= (br.left + 48 - tr.left);
  }

  function setCell(r, c, patch) {
    const sh = sheet(), k = r + ',' + c;
    const cell = sh.cells[k] || {};
    Object.assign(cell, patch);
    if ((cell.v === '' || cell.v == null) && !cell.f && !cell.b && !cell.i && !cell.u && !cell.color && !cell.bg && !cell.align && !cell.fmt && !cell.wrap) delete sh.cells[k];
    else sh.cells[k] = cell;
  }

  function commitEdit(value) {
    if (!editing) return;
    const { r, c } = editing;
    const sh = sheet(), k = r + ',' + c;
    const prevRaw = sh.cells[k] ? JSON.stringify(sh.cells[k]) : '';
    const beforeCells = cloneCells(sh), bRows = ROWS, bCols = COLS, bSheet = sheetIdx;
    const raw = String(value);
    const patch = {};
    if (raw.charAt(0) === '=') { patch.f = raw; patch.v = null; }
    else {
      patch.f = null;
      const trimmed = raw.trim();
      if (trimmed !== '' && !isNaN(Number(trimmed)) && /^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(trimmed)) patch.v = Number(trimmed);
      else patch.v = raw;
    }
    setCell(r, c, Object.assign({}, patch));
    const cell = sh.cells[k];
    if (cell && cell.f === null) delete cell.f;
    const afterRaw = sh.cells[k] ? JSON.stringify(sh.cells[k]) : '';
    if (afterRaw !== prevRaw) recordChange(beforeCells, bRows, bCols, bSheet);
    editing = null;
    render();
    emit();
  }

  function startEdit(r, c, initial) {
    const td = cellEl(r, c);
    if (!td) return;
    const sh = sheet();
    const cell = sh.cells[r + ',' + c];
    editing = { r: r, c: c };
    const cur = cell ? (cell.f || (cell.v == null ? '' : cell.v)) : '';
    td.classList.add('editing');
    td.innerHTML = '<input type="text" value="' + FW.escapeHtml(initial != null ? initial : cur) + '">';
    const inp = td.querySelector('input');
    inp.focus();
    if (initial == null) inp.select(); else inp.setSelectionRange(inp.value.length, inp.value.length);
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); const v = inp.value; commitEdit(v); moveSel(1, 0); }
      else if (e.key === 'Escape') { editing = null; render(); }
      else if (e.key === 'Tab') { e.preventDefault(); const v = inp.value; commitEdit(v); moveSel(0, e.shiftKey ? -1 : 1); }
      e.stopPropagation();
    });
    inp.addEventListener('blur', () => { if (editing) { const v = inp.value; commitEdit(v); } });
  }

  function moveSel(dr, dc, shift) {
    const r = Math.max(0, Math.min(ROWS - 1, sel.r + dr));
    const c = Math.max(0, Math.min(COLS - 1, sel.c + dc));
    if (shift) {
      if (!range) range = { r1: sel.r, c1: sel.c, r2: sel.r, c2: sel.c };
      range.r2 = r; range.c2 = c;
    } else { range = null; sel = { r: r, c: c }; }
    paintSelection();
    scrollToCell();
  }

  function selBounds() {
    if (!range) return { r1: sel.r, c1: sel.c, r2: sel.r, c2: sel.c };
    return {
      r1: Math.min(range.r1, range.r2), r2: Math.max(range.r1, range.r2),
      c1: Math.min(range.c1, range.c2), c2: Math.max(range.c1, range.c2)
    };
  }

  function emit() { if (onChange) onChange(); }

  /* ---------- 撤销 / 重做（按整张工作表的单元格快照） ---------- */
  function cloneCells(sh) { return JSON.parse(JSON.stringify(sh.cells || {})); }
  function recordChange(cells, rows, cols, sIdx) {
    undoStack.push({ sheetIdx: sIdx, cells: cells, rows: rows, cols: cols });
    if (undoStack.length > 60) undoStack.shift();
    redoStack.length = 0;
  }
  function currentSnap() { return { sheetIdx: sheetIdx, cells: cloneCells(sheet()), rows: ROWS, cols: COLS }; }
  function applySnap(s) {
    if (!s || !doc.data.sheets[s.sheetIdx]) return;
    doc.data.sheets[s.sheetIdx].cells = JSON.parse(JSON.stringify(s.cells));
    sheetIdx = s.sheetIdx; doc.data.active = sheetIdx;
    if (s.rows) ROWS = s.rows;
    if (s.cols) COLS = s.cols;
    sel = { r: 0, c: 0 }; range = null; editing = null;
    render(); emit();
  }

  /* ---------- 命令 ---------- */
  function applyStyle(patch) {
    const before = cloneCells(sheet()), bR = ROWS, bC = COLS, bS = sheetIdx;
    const b = selBounds();
    for (let r = b.r1; r <= b.r2; r++) for (let c = b.c1; c <= b.c2; c++) setCell(r, c, patch);
    recordChange(before, bR, bC, bS);
    render(); emit();
  }

  function autosum() {
    const b = selBounds();
    let r = b.r1 - 1, vals = [];
    while (r >= 0) {
      const cell = sheet().cells[r + ',' + b.c1];
      const cv = computed.cache[r + ',' + b.c1];
      if (!cell || !cv || typeof cv.v !== 'number') break;
      vals.unshift(cv.v); r--;
    }
    if (!vals.length) { FW.toast('上方没有可求和的数据'); return; }
    recordChange(cloneCells(sheet()), ROWS, COLS, sheetIdx);
    setCell(b.r1, b.c1, { f: '=SUM(' + colName(b.c1) + (r + 2) + ':' + colName(b.c1) + b.r1 + ')', v: null });
    render(); emit();
    FW.toast('已插入 SUM 公式');
  }

  function insertRow(where) {
    const b = selBounds(), sh = sheet();
    recordChange(cloneCells(sh), ROWS, COLS, sheetIdx);
    const n = b.r2 - b.r1 + 1;
    const nc = {};
    Object.keys(sh.cells).forEach((k) => {
      const m = /^(\d+),(\d+)$/.exec(k); if (!m) return;
      const r = +m[1], c = +m[2];
      nc[(r >= b.r1 ? r + n : r) + ',' + c] = sh.cells[k];
    });
    sh.cells = nc;
    if (where === 'above') { ROWS = Math.max(ROWS, b.r2 + n + 1); }
    render(); emit(); FW.toast('已插入 ' + n + ' 行');
  }

  function deleteRow() {
    const b = selBounds(), sh = sheet();
    recordChange(cloneCells(sh), ROWS, COLS, sheetIdx);
    const n = b.r2 - b.r1 + 1, nc = {};
    Object.keys(sh.cells).forEach((k) => {
      const m = /^(\d+),(\d+)$/.exec(k); if (!m) return;
      const r = +m[1], c = +m[2];
      if (r >= b.r1 && r <= b.r2) return;
      nc[(r > b.r2 ? r - n : r) + ',' + c] = sh.cells[k];
    });
    sh.cells = nc;
    sel = { r: b.r1, c: b.c1 }; range = null;
    render(); emit(); FW.toast('已删除 ' + n + ' 行');
  }

  function insertCol() {
    const b = selBounds(), sh = sheet();
    recordChange(cloneCells(sh), ROWS, COLS, sheetIdx);
    const n = b.c2 - b.c1 + 1, nc = {};
    Object.keys(sh.cells).forEach((k) => {
      const m = /^(\d+),(\d+)$/.exec(k); if (!m) return;
      const r = +m[1], c = +m[2];
      nc[r + ',' + (c >= b.c1 ? c + n : c)] = sh.cells[k];
    });
    sh.cells = nc;
    COLS = Math.max(COLS, b.c2 + n + 1);
    render(); emit(); FW.toast('已插入 ' + n + ' 列');
  }

  function deleteCol() {
    const b = selBounds(), sh = sheet();
    recordChange(cloneCells(sh), ROWS, COLS, sheetIdx);
    const n = b.c2 - b.c1 + 1, nc = {};
    Object.keys(sh.cells).forEach((k) => {
      const m = /^(\d+),(\d+)$/.exec(k); if (!m) return;
      const r = +m[1], c = +m[2];
      if (c >= b.c1 && c <= b.c2) return;
      nc[r + ',' + (c > b.c2 ? c - n : c)] = sh.cells[k];
    });
    sh.cells = nc;
    sel = { r: b.r1, c: b.c1 }; range = null;
    render(); emit(); FW.toast('已删除 ' + n + ' 列');
  }

  function copySel(cut) {
    const b = selBounds(), sh = sheet();
    const grid = [];
    for (let r = b.r1; r <= b.r2; r++) {
      const row = [];
      for (let c = b.c1; c <= b.c2; c++) {
        const cell = sh.cells[r + ',' + c];
        const cv = computed.cache[r + ',' + c] || { v: '' };
        row.push(cell && cell.f ? cell.f : (cv.err || (cv.v == null ? '' : cv.v)));
      }
      grid.push(row);
    }
    clipboard = { grid: grid, cut: !!cut, b: b };
    const tsv = grid.map((r) => r.map((v) => {
      const s = String(v == null ? '' : v);
      return /[\t\n"]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }).join('\t')).join('\n');
    try { navigator.clipboard && navigator.clipboard.writeText(tsv); } catch (e) {}
    FW.toast(cut ? '已剪切 ' + grid.length + ' 行 × ' + (grid[0] ? grid[0].length : 0) + ' 列' : '已复制到剪贴板');
  }

  function pasteGrid(grid, text) {
    const sh = sheet();
    if (!grid && text) {
      grid = text.replace(/\r\n/g, '\n').split('\n').map((line) => line.split('\t'));
    }
    if (!grid || !grid.length) return;
    recordChange(cloneCells(sheet()), ROWS, COLS, sheetIdx);
    const b = selBounds();
    grid.forEach((row, ri) => row.forEach((v, ci) => {
      const raw = String(v);
      const patch = {};
      if (raw.charAt(0) === '=') { patch.f = raw; patch.v = null; }
      else { patch.f = null; patch.v = raw !== '' && !isNaN(Number(raw)) && /^-?\d+(\.\d+)?$/.test(raw.trim()) ? Number(raw) : raw; }
      setCell(b.r1 + ri, b.c1 + ci, patch);
      const cell = sheet().cells[(b.r1 + ri) + ',' + (b.c1 + ci)];
      if (cell && cell.f === null) delete cell.f;
    }));
    render(); emit();
    FW.toast('已粘贴 ' + grid.length + ' 行');
  }

  function clearSel() {
    const b = selBounds(), sh = sheet();
    recordChange(cloneCells(sh), ROWS, COLS, sheetIdx);
    for (let r = b.r1; r <= b.r2; r++) for (let c = b.c1; c <= b.c2; c++) delete sh.cells[r + ',' + c];
    render(); emit();
  }

  function sortSel(asc) {
    const b = selBounds(), sh = sheet();
    recordChange(cloneCells(sh), ROWS, COLS, sheetIdx);
    const col = b.c1;
    const rowsData = [];
    for (let r = b.r1; r <= b.r2; r++) {
      const cv = computed.cache[r + ',' + col] || { v: '' };
      rowsData.push({ v: cv.v, cells: {} });
      for (let c = 0; c < COLS; c++) if (sh.cells[r + ',' + c]) rowsData[rowsData.length - 1].cells[c] = sh.cells[r + ',' + c];
    }
    rowsData.sort((x, y) => {
      const a = typeof x.v === 'number' ? x.v : String(x.v);
      const bb = typeof y.v === 'number' ? y.v : String(y.v);
      if (typeof a === 'number' && typeof bb === 'number') return asc ? a - bb : bb - a;
      return asc ? String(a).localeCompare(String(bb), 'zh') : String(bb).localeCompare(String(a), 'zh');
    });
    for (let r = b.r1; r <= b.r2; r++) for (let c = 0; c < COLS; c++) delete sh.cells[r + ',' + c];
    rowsData.forEach((rd, i) => { Object.keys(rd.cells).forEach((c) => { sh.cells[(b.r1 + i) + ',' + c] = rd.cells[c]; }); });
    render(); emit();
    FW.toast(asc ? '已升序排列' : '已降序排列');
  }

  function exportCsv() {
    const csv = global.OFFICE.sheetToCsv(sheet());
    FW.downloadText((doc.title || '表格') + '.csv', csv, 'text/csv');
    FW.toast('已导出 CSV');
  }

  /* ---------- 功能区 ---------- */
  const ribbon = [
    {
      tab: '开始', groups: [
        {
          label: '剪贴板', items: [
            { t: 'btn', g: '⧉', label: '复制', cmd: 'copy' },
            { t: 'btn', g: '✂', label: '剪切', cmd: 'cut' },
            { t: 'btn', g: '📋', label: '粘贴', cmd: 'paste' },
            { t: 'btn', g: '⌫', label: '清除', cmd: 'clear' }
          ]
        },
        {
          label: '字体', items: [
            { t: 'btn', g: 'B', label: '加粗', cmd: 'bold', toggle: true, style: 'font-weight:800' },
            { t: 'btn', g: 'I', label: '斜体', cmd: 'italic', toggle: true, style: 'font-style:italic' },
            { t: 'btn', g: 'U', label: '下划线', cmd: 'underline', toggle: true, style: 'text-decoration:underline' },
            { t: 'color', g: 'A', label: '字体颜色', cmd: 'color', value: '#D93B2B' },
            { t: 'color', g: '▨', label: '填充色', cmd: 'bg', value: '#FFF176' },
            { t: 'btn', g: '⌫', label: '无填充', cmd: 'bg:none', wide: true }
          ]
        },
        {
          label: '对齐', items: [
            { t: 'btn', g: '☰', label: '左对齐', cmd: 'align:left' },
            { t: 'btn', g: '≣', label: '居中', cmd: 'align:center' },
            { t: 'btn', g: '☰', label: '右对齐', cmd: 'align:right' },
            { t: 'btn', g: '↩', label: '自动换行', cmd: 'wrap', toggle: true }
          ]
        },
        {
          label: '数字格式', items: [
            { t: 'btn', g: '¥', label: '货币', cmd: 'fmt:currency' },
            { t: 'btn', g: '%', label: '百分比', cmd: 'fmt:percent' },
            { t: 'btn', g: ',', label: '千分位', cmd: 'fmt:thousand' },
            { t: 'btn', g: '.00', label: '两位小数', cmd: 'fmt:number', wide: true },
            { t: 'btn', g: '0', label: '整数', cmd: 'fmt:int' },
            { t: 'btn', g: '常规', label: '常规', cmd: 'fmt:general', wide: true }
          ]
        },
        {
          label: '编辑', items: [
            { t: 'btn', g: 'Σ', label: '自动求和', cmd: 'autosum', wide: true },
            { t: 'btn', g: '↑', label: '升序', cmd: 'sortAsc', wide: true },
            { t: 'btn', g: '↓', label: '降序', cmd: 'sortDesc', wide: true }
          ]
        }
      ]
    },
    {
      tab: '插入', groups: [
        {
          label: '行和列', items: [
            { t: 'btn', g: '⬒', label: '插入行', cmd: 'insertRow', wide: true },
            { t: 'btn', g: '⬓', label: '删除行', cmd: 'deleteRow', wide: true },
            { t: 'btn', g: '◧', label: '插入列', cmd: 'insertCol', wide: true },
            { t: 'btn', g: '◨', label: '删除列', cmd: 'deleteCol', wide: true }
          ]
        },
        {
          label: '函数', items: [
            { t: 'btn', g: 'Σ', label: 'SUM 求和', cmd: 'fn:SUM' },
            { t: 'btn', g: 'x̄', label: 'AVERAGE', cmd: 'fn:AVERAGE' },
            { t: 'btn', g: '↑', label: 'MAX', cmd: 'fn:MAX' },
            { t: 'btn', g: '↓', label: 'MIN', cmd: 'fn:MIN' },
            { t: 'btn', g: '#', label: 'COUNT', cmd: 'fn:COUNT' },
            { t: 'btn', g: '?', label: 'IF', cmd: 'fn:IF' },
            { t: 'btn', g: '⌕', label: 'VLOOKUP', cmd: 'fn:VLOOKUP', wide: true }
          ]
        },
        {
          label: '数据', items: [
            { t: 'btn', g: '№', label: '填充序号', cmd: 'fillSeq', wide: true },
            { t: 'btn', g: '⌗', label: '拆分文本', cmd: 'splitText', wide: true },
            { t: 'btn', g: '⇄', label: '转置', cmd: 'transpose', wide: true }
          ]
        }
      ]
    },
    {
      tab: '视图', groups: [
        {
          label: '冻结窗格', items: [
            { t: 'btn', g: '❄', label: '冻结首行', cmd: 'freeze:1', wide: true },
            { t: 'btn', g: '❄', label: '冻结到当前行', cmd: 'freezeHere', wide: true },
            { t: 'btn', g: '☀', label: '取消冻结', cmd: 'freeze:0', wide: true }
          ]
        },
        {
          label: '工作表', items: [
            { t: 'btn', g: '＋', label: '新建工作表', cmd: 'addSheet', wide: true },
            { t: 'btn', g: '✎', label: '重命名', cmd: 'renameSheet', wide: true },
            { t: 'btn', g: '🗑', label: '删除工作表', cmd: 'delSheet', wide: true }
          ]
        }
      ]
    },
    {
      tab: '导出', groups: [
        {
          label: '文件', items: [
            { t: 'btn', g: 'X', label: '导出 Excel', cmd: 'export:xlsx', wide: true },
            { t: 'btn', g: ',', label: '导出 CSV', cmd: 'export:csv', wide: true },
            { t: 'btn', g: '<>', label: '导出网页', cmd: 'export:html', wide: true },
            { t: 'btn', g: 'P', label: '打印 / PDF', cmd: 'print', wide: true }
          ]
        }
      ]
    }
  ];

  /* ---------- 对外暴露公式引擎（便于测试与外部复用） ---------- */
  function evalFormulaString(formula, cells) {
    cells = cells || {};
    const cache = {}, stack = {};
    function getByRef(ref) {
      const m = /^([A-Za-z]+)(\d+)$/.exec(ref);
      if (!m) return null;
      return get(+m[2] - 1, colIndex(m[1]));
    }
    function get(r, c) {
      const k = r + ',' + c;
      if (cache[k] !== undefined) return cache[k];
      if (stack[k]) return { v: '', err: '#CIRC!' };
      const cell = cells[k];
      if (!cell) { cache[k] = { v: '' }; return cache[k]; }
      stack[k] = 1;
      let res;
      if (cell.f) {
        try {
          const ev = makeEvaluator(getByRef);
          const ast = parse(tokenize(String(cell.f).replace(/^=/, '')));
          const v = ev(ast);
          res = (v && v.err) ? { v: '', err: v.err } : { v: v };
        } catch (e) { res = { v: '', err: '#ERROR!' }; }
      } else res = { v: cell.v };
      delete stack[k];
      cache[k] = res;
      return res;
    }
    try {
      const ev = makeEvaluator(getByRef);
      const ast = parse(tokenize(String(formula).replace(/^=/, '')));
      const v = ev(ast);
      return (v && v.err) ? { err: v.err } : { v: v };
    } catch (e) { return { err: '#ERROR!' }; }
  }

  /* ---------- 事件绑定 ---------- */
  function bindEvents() {
    if (bound) return;
    bound = true;
    const table = $('#sheetTable');
    table.addEventListener('mousedown', (e) => {
      const th = e.target.closest('th');
      if (th) {
        if (th.dataset.col != null) {
          const c = +th.dataset.col;
          sel = { r: 0, c: c }; range = { r1: 0, c1: c, r2: ROWS - 1, c2: c };
          paintSelection(); return;
        }
        if (th.dataset.row != null) {
          const r = +th.dataset.row;
          sel = { r: r, c: 0 }; range = { r1: r, c1: 0, r2: r, c2: COLS - 1 };
          paintSelection(); return;
        }
        return;
      }
      const td = e.target.closest('td');
      if (!td || editing) return;
      const r = +td.dataset.r, c = +td.dataset.c;
      if (e.shiftKey) {
        if (!range) range = { r1: sel.r, c1: sel.c, r2: r, c2: c };
        else range.r2 = r, range.c2 = c;
        sel = { r: r, c: c };
      } else { range = null; sel = { r: r, c: c }; }
      paintSelection();
      if (global.FW.app) global.FW.app.syncRibbonState({});
    });

    table.addEventListener('dblclick', (e) => {
      const td = e.target.closest('td');
      if (!td) return;
      startEdit(+td.dataset.r, +td.dataset.c);
    });

    $('#sheetScroll').addEventListener('scroll', () => {
      const bar = $('#sheetScroll');
      document.documentElement.style.setProperty('--x', bar.scrollLeft + 'px');
    });

    document.addEventListener('keydown', onKey, true);
    document.addEventListener('paste', onPaste, true);
    $('#formulaInput').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        commitEdit($('#formulaInput').value);
        moveSel(1, 0);
        e.preventDefault();
      } else if (e.key === 'Escape') { paintSelection(); $('#formulaInput').blur(); }
    });
    $('#formulaInput').addEventListener('blur', () => { if ($('#formulaInput').dataset.dirty === '1') { commitEdit($('#formulaInput').value); $('#formulaInput').dataset.dirty = '0'; } });
    $('#formulaInput').addEventListener('input', () => { $('#formulaInput').dataset.dirty = '1'; });

    $('#sheetTabs').addEventListener('click', (e) => {
      const t = e.target.closest('.st-tab');
      if (t) { sheetIdx = +t.dataset.sheet; doc.data.active = sheetIdx; sel = { r: 0, c: 0 }; range = null; render(); return; }
      if (e.target.closest('#stAdd')) global.FW.Editors.sheet.cmd('addSheet');
    });
  }

  function onKey(e) {
    if (!global.FW.app || global.FW.app.current() !== 'sheet') return;
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea') return;
    if (editing) return;
    const ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && e.key.toLowerCase() === 'c') { copySel(false); e.preventDefault(); return; }
    if (ctrl && e.key.toLowerCase() === 'x') { copySel(true); e.preventDefault(); return; }
    if (ctrl && e.key.toLowerCase() === 'v') { e.preventDefault(); return; }
    if (ctrl && e.key.toLowerCase() === 'b') { applyStyle({ b: !(sheet().cells[sel.r + ',' + sel.c] || {}).b }); e.preventDefault(); return; }
    if (ctrl && e.key.toLowerCase() === 'i') { applyStyle({ i: !(sheet().cells[sel.r + ',' + sel.c] || {}).i }); e.preventDefault(); return; }
    if (ctrl && e.key.toLowerCase() === 'u') { applyStyle({ u: !(sheet().cells[sel.r + ',' + sel.c] || {}).u }); e.preventDefault(); return; }
    if (ctrl && e.key.toLowerCase() === 'a') { range = { r1: 0, c1: 0, r2: ROWS - 1, c2: COLS - 1 }; paintSelection(); e.preventDefault(); return; }
    switch (e.key) {
      case 'ArrowUp': moveSel(-1, 0, e.shiftKey); e.preventDefault(); break;
      case 'ArrowDown': moveSel(1, 0, e.shiftKey); e.preventDefault(); break;
      case 'ArrowLeft': moveSel(0, -1, e.shiftKey); e.preventDefault(); break;
      case 'ArrowRight': moveSel(0, 1, e.shiftKey); e.preventDefault(); break;
      case 'Tab': moveSel(0, e.shiftKey ? -1 : 1); e.preventDefault(); break;
      case 'Enter': startEdit(sel.r, sel.c); e.preventDefault(); break;
      case 'F2': startEdit(sel.r, sel.c); e.preventDefault(); break;
      case 'Delete': case 'Backspace': clearSel(); e.preventDefault(); break;
      case 'Home': sel = { r: sel.r, c: 0 }; range = null; paintSelection(); scrollToCell(); e.preventDefault(); break;
      default:
        if (e.key.length === 1 && !ctrl && !e.altKey) { startEdit(sel.r, sel.c, e.key); e.preventDefault(); }
    }
  }

  function onPaste(e) {
    if (!global.FW.app || global.FW.app.current() !== 'sheet') return;
    if (editing) return;
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea') return;
    const text = (e.clipboardData || window.clipboardData).getData('text');
    if (text) { pasteGrid(null, text); e.preventDefault(); }
  }

  /* ---------- 模块接口 ---------- */
  global.FW.Editors = global.FW.Editors || {};
  global.FW.Formula = { eval: evalFormulaString, colName: colName, colIndex: colIndex };
  global.FW.Editors.sheet = {
    badge: '表格',
    badgeCls: 'sheet',
    ribbon: ribbon,

    mount(d) {
      doc = d;
      ROWS = Math.max(60, d.data.rows || 60);
      COLS = Math.max(20, d.data.cols || 20);
      sheetIdx = d.data.active || 0;
      if (sheetIdx < 0 || sheetIdx >= doc.data.sheets.length) sheetIdx = 0;
      sel = { r: 0, c: 0 }; range = null; editing = null;
      render();
      bindEvents();
    },

    unmount() {
      // 全局监听器自带类型判断，保持常驻即可，避免重复绑定
      editing = null;
      $('#formulaInput').dataset.dirty = '0';
    },

    getData() {
      doc.data.active = sheetIdx;
      doc.data.rows = ROWS; doc.data.cols = COLS;
      return doc.data;
    },

    setChangeHandler(fn) { onChange = fn; },

    renameSheet() {
      const s = sheet();
      const n = prompt('重命名工作表：', s.name);
      if (n && n.trim()) { s.name = n.trim(); renderTabs(); emit(); }
    },

    cmd(name, value) {
      if (name === 'bold') return applyStyle({ b: !(sheet().cells[sel.r + ',' + sel.c] || {}).b });
      if (name === 'italic') return applyStyle({ i: !(sheet().cells[sel.r + ',' + sel.c] || {}).i });
      if (name === 'underline') return applyStyle({ u: !(sheet().cells[sel.r + ',' + sel.c] || {}).u });
      if (name === 'color') return applyStyle({ color: value });
      if (name === 'bg') return applyStyle({ bg: value });
      if (name === 'bg:none') return applyStyle({ bg: null });
      if (name.indexOf('align:') === 0) return applyStyle({ align: name.slice(6) });
      if (name === 'wrap') return applyStyle({ wrap: !(sheet().cells[sel.r + ',' + sel.c] || {}).wrap });
      if (name.indexOf('fmt:') === 0) { const f = name.slice(4); return applyStyle({ fmt: f === 'general' ? null : f }); }
      if (name === 'autosum') return autosum();
      if (name === 'copy') return copySel(false);
      if (name === 'cut') return copySel(true);
      if (name === 'paste') return clipboard ? pasteGrid(clipboard.grid) : FW.toast('剪贴板为空');
      if (name === 'clear') return clearSel();
      if (name === 'sortAsc') return sortSel(true);
      if (name === 'sortDesc') return sortSel(false);
      if (name === 'insertRow') return insertRow('above');
      if (name === 'deleteRow') return deleteRow();
      if (name === 'insertCol') return insertCol();
      if (name === 'deleteCol') return deleteCol();

      if (name.indexOf('fn:') === 0) {
        const fn = name.slice(3);
        const b = selBounds();
        const rng = colName(b.c1) + (b.r1 + 1) + ':' + colName(b.c2) + (b.r2 + 1);
        const tpl = { SUM: '=SUM(' + rng + ')', AVERAGE: '=AVERAGE(' + rng + ')', MAX: '=MAX(' + rng + ')', MIN: '=MIN(' + rng + ')', COUNT: '=COUNT(' + rng + ')', IF: '=IF(A1>0,"是","否")', VLOOKUP: '=VLOOKUP(A1,$A$1:$B$10,2,FALSE)' }[fn];
        startEdit(sel.r, sel.c, tpl);
        return;
      }
      if (name === 'fillSeq') {
        const b = selBounds();
        for (let i = 0; i <= b.r2 - b.r1; i++) setCell(b.r1 + i, b.c1, { v: i + 1, f: null });
        render(); emit(); FW.toast('已填充序号');
        return;
      }
      if (name === 'splitText') {
        const b = selBounds();
        const src = computed.cache[b.r1 + ',' + b.c1] || { v: '' };
        const parts = String(src.v).split(/[,，\s;；|]+/).filter(Boolean);
        if (!parts.length) { FW.toast('当前单元格没有可拆分的内容'); return; }
        parts.forEach((p, i) => setCell(b.r1, b.c1 + 1 + i, { v: isNaN(Number(p)) ? p : Number(p), f: null }));
        render(); emit(); FW.toast('已拆分为 ' + parts.length + ' 列');
        return;
      }
      if (name === 'transpose') {
        const b = selBounds(), sh = sheet();
        const grid = [];
        for (let r = b.r1; r <= b.r2; r++) { const row = []; for (let c = b.c1; c <= b.c2; c++) row.push(sh.cells[r + ',' + c] || null); grid.push(row); }
        for (let r = b.r1; r <= b.r2; r++) for (let c = b.c1; c <= b.c2; c++) delete sh.cells[r + ',' + c];
        grid[0].forEach((_, ci) => grid.forEach((row, ri) => { if (row[ci]) sh.cells[(b.r1 + ci) + ',' + (b.c1 + ri)] = row[ci]; }));
        render(); emit(); FW.toast('已转置');
        return;
      }
      if (name.indexOf('freeze:') === 0) { sheet().freeze = +name.slice(7); render(); FW.toast(+name.slice(7) ? '已冻结窗格' : '已取消冻结'); return; }
      if (name === 'freezeHere') { sheet().freeze = sel.r; render(); FW.toast('已冻结前 ' + sel.r + ' 行'); return; }
      if (name === 'addSheet') {
        doc.data.sheets.push({ name: 'Sheet' + (doc.data.sheets.length + 1), cells: {}, cols: {}, rows: {}, colW: 88, rowH: 24 });
        sheetIdx = doc.data.sheets.length - 1; doc.data.active = sheetIdx;
        render(); emit(); return;
      }
      if (name === 'renameSheet') return this.renameSheet();
      if (name === 'delSheet') {
        if (doc.data.sheets.length <= 1) { FW.toast('至少保留一个工作表'); return; }
        if (!confirm('确定删除工作表「' + sheet().name + '」？')) return;
        doc.data.sheets.splice(sheetIdx, 1);
        sheetIdx = Math.max(0, sheetIdx - 1); doc.data.active = sheetIdx;
        render(); emit(); return;
      }
      if (name.indexOf('export:') === 0) {
        const f = name.slice(7);
        if (f === 'csv') return exportCsv();
        if (f === 'xlsx') { FW.downloadBytes((doc.title || '表格') + '.xlsx', global.OFFICE.buildXlsx(doc), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'); FW.toast('已导出 Excel 文件'); return; }
        if (f === 'html') {
          FW.downloadText((doc.title || '表格') + '.html',
            '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><title>' + FW.escapeHtml(doc.title) + '</title></head><body style="background:#F2F3F5;padding:24px;font-family:微软雅黑">' +
            '<h2 style="font-family:微软雅黑">' + FW.escapeHtml(doc.title) + '</h2>' + global.OFFICE.sheetToHtml(sheet(), doc.title) + '</body></html>', 'text/html');
          FW.toast('已导出网页'); return;
        }
      }
      if (name === 'print') { global.print(); return; }
    },

    undo() {
      if (!undoStack.length) { FW.toast('没有可撤销的操作'); return; }
      redoStack.push(currentSnap());
      applySnap(undoStack.pop());
      FW.toast('已撤销');
    },
    redo() {
      if (!redoStack.length) { FW.toast('没有可重做的操作'); return; }
      undoStack.push(currentSnap());
      applySnap(redoStack.pop());
      FW.toast('已重做');
    },

    status() {
      const b = selBounds();
      let sum = 0, cnt = 0, numCnt = 0;
      for (let r = b.r1; r <= b.r2; r++) for (let c = b.c1; c <= b.c2; c++) {
        const cv = computed.cache[r + ',' + c];
        if (cv && cv.v !== '' && cv.v != null) cnt++;
        if (cv && typeof cv.v === 'number') { sum += cv.v; numCnt++; }
      }
      return '<span>单元格：' + colName(sel.c) + (sel.r + 1) + '</span>' +
        '<span>计数：' + cnt + '</span><span>数值：' + numCnt + '</span>' +
        '<span>求和：' + (Math.round(sum * 10000) / 10000) + '</span>' +
        '<span>平均：' + (numCnt ? Math.round(sum / numCnt * 10000) / 10000 : '—') + '</span>' +
        '<span class="sp"></span><span>工作表：' + sheet().name + '（共 ' + doc.data.sheets.length + ' 个）</span>';
    },

    exports: [
      { id: 'xlsx', icon: 'X', title: 'Excel 工作簿 (.xlsx)', desc: '生成真实 Office 表格，保留公式与样式', ext: 'xlsx' },
      { id: 'csv', icon: ',', title: '逗号分隔文本 (.csv)', desc: '纯数据，Excel 与数据库均可读取', ext: 'csv' },
      { id: 'html', icon: '<>', title: '网页 (.html)', desc: '带样式的表格，浏览器直接打开', ext: 'html' },
      { id: 'pdf', icon: 'P', title: '打印 / 另存为 PDF', desc: '调用系统打印输出 PDF', ext: 'pdf' },
      { id: 'json', icon: '{}', title: 'ForFree 工程文件 (.json)', desc: '无损保存，可再次导入继续编辑', ext: 'json' }
    ]
  };
})(window);
