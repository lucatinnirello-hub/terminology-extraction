@echo off
REM Starts the stage 2 server and the tunnel n8n reaches it through.
REM Double-click to run. Close both windows to stop.
cd /d "%~dp0"
start "Stage 2 server" python stage2_server.py
cloudflared tunnel --url http://localhost:8765
