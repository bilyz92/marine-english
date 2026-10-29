@echo off
rem Bam dup de xem giao dien Marine English v1 tren trinh duyet. Dong cua so nay de dung.
cd /d "%~dp0"
where node >nul 2>nul || (echo Can cai Node.js tu https://nodejs.org roi chay lai. & pause & exit /b 1)
node serve.js --open
pause
