# Stock nginx + inotify-tools so the container can watch the shared
# ssl_certs volume and reload itself when the backend writes a new
# cert.pem/key.pem — see entrypoint.sh. No extra privileges (no Docker
# socket access) are needed for this: nginx just re-reads its own
# already-mounted files.
FROM nginx:1.25-alpine

RUN apk add --no-cache inotify-tools

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
