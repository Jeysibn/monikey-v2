FROM node:22.22.0-alpine@sha256:e4bf2a82ad0a4037d28035ae71529873c069b13eb0455466ae0bc13363826e34

RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
    /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
  && apk update \
  && apk upgrade --no-cache

COPY --chown=70:70 apps/backup-metrics/server.mjs /usr/local/bin/monikey-backup-metrics.mjs
USER 70:70
EXPOSE 9100
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:9100/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "/usr/local/bin/monikey-backup-metrics.mjs"]
