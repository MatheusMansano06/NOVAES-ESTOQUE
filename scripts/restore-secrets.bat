@echo off
REM Clique duplo no OUTRO PC para restaurar os segredos (.env + token Olist)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0restore-secrets.ps1"
