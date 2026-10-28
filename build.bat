@echo off
title QoderMod Build
setlocal
cd /d "%~dp0"
if not exist bin mkdir bin

set "CSC=%WINDIR%\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
set "GPP=D:\Dev-Cpp\mingw64\bin\g++.exe"

if not exist "%GPP%" (
  echo [FAIL] 找不到 D:\Dev-Cpp\mingw64\bin\g++.exe，请修改 build.bat 中的 GPP 路径
  goto :fail
)

for %%i in ("%GPP%") do set "GPPDIR=%%~dpi"
set "PATH=%GPPDIR%;%WINDIR%\System32;%WINDIR%"
if exist "C:\Program Files\Git\mingw64\bin" set "PATH=%PATH%;C:\Program Files\Git\mingw64\bin"

set "BRIDGE_OUT=bin\bridge_%RANDOM%%RANDOM%.dll"

echo [0/3] 编译器: %GPP%
"%GPP%" -dumpmachine
if errorlevel 1 goto :fail

echo [1/3] 编译 %BRIDGE_OUT% ...
"%GPP%" -std=c++11 -O2 -shared -static -static-libgcc -static-libstdc++ -o "%BRIDGE_OUT%" src\Bridge\bridge.cpp -lws2_32
if errorlevel 1 goto :fail

echo [2/3] 复制 hook.js / ui.js / 图标 ...
copy /y src\Payload\hook.js bin\hook.js >/dev/null
copy /y src\Payload\ui.js bin\ui.js >/dev/null
copy /y src\Assets\qmod.ico bin\qmod.ico >/dev/null
if errorlevel 1 goto :fail

echo [3/3] 编译启动器（控制台） ...
move /y bin\QoderModLauncher.exe bin\QoderModLauncher.exe.old >/dev/null 2>/dev/null
"%CSC%" /nologo /target:exe /optimize+ /win32icon:"src\Assets\qmod.ico" /out:bin\QoderModLauncher.exe /r:System.Management.dll src\Launcher\Launcher.cs
if errorlevel 1 (
  echo.
  echo [HINT] 若为 CS0016 文件被占用，请完全关闭 bin\QoderModLauncher.exe 后重试
  goto :fail
)
del /q bin\QoderModLauncher.exe.old >/dev/null 2>/dev/null

echo.
echo [OK] 构建完成: %BRIDGE_OUT%
echo.
pause
exit /b 0

:fail
echo.
echo [FAIL] 构建失败，请查看上方错误信息
echo.
pause
exit /b 1
