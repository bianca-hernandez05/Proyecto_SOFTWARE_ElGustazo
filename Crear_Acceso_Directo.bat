@echo off
chcp 65001 >nul
title El Gustazo - Crear Acceso Directo Oficial
color 0A
cd /d "%~dp0"

echo ==========================================================
echo        EL GUSTAZO - CREAR ACCESO DIRECTO OFICIAL
echo ==========================================================
echo.
echo [*] Configurando acceso directo institucional en el Escritorio...
echo.

powershell -NoProfile -ExecutionPolicy Bypass -Command "$ws = New-Object -ComObject WScript.Shell; $appDir = '%~dp0'.TrimEnd('\'); $target = Join-Path $appDir 'ElGustazo.exe'; $icon = Join-Path $appDir 'src\public\favicon.ico'; $desktop = [Environment]::GetFolderPath('Desktop'); if (-not (Test-Path $desktop)) { if (Test-Path 'C:\Users\Gallo\OneDrive\Escritorio') { $desktop = 'C:\Users\Gallo\OneDrive\Escritorio' } }; $s = $ws.CreateShortcut((Join-Path $desktop 'El Gustazo.lnk')); $s.TargetPath = $target; $s.WorkingDirectory = $appDir; if (Test-Path $icon) { $s.IconLocation = $icon + ',0' }; $s.WindowStyle = 1; $s.Description = 'El Gustazo - Sistema Hibrido POS, Inventario y Delivery'; $s.Save();"

if %ERRORLEVEL% equ 0 (
    echo [OK] Acceso directo 'El Gustazo' creado exitosamente en el Escritorio.
    echo [*] Vinculado a: ElGustazo.exe
) else (
    echo [!] Se presento una advertencia al generar el acceso directo.
)

echo.
echo ==========================================================
timeout /t 3 >nul 2>&1
exit
