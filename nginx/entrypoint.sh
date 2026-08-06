#!/bin/sh
set -e

nginx -g 'daemon off;' &
NGINX_PID=$!

trap 'nginx -s quit 2>/dev/null; wait "$NGINX_PID" 2>/dev/null; exit 0' TERM INT

# Reload nginx whenever the mounted cert/key pair changes (uploaded via the
# admin panel writes cert.pem/key.pem atomically via os.replace) so a new
# certificate takes effect without a container restart.
(
    while inotifywait -q -e close_write,create,move,delete /etc/nginx/ssl >/dev/null 2>&1; do
        if nginx -t >/dev/null 2>&1; then
            nginx -s reload
        fi
    done
) &

wait "$NGINX_PID"
