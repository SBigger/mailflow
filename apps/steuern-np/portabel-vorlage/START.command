#!/bin/bash
cd "$(dirname "$0")"
command -v node >/dev/null || { echo "Node.js fehlt — bitte von nodejs.org installieren."; read -r; exit 1; }
(sleep 1; open http://localhost:5180) &
node server.mjs
