@echo off
setlocal EnableExtensions DisableDelayedExpansion
title AILS Phoenix Observability Server

set "PHOENIX_HOST=127.0.0.1"
set "PHOENIX_PORT=6006"

echo ===================================================
echo   AILS Phoenix Observability Server
echo ===================================================
echo.

where uvx.exe > nul 2>&1
if errorlevel 1 goto :missing_uvx

echo Phoenix UI: http://%PHOENIX_HOST%:%PHOENIX_PORT%
echo Stop the server with Ctrl+C.
echo.
uvx arize-phoenix serve --host "%PHOENIX_HOST%" --port "%PHOENIX_PORT%"
set "PHOENIX_EXIT_CODE=%ERRORLEVEL%"

echo.
echo Phoenix server stopped with exit code %PHOENIX_EXIT_CODE%.
pause
exit /b %PHOENIX_EXIT_CODE%

:missing_uvx
echo uvx was not found on PATH.
echo Install uv from https://docs.astral.sh/uv/getting-started/installation/
echo Then run this file again.
pause
exit /b 1
