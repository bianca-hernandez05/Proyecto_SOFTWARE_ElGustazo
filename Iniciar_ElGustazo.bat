@echo off
title El Gustazo - Sistema POS y Gestion Offline
color 0A

:: Establecer directorio de trabajo en la carpeta del script
cd /d "%~dp0"

:: Compatibilidad total con Windows 8 y Windows 7 para Node.js
set NODE_SKIP_PLATFORM_CHECK=1

echo ==========================================================
echo        EL GUSTAZO - SISTEMA POS Y GESTION (OFFLINE)
echo       Sierra Maestra, Managua - Sistema de Ventas
echo ==========================================================
echo.
echo [*] Verificando entorno de ejecucion...

:: Comprobar si Node.js esta en el PATH o en rutas comunes
set "NODE_CMD=node"
where node >nul 2>&1
if %ERRORLEVEL% neq 0 (
    if exist "%ProgramFiles%\nodejs\node.exe" (
        set "NODE_CMD=%ProgramFiles%\nodejs\node.exe"
    ) else if exist "%ProgramFiles(x86)%\nodejs\node.exe" (
        set "NODE_CMD=%ProgramFiles(x86)%\nodejs\node.exe"
    ) else (
        echo [ERROR] No se encontro Node.js instalado en este equipo.
        echo Por favor instale Node.js (recomendado v16.20.2 para Windows 8).
        echo Revise el archivo GUIA_INSTALACION_WINDOWS8.md para mas detalles.
        echo.
        pause
        exit /b 1
    )
)

echo [*] Node.js detectado correctamente.
echo [*] Inicializando base de datos local y servidor POS...
echo.

:: Iniciar el servidor Node en segundo plano y abrir navegador
start "" "%NODE_CMD%" src/server.js

:: Esperar 2 segundos para asegurar inicio del servidor
timeout /t 2 /nobreak >nul 2>&1

echo [*] Abriendo sistema en su navegador web predeterminado...
start http://localhost:3000

echo.
echo ==========================================================
echo  SISTEMA ACTIVO Y FUNCIONANDO EN: http://localhost:3000
echo  Modo: 100%% OFFLINE (Sin conexion a Internet requerida)
echo.
echo  Para cerrar el sistema, cierre esta ventana o ejecute
echo  el archivo "Detener_ElGustazo.bat".
echo ==========================================================
echo.
pause
