@echo off
REM Shell wrapper for native messaging host (Windows).
REM Chrome/Brave spawns this script; it runs the Bun native host.
set "DIR=%~dp0.."

REM Prefer the built artifact (published tarball ships dist\), fall back to source (dev).
set "HOST=%DIR%\dist\native-host.js"
if not exist "%HOST%" set "HOST=%DIR%\src\native-host.ts"

where bun >nul 2>nul
if %ERRORLEVEL% equ 0 (
    bun run "%HOST%" %*
) else (
    REM Fallback: try common install locations
    if exist "%USERPROFILE%\.bun\bin\bun.exe" (
        "%USERPROFILE%\.bun\bin\bun.exe" run "%HOST%" %*
    ) else (
        echo ERROR: bun not found. Install from https://bun.sh 1>&2
        exit /b 1
    )
)
