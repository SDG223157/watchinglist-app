#!/bin/sh
# Start both Next.js and the Futures FastAPI backend in the same container.
# FastAPI runs on port 8888 (internal only), Next.js on port 3000 (exposed).

# Start futures API in background
python3 futures-api.py &

# Start Next.js (foreground — becomes PID 1 for Docker health checks)
exec node server.js
