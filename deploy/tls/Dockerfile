FROM nginx:1.27-alpine

RUN apk add --no-cache openssl \
    && rm -f /etc/nginx/conf.d/default.conf

COPY watchpot.conf /etc/nginx/conf.d/watchpot.conf
COPY gen-certs.sh /usr/local/bin/gen-certs.sh
COPY entrypoint.sh /usr/local/bin/watchpot-tls-entrypoint.sh
RUN chmod +x /usr/local/bin/gen-certs.sh /usr/local/bin/watchpot-tls-entrypoint.sh

EXPOSE 80 443

ENTRYPOINT ["/usr/local/bin/watchpot-tls-entrypoint.sh"]
