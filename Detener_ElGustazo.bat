@echo off
title El Gustazo - Detener Sistema
color 0C

echo ==========================================================
echo           EL GUSTAZO - DETENER SISTEMA POS
echo ==========================================================
echo.
echo [*] Deteniendo procesos de Node.js en ejecucion...

taskkill /F /IM node.exe >nul 2>&1

if %ERRORLEVEL% equ 0 (
    echo [*] El sistema El Gustazo se ha detenido correctamente.
) else (
    echo [*] No se encontro ningun proceso de El Gustazo en ejecucion.
)

echo.
echo ==========================================================
timeout /t 3 >nul 2>&1
exit
