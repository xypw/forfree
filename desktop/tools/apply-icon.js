/* ============================================================
   apply-icon.js —— 给「解包后的 app exe」补图标与版本信息

   为什么需要这一步：
   win.signAndEditExecutable 被设为 false（绕开 winCodeSign 解压需要
   管理员权限的问题），所以 electron-builder 不会自己调 rcedit。
   这里在 --dir 之后、--prepackaged 之前手工补上。

   注意：只能对普通 PE 文件（dist/win-unpacked/ForFree.exe）操作。
   NSIS 打包出来的自解压 exe 不能碰 —— rcedit 会重写 PE 结构，
   把追加在后面的压缩数据截掉，文件会从 68MB 变成几十 KB。
   ============================================================ */
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const ICON = path.join(ROOT, 'build', 'icon.ico');
const PKG = require(path.join(ROOT, 'package.json'));

function findRcedit() {
  const local = path.join(__dirname, 'rcedit-x64.exe');
  if (fs.existsSync(local)) return local;
  const cache = path.join(process.env.LOCALAPPDATA || '', 'electron-builder', 'Cache', 'winCodeSign');
  if (fs.existsSync(cache)) {
    for (const d of fs.readdirSync(cache)) {
      const p = path.join(cache, d, 'rcedit-x64.exe');
      if (fs.existsSync(p)) return p;
    }
  }
  return null;
}

function resolveTarget() {
  const arg = process.argv[2];
  if (arg) return path.resolve(arg);
  const guess = path.join(ROOT, 'dist', 'win-unpacked', PKG.build.productName + '.exe');
  if (fs.existsSync(guess)) return guess;
  // 兜底：在 dist/win-unpacked 下找第一个 exe
  const dir = path.join(ROOT, 'dist', 'win-unpacked');
  if (fs.existsSync(dir)) {
    const exe = fs.readdirSync(dir).find((f) => f.toLowerCase().endsWith('.exe'));
    if (exe) return path.join(dir, exe);
  }
  return null;
}

function main() {
  const target = resolveTarget();
  if (!target || !fs.existsSync(target)) {
    console.error('找不到目标 exe。用法：node tools/apply-icon.js [exe路径]');
    process.exit(1);
  }
  if (/[\\/]dist[\\/][^\\/]+\.exe$/i.test(target)) {
    console.error('拒绝操作：' + target);
    console.error('这是 NSIS 自解压包，rcedit 会把它写坏。请对 dist/win-unpacked/ 下的 app exe 操作。');
    process.exit(1);
  }
  if (!fs.existsSync(ICON)) {
    console.error('找不到 build/icon.ico，请先执行 npm run icon。');
    process.exit(1);
  }
  const rcedit = findRcedit();
  if (!rcedit) {
    console.error('找不到 rcedit-x64.exe。');
    process.exit(1);
  }

  const before = fs.statSync(target).size;
  console.log('目标：' + target);
  const args = [
    target,
    '--set-icon', ICON,
    '--set-version-string', 'ProductName', 'ForFree 办公套件',
    '--set-version-string', 'FileDescription', 'ForFree 办公套件',
    '--set-version-string', 'CompanyName', 'ForFree',
    '--set-version-string', 'LegalCopyright', 'ForFree · 免费使用',
    '--set-version-string', 'OriginalFilename', path.basename(target),
    '--set-file-version', PKG.version + '.0',
    '--set-product-version', PKG.version + '.0'
  ];
  execFileSync(rcedit, args, { stdio: 'inherit' });

  const after = fs.statSync(target).size;
  if (after < before * 0.9) {
    console.error('  ! 文件体积异常缩小（' + before + ' → ' + after + '），可能已被写坏。');
    process.exit(1);
  }
  console.log('  ✓ 已写入图标与版本信息（' + (before / 1048576).toFixed(1) + ' MB）');
  console.log('完成。');
}

main();
