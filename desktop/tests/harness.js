'use strict';
/* ============================================================
   测试用运行环境
   ------------------------------------------------------------
   用 jsdom 加载**真实的 index.html**，再按其中 <script> 的顺序
   把 assets/*.js 逐个 eval 进去 —— 这样测到的是真实的加载顺序与
   真实 DOM 结构，而不是手搓的桩。任何模块初始化时的报错都会在这里暴露。

   注意：jsdom 没有 canvas 实现，涉及像素/绘图的功能（PDF 渲染、
   图片工具箱、缩略图）不在单元测试覆盖范围内，由 --self-test 兜底。
   ============================================================ */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '../..');
const HTML_PATH = path.join(ROOT, 'index.html');

let cached = null;

/* 启动一个全新的应用实例（每次调用都隔离，localStorage 也是新的） */
function boot(opts) {
  opts = opts || {};
  const html = fs.readFileSync(HTML_PATH, 'utf8');
  const dom = new JSDOM(html, {
    url: 'http://localhost/',
    runScripts: 'outside-only',   // 允许 window.eval，但不自动执行 HTML 里的 <script>
    pretendToBeVisual: true
  });
  const { window } = dom;

  // ---- 补齐 jsdom 没实现的浏览器 API（只补最小可用版本）----
  if (!window.matchMedia) {
    window.matchMedia = () => ({
      matches: false, media: '',
      addListener() {}, removeListener() {},
      addEventListener() {}, removeEventListener() {}
    });
  }
  if (!window.requestAnimationFrame) {
    window.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0);
    window.cancelAnimationFrame = (id) => clearTimeout(id);
  }
  if (!window.URL.createObjectURL) {
    window.URL.createObjectURL = () => 'blob:mock';
    window.URL.revokeObjectURL = () => {};
  }
  // jsdom 的 canvas 没有 2d 上下文；给一个空壳，避免调用方直接崩，
  // 真正的绘制路径本来就不在单元测试里
  if (window.HTMLCanvasElement) {
    window.HTMLCanvasElement.prototype.getContext = function () {
      return {
        canvas: this,
        fillRect() {}, clearRect() {}, strokeRect() {},
        beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, fill() {},
        arc() {}, closePath() {}, save() {}, restore() {}, translate() {}, rotate() {}, scale() {},
        setTransform() {}, drawImage() {}, fillText() {}, strokeText() {},
        measureText: (t) => ({ width: String(t).length * 6 }),
        createLinearGradient: () => ({ addColorStop() {} }),
        getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(Math.max(1, w * h * 4)), width: w, height: h }),
        putImageData() {}
      };
    };
    window.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/png;base64,';
  }

  // ---- 按 index.html 里出现的顺序加载脚本 ----
  const srcs = [];
  const re = /<script\s+src="([^"]+)"\s*><\/script>/g;
  let m;
  while ((m = re.exec(html))) srcs.push(m[1]);
  if (!srcs.length) throw new Error('index.html 里没找到 <script src>');

  for (const src of srcs) {
    const p = path.join(ROOT, src);
    if (!fs.existsSync(p)) throw new Error('index.html 引用了不存在的脚本：' + src);
    try {
      window.eval(fs.readFileSync(p, 'utf8'));
    } catch (e) {
      throw new Error('加载 ' + src + ' 失败：' + (e && e.message));
    }
  }

  const app = { dom, window, FW: window.FW };
  if (opts.keep) cached = app;   // 复用同一个实例（省时间）
  return app;
}

/* 大多数测试用同一个实例就够了 —— 重新 boot 要 eval 十几万行脚本，慢 */
function get() {
  if (!cached) boot({ keep: true });
  return cached;
}

/* 清空本地存储，让每个测试从干净状态开始 */
function resetStorage(app) {
  const w = (app || get()).window;
  w.localStorage.clear();
  const S = w.FW.Store;
  if (S) S._cache = null;
}

module.exports = { boot, get, resetStorage, ROOT };
