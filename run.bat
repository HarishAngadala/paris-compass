@echo off
cd /d %~dp0
if exist build\classes rmdir /s /q build\classes
mkdir build\classes
for /r src\main\java %%f in (*.java) do echo %%f>>build\sources.txt
javac --release 21 -encoding UTF-8 -d build\classes @build\sources.txt
if errorlevel 1 exit /b 1
java -cp build\classes com.pariscompass.ParisCompassServer
