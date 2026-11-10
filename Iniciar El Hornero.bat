@echo off
cd /d "%~dp0"
py -3 -c "import http.server,threading,webbrowser; s=http.server.ThreadingHTTPServer(('127.0.0.1',8000),http.server.SimpleHTTPRequestHandler); threading.Timer(1,webbrowser.open,args=('http://127.0.0.1:8000/',)).start(); s.serve_forever()"
pause