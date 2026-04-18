@echo off
REM Shell wrapper for native messaging host (Windows).
REM Chrome/Brave spawns this script; it runs the Bun native host.
set "DIR=%~dp0.."
where bun >nul 2>nul
if %ERRORLEVEL% equ 0 (
    bun run "%DIR%\src\native-host.ts" %*
) else (
    REM Fallback: try common install locations
    if exist "%USERPROFILE%\.bun\bin\bun.exe" (
        "%USERPROFILE%\.bun\bin\bun.exe" run "%DIR%\src\native-host.ts" %*
    ) else (
        echo ERROR: bun not found. Install from https://bun.sh 1>&2
        exit /b 1
    )
)
