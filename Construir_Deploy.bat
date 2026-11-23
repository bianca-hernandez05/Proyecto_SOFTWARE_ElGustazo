@echo off
chcp 65001 >nul
title El Gustazo - Generador de Paquete de Despliegue
color 0B
cd /d "%~dp0"

echo =====================================================================
echo    EL GUSTAZO - GENERADOR DE PAQUETE DE INSTALACION Y DESPLIEGUE
echo =====================================================================
echo.
echo Este proceso:
echo 1. Empaqueta la version actualizada del sistema Hibrido (Offline + WhatsApp).
echo 2. Ofusca y protege todo el codigo fuente (server.js y modulos frontend).
echo 3. Incluye la base de datos oficial DB_ElGustazo.db y respaldos diarios.
echo 4. Integra la suite forense de ciberseguridad en Python.
echo 5. Genera la carpeta ElGustazo_Deploy y el archivo ZIP en el Escritorio.
echo.

node scripts\build_deploy.js

echo.
pause
