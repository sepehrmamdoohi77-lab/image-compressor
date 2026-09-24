@echo off
REM ---------------------------------------------------------------------------
REM  build.bat - build BreachlineUE from the command line and write the compiler
REM  output to build-log.txt.
REM
REM  Usage (from anywhere):
REM      build.bat
REM      build.bat "C:\Program Files\Epic Games\UE_5.8"
REM
REM  The file build-log.txt next to this script is what to send when something
REM  fails: it contains the real compiler errors, which the editor's dialog and
REM  Visual Studio's Output window both hide.
REM ---------------------------------------------------------------------------
setlocal

set "UE_ROOT=%~1"
if "%UE_ROOT%"=="" set "UE_ROOT=C:\Program Files\Epic Games\UE_5.8"

set "HERE=%~dp0"
set "PROJECT=%HERE%BreachlineUE\BreachlineUE.uproject"
set "LOG=%HERE%build-log.txt"

if not exist "%UE_ROOT%\Engine\Build\BatchFiles\Build.bat" (
    echo.
    echo   Could not find the engine at:
    echo       %UE_ROOT%
    echo   Pass the install folder as the first argument, for example:
    echo       build.bat "D:\Epic\UE_5.8"
    echo.
    pause
    exit /b 2
)

if not exist "%PROJECT%" (
    echo   Could not find %PROJECT%
    echo   Run this script from the folder that contains the BreachlineUE folder.
    pause
    exit /b 2
)

echo.
echo   Engine : %UE_ROOT%
echo   Project: %PROJECT%
echo   Log    : %LOG%
echo.
echo   Building BreachlineUEEditor Win64 Development...
echo.

call "%UE_ROOT%\Engine\Build\BatchFiles\Build.bat" BreachlineUEEditor Win64 Development ^
     -Project="%PROJECT%" -WaitMutex -FromMsBuild > "%LOG%" 2>&1

set "RESULT=%ERRORLEVEL%"

echo. >> "%LOG%"
echo ======================== summary ======================== >> "%LOG%"
if "%RESULT%"=="0" (
    echo   BUILD SUCCEEDED >> "%LOG%"
    echo   BUILD SUCCEEDED
) else (
    echo   BUILD FAILED with code %RESULT% >> "%LOG%"
    echo   BUILD FAILED with code %RESULT%
)

echo. >> "%LOG%"
echo ------------------------ errors ------------------------- >> "%LOG%"
findstr /I /C:"error" /C:"Error" "%LOG%" >> "%LOG%.tmp"
type "%LOG%.tmp" >> "%LOG%"
del "%LOG%.tmp" >nul 2>&1

echo.
echo   Full output : %LOG%
echo   Send that file (or just the lines under "errors").
echo.
pause
endlocal
