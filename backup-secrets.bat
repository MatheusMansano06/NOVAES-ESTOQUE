@echo off
REM Clique duplo para gerar o backup dos segredos (.env + token Olist)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0backup-secrets.ps1"
