@echo off
chcp 65001 >nul
title El Gustazo - Detener Sistema POS
color 0C

echo ==========================================================
echo           EL GUSTAZO - DETENER SISTEMA POS
echo ==========================================================
echo.
echo [*] Deteniendo servidor local de El Gustazo (Puerto 3000)...

:: 1. Detener el proceso que escucha en el puerto 3000
set "FOUND_PROC=0"
for /f "tokens=5" %%a in ('netstat -aon ^| findstr /R /C:":3000 .*LISTENING"') do (
    taskkill /F /PID %%a >nul 2>&1
    set "FOUND_PROC=1"
)

if "%FOUND_PROC%"=="1" (
    echo [OK] El servidor de El Gustazo en el puerto 3000 se ha detenido correctamente.
) else (
    echo [*] El servidor no se encontraba en ejecucion.
)

echo.
echo ==========================================================
timeout /t 2 >nul 2>&1
exit
