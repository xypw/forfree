# 第三方组件与许可证声明

ForFree 自身代码为原创。项目内嵌的第三方开源组件分两类：

| 组件 | 许可证 | 出现在 | 是否 copyleft |
| --- | --- | --- | --- |
| fflate / pdf.js / pdf-lib / rcedit | MIT、Apache-2.0 | 网页版 + 桌面版 | 否 |
| **mupdf（MuPDF）** | **AGPL-3.0-or-later** | **仅桌面版** | **是** |

**⚠️ 关键结论（务必先读）**：
MuPDF 是 **AGPL-3.0**（强 copyleft）。桌面版把它打包进 exe 分发，
意味着**整个桌面版发行物必须以 AGPL-3.0 发布**。因此本项目的许可是**分层的**：

- **网页版**（`index.html` + `assets/`，不含 `desktop/`）：**MIT**
- **桌面版**（`desktop/`，因内置 MuPDF）：**AGPL-3.0-or-later**

桌面版源码本就公开在本仓库，因此 AGPL 的源码提供义务（第 6 条 / 第 13 条）
已由本仓库满足；但**任何人分发桌面版的修改版，也必须以 AGPL-3.0 开源**。

如果你想要闭源或商业分发桌面版，需要自行向 Artifex 购买 MuPDF 商业授权
（https://mupdf.com/licensing），或改用不含 MuPDF 的构建（即放弃
「编辑文字 / 真删 PDF 原文」功能）。

各库的**许可证全文**已随仓库放在 [`licenses/`](licenses/) 目录，
分发本软件时请一并保留该目录。

---

## 1. fflate

- 用途：ZIP 压缩与解压（读写 .docx / .xlsx / .pptx 的底层）
- 文件：`assets/vendor/fflate.min.js`
- 版本：0.8.x
- 许可证：**MIT**
- 版权：Copyright (c) 2023 Arjun Barrett
- 项目主页：https://github.com/101arrowz/fflate
- 许可证全文：[`licenses/fflate-MIT.txt`](licenses/fflate-MIT.txt)

> 说明：min 版文件头未保留许可证注释（构建时被压缩掉了），
> 许可证信息取自其 npm 包元数据；全文已随仓库分发。

## 2. pdf.js（PDF.js / pdfjs-dist）

- 用途：PDF 渲染与文本提取
- 文件：`assets/vendor/pdf.min.js`、`assets/vendor/pdf.worker.min.js`
- 版本：3.11.174
- 许可证：**Apache License 2.0**
- 版权：Copyright 2012 Mozilla Foundation
- 项目主页：https://github.com/mozilla/pdf.js
- 许可证全文：[`licenses/pdfjs-Apache-2.0.txt`](licenses/pdfjs-Apache-2.0.txt)

> 已在文件头保留 Apache-2.0 许可证声明（"Licensed under the Apache License,
> Version 2.0 …"）；全文已随仓库分发。

## 3. pdf-lib

- 用途：PDF 写入（合并、拆分、贴批注、图片转 PDF、压缩、表单读写）
- 文件：`assets/vendor/pdf-lib.min.js`
- 许可证：**MIT**
- 版权：Copyright (c) 2019 Andrew Dillon
- 项目主页：https://github.com/Hopding/pdf-lib
- 许可证全文：[`licenses/pdf-lib-MIT.txt`](licenses/pdf-lib-MIT.txt)

> 该文件内出现的 Apache-2.0 声明来自其打包依赖 **tslib**
> （Copyright (c) Microsoft Corporation，Apache-2.0），并非 pdf-lib 本体。

## 4. MuPDF / mupdf.js ⚠️ AGPL

- 用途：**仅桌面版**。PDF 内容的**真正删除**（Redact 注释 + `applyRedactions()`），
  支撑「编辑文字」里"抹掉 PDF 原有内容"这一步
- 文件：`desktop/node_modules/mupdf/`（npm 包 `mupdf`，打包时进入 `app.asar`）
- 版本：1.28.1（MuPDF 官方 WASM 构建，ESM-only）
- 许可证：**AGPL-3.0-or-later**（或 Artifex 商业授权）
- 版权：Copyright (C) 2004-2024 Artifex Software, Inc.
- 项目主页：https://github.com/ArtifexSoftware/mupdf.js
- 许可证全文：[`licenses/AGPL-3.0.txt`](licenses/AGPL-3.0.txt)、[`desktop/LICENSE`](desktop/LICENSE)

> **为什么必须用它**：网页端（pdf.js / pdf-lib）只能"在内容之上画东西"（批注），
> 无法删除 PDF 已有的内容。只有 MuPDF 的 redaction 能真正把原文从内容流里移除。
> 因此桌面版的「编辑文字」功能与 MuPDF 绑定；不接受 AGPL 时只能去掉该功能。

## 5. rcedit（仅打包时使用）

- 用途：给 Windows 可执行文件写入图标与版本信息
- 文件：`desktop/tools/rcedit-x64.exe`
- 许可证：**MIT**
- 版权：Copyright (c) 2013 GitHub Inc.
- 项目主页：https://github.com/electron/rcedit

> 仅在构建桌面版时调用，不进入最终产物、不影响运行时。

## 6. Electron / Chromium / Node.js（仅桌面版）

- 用途：桌面客户端运行时
- 许可证：**MIT**（Electron）、**BSD-3-Clause 等**（Chromium）、**MIT**（Node.js）
- 桌面版打包时，`LICENSE.electron.txt` 与 `LICENSES.chromium.html`
  已由 electron-builder 自动随包分发，请勿删除。

---

## 分发时的义务

1. **保留上述版权声明与许可证全文**（本文件 + `licenses/` 目录即为此用途）。
2. 若修改了这些库的源码，需在文件中标明已修改（本项目未修改，均为原样内嵌）。
3. Apache-2.0 组件（pdf.js）若被再次分发，需附带其 `NOTICE` 文件（如有）。
4. **分发桌面版 = 分发 AGPL-3.0 作品**：必须一并提供**完整对应源码**
   （本仓库即是），且下游对桌面版的修改也必须以 AGPL-3.0 开源。
5. 所有组件均**不提供任何担保**，作者不承担使用后果。

> 只想闭源/商业分发**网页版**的话没有额外约束：网页版只用 MIT / Apache-2.0 组件，
> 不存在 copyleft 传染。
