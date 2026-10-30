@echo off
setlocal
title AILS Electron Live Dev Environment

set "ROOT_DIR=%~dp0..\..\"
set "FRONTEND_DIR=%ROOT_DIR%ails-frontend"
set "AILS_EDITION=developer"
set "AILS_OCR_RUNTIME_ROOT=%ROOT_DIR%build\dev_ocr_runtimes"
set "VITE_SCRIPT=%FRONTEND_DIR%\node_modules\vite\bin\vite.js"
set "ELECTRON_EXE=%FRONTEND_DIR%\node_modules\electron\dist\electron.exe"

echo ===================================================
echo   Starting AILS Electron Live Development Environment
echo ===================================================
echo.

if not exist "%VITE_SCRIPT%" goto :install_frontend_dependencies
if not exist "%ELECTRON_EXE%" goto :install_frontend_dependencies
goto :frontend_dependencies_ready

:install_frontend_dependencies
where npm.cmd > nul 2>&1
if errorlevel 1 (
    echo.
    echo Frontend dependencies are missing or incomplete, and npm was not found.
    echo Install Node.js 22 LTS from https://nodejs.org/ and run this file again.
    echo Required files:
    echo   %VITE_SCRIPT%
    echo   %ELECTRON_EXE%
    echo.
    pause
    exit /b 1
)

    echo Installing frontend Electron dependencies...
    pushd "%FRONTEND_DIR%"
    call npm install
    if errorlevel 1 (
        popd
        pause
        exit /b 1
    )
    popd

if not exist "%VITE_SCRIPT%" (
    echo Vite is still missing after npm install:
    echo   %VITE_SCRIPT%
    pause
    exit /b 1
)
if not exist "%ELECTRON_EXE%" (
    echo Electron is still incomplete after npm install:
    echo   %ELECTRON_EXE%
    echo Try running npm rebuild electron in the ails-frontend folder.
    pause
    exit /b 1
)

:frontend_dependencies_ready
set "NODE_EXE="
set "NODE_IS_ELECTRON=0"
for /f "delims=" %%N in ('where node.exe 2^>nul') do if not defined NODE_EXE set "NODE_EXE=%%N"
if defined NODE_EXE goto :node_runtime_ready

set "NODE_EXE=%ELECTRON_EXE%"
set "NODE_IS_ELECTRON=1"
echo System Node.js was not found. Using Electron's bundled Node.js for Vite.

:node_runtime_ready

if "%NODE_IS_ELECTRON%"=="1" set "ELECTRON_RUN_AS_NODE=1"
"%NODE_EXE%" "%~dp0dev-launcher.cjs" %*
exit /b %ERRORLEVEL%
