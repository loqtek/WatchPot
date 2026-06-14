#!/bin/sh
set -e
cd /app
pip install -q -r requirements.txt
exec "$@"
