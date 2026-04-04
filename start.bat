@echo off
REM ─── Grove Startup Script (Windows) ───

REM Storage location (default: %USERPROFILE%\.grove)
REM set GROVE_HOME=%USERPROFILE%\.grove

REM Server binding
set GROVE_HOST=127.0.0.1
set GROVE_PORT=5000

REM Semantic search (requires: pip install fastembed numpy)
REM set GROVE_SEMANTIC_SEARCH=true

REM LLM Assist (disabled by default)
REM set GROVE_LLM_ENABLED=true
REM set GROVE_LLM_PROVIDER=openai
REM set GROVE_LLM_ENDPOINT=https://api.openai.com
REM set GROVE_LLM_MODEL=gpt-4o
REM set GROVE_LLM_API_KEY=sk-...
REM set GROVE_LLM_MODELS=gpt-4o,gpt-4o-mini
REM set GROVE_LLM_MAX_TOKENS=800
REM set GROVE_LLM_TEMPERATURE=0.3

echo Starting Grove on http://%GROVE_HOST%:%GROVE_PORT%
python app.py
pause
