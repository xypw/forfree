@echo off
chcp 65001 >nul
setlocal

echo ============================================
echo   ForFree 桌面版 · 一键打包
echo ============================================
echo.

cd /d "%~dp0"

REM 国内镜像加速 Electron 与打包工具下载
set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
set ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/
REM 本机若设置了 ELECTRON_RUN_AS_NODE，Electron 会退化成纯 Node，必须清掉
set ELECTRON_RUN_AS_NODE=

if not exist "node_modules" (
  echo [1/5] 首次运行，正在安装依赖（约 200MB，请耐心等待）...
  call npm install
  if errorlevel 1 goto :fail
) else (
  echo [1/5] 依赖已存在，跳过安装
)

echo.
echo [2/5] 生成应用图标...
where python >nul 2>nul
if errorlevel 1 (
  if exist "build\icon.ico" (
    echo       未检测到 Python，使用已有图标
  ) else (
    echo       ! 未检测到 Python 且没有现成图标，将使用默认图标
  )
) else (
  python tools\make-icon.py
)

echo.
echo [3/5] 同步网页资源...
call npm run sync
if errorlevel 1 goto :fail

echo.
echo [4/5] 打包到解包目录并写入图标与版本信息...
call npm run dist:dir
if errorlevel 1 goto :fail
node tools\apply-icon.js
if errorlevel 1 goto :fail

echo.
echo [5/5] 生成免安装单文件 exe...
call npm run dist:portable
if errorlevel 1 goto :fail

echo.
echo ============================================
echo   打包完成！产物在 desktop\dist\ 目录下
echo ============================================
dir /b dist\*.exe
echo.
echo 这个 exe 可以直接拷给别人，双击即用，无需安装。
echo.
pause
exit /b 0

:fail
echo.
echo *** 打包失败，请检查上方错误信息 ***
pause
exit /b 1
