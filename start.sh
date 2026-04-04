#!/usr/bin/env bash
# ─── Grove Startup Script (Linux/Mac) ───

# Storage location (default: ~/.grove)
# export GROVE_HOME="$HOME/.grove"

# Server binding
export GROVE_HOST=127.0.0.1
export GROVE_PORT=5000

# Semantic search (requires: pip install fastembed numpy)
# export GROVE_SEMANTIC_SEARCH=true

# LLM Assist (disabled by default)
# export GROVE_LLM_ENABLED=true
# export GROVE_LLM_PROVIDER=openai
# export GROVE_LLM_ENDPOINT=https://api.openai.com
# export GROVE_LLM_MODEL=gpt-4o
# export GROVE_LLM_API_KEY=sk-...
# export GROVE_LLM_MODELS=gpt-4o,gpt-4o-mini
# export GROVE_LLM_MAX_TOKENS=800
# export GROVE_LLM_TEMPERATURE=0.3

echo "Starting Grove on http://$GROVE_HOST:$GROVE_PORT"
python app.py
