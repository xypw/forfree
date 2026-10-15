/* ============================================================
   sync-web.js —— 把网页版资源同步到 desktop/web/
   保证桌面版和网页版用的是同一份代码，不产生分叉。
   ============================================================ */
'use strict';

const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..');
const DEST = path.join(__dirname, 'web');

const ITEMS = [
  ['index.html', 'file'],
  ['README.md', 'file'],
  ['THIRD-PARTY-NOTICES.md', 'file'],
  ['assets', 'dir'],
  ['samples', 'dir']
];

function rmrf(p) {
  if (!fs.existsSync(p)) return;
  for (const name of fs.readdirSync(p)) {
    const full = path.join(p, name);
    if (fs.statSync(full).isDirectory()) rmrf(full);
    else fs.unlinkSync(full);
  }
  fs.rmdirSync(p);
}

// 手写递归复制（不用 fs.cpSync，避免部分环境下不可用）
function copyTree(src, dest) {
  const st = fs.statSync(src);
  if (st.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const name of fs.readdirSync(src)) {
      copyTree(path.join(src, name), path.join(dest, name));
    }
  } else {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, fs.readFileSync(src));
  }
}

function walk(dir, base, out) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const rel = path.relative(base, full).replace(/\\/g, '/');
    const st = fs.statSync(full);
    if (st.isDirectory()) walk(full, base, out);
    else out.push({ rel: rel, size: st.size });
  }
  return out;
}

console.log('ForFree · 同步网页资源');
console.log('  源目录：' + SRC);
console.log('  目标：  ' + DEST);

rmrf(DEST);
fs.mkdirSync(DEST, { recursive: true });

let copied = 0;
for (const [name, kind] of ITEMS) {
  const src = path.join(SRC, name);
  if (!fs.existsSync(src)) {
    console.warn('  ! 跳过（不存在）：' + name);
    continue;
  }
  copyTree(src, path.join(DEST, name));
  copied++;
  console.log('  ✓ ' + name);
}

const files = walk(DEST, DEST, []);
const total = files.reduce((s, f) => s + f.size, 0);
console.log('  共 ' + files.length + ' 个文件，' + (total / 1048576).toFixed(2) + ' MB');
console.log('完成。');
