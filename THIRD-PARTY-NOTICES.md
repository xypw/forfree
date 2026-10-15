# 第三方组件与许可证声明

ForFree 自身代码为原创。以下为项目内嵌的第三方开源组件，均为**宽松许可证**
（MIT / Apache-2.0），允许自由使用、修改、再分发（含商业用途），
条件是**保留版权声明与许可证全文**。

---

## 1. fflate

- 用途：ZIP 压缩与解压（读写 .docx / .xlsx / .pptx 的底层）
- 文件：`assets/vendor/fflate.min.js`
- 版本：0.8.x
- 许可证：**MIT**
- 版权：Copyright (c) 2023 Arjun Barrett
- 项目主页：https://github.com/101arrowz/fflate

> 说明：min 版文件头未保留许可证注释（构建时被压缩掉了），
> 许可证信息取自其 npm 包元数据。分发时请随附 MIT 全文。

## 2. pdf.js（PDF.js / pdfjs-dist）

- 用途：PDF 渲染与文本提取
- 文件：`assets/vendor/pdf.min.js`、`assets/vendor/pdf.worker.min.js`
- 许可证：**Apache License 2.0**
- 版权：Copyright 2012 Mozilla Foundation
- 项目主页：https://github.com/mozilla/pdf.js

> 已在文件头保留 Apache-2.0 许可证声明（"Licensed under the Apache License,
> Version 2.0 …"）。

## 3. pdf-lib

- 用途：PDF 写入（合并、拆分、贴批注、图片转 PDF、压缩、表单读写）
- 文件：`assets/vendor/pdf-lib.min.js`
- 许可证：**MIT**
- 版权：Copyright (c) 2019 Andrew Dillon
- 项目主页：https://github.com/Hopding/pdf-lib

> 该文件内出现的 Apache-2.0 声明来自其打包依赖 **tslib**
> （Copyright (c) Microsoft Corporation，Apache-2.0），并非 pdf-lib 本体。

## 4. rcedit（仅打包时使用）

- 用途：给 Windows 可执行文件写入图标与版本信息
- 文件：`desktop/tools/rcedit-x64.exe`
- 许可证：**MIT**
- 版权：Copyright (c) 2013 GitHub Inc.
- 项目主页：https://github.com/electron/rcedit

> 仅在构建桌面版时调用，不进入最终产物、不影响运行时。

## 5. Electron / Chromium / Node.js（仅桌面版）

- 用途：桌面客户端运行时
- 许可证：**MIT**（Electron）、**BSD-3-Clause 等**（Chromium）、**MIT**（Node.js）
- 桌面版打包时，`LICENSE.electron.txt` 与 `LICENSES.chromium.html`
> 已由 electron-builder 自动随包分发，请勿删除。

---

## 分发时的义务

1. **保留上述版权声明与许可证全文**（本文件即为此用途）。
2. 若修改了这些库的源码，需在文件中标明已修改。
3. Apache-2.0 组件（pdf.js）若被再次分发，需附带其 `NOTICE` 文件（如有）。
4. MIT / Apache-2.0 均**不提供任何担保**，作者不承担使用后果。

以上组件均**不要求**下游开源（非 copyleft），因此 ForFree 可以按你希望的方式
分发，包括闭源或商业分发。
