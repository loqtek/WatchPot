#!/bin/sh
set -e
/usr/local/bin/gen-certs.sh
exec nginx -g 'daemon off;'
