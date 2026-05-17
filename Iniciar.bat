@echo off
title Minecraft Bot Manager
color 0A

echo ========================================
echo    MINECRAFT BOT MANAGER
echo ========================================
echo.
echo Iniciando servidor...
echo.

cd /d "C:\Users\Minero\OneDrive\Área de Trabalho\Minecraft"

echo Pasta atual: %cd%
echo.
echo Instalando dependencias (se necessario)...
call npm install express socket.io mineflayer

echo 🌐 Abrindo navegador em http://localhost:3000
start http://localhost:3000

echo.
echo Iniciando o servidor...
echo.
node server.js

pause