@echo off
cd /d "%~dp0"
echo === Deploying Uddy: Eight Seconds to Vercel (Production) ===
call npx vercel --prod
if %ERRORLEVEL% NEQ 0 (
  echo.
  echo If you have not logged into Vercel yet, run: npx vercel login
  pause
  exit /b %ERRORLEVEL%
)
echo.
echo Deployment finished!
pause
