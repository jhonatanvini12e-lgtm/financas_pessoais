# ---- builder: instala dependencias (inclui toolchain nativa para compilar
# better-sqlite3-multiple-ciphers) e copia o codigo-fonte ----
FROM node:22-bookworm-slim AS builder

RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
# npm ci (nao npm install) para respeitar exatamente o package-lock.json.
RUN npm ci

COPY . .

# ---- imagem final: sem toolchain de build, roda como usuario nao-root ----
FROM node:22-bookworm-slim

WORKDIR /app

# Copia so o resultado do builder (node_modules ja compilado + codigo) -- a
# imagem final nunca tem python3/make/g++, reduzindo tamanho e superficie de
# ataque (um bug explorável em alguma lib de parsing native nao ganha acesso
# a um toolchain de compilacao no container comprometido).
COPY --from=builder /app /app

# O backend processa arquivos nao confiaveis enviados por usuarios
# (CSV/OFX/PDF/XLSX na importacao de extrato) -- se algum parser tiver um bug
# explorável, o processo comprometido nao deve rodar como root no container.
# /app/data e /app/backups sao os paths montados como volume (ver
# DB_PATH/BACKUP_DIR no docker-compose.yml), entao precisam ser graváveis
# pelo usuario da aplicacao.
RUN groupadd -r appgroup && useradd -r -g appgroup -m appuser \
    && mkdir -p /app/data /app/backups \
    && chown -R appuser:appgroup /app

USER appuser

EXPOSE 3000

# Usa o proprio node (sempre disponivel nesta imagem) em vez de curl/wget --
# node:*-slim nao inclui nenhum dos dois por padrao, entao depender de um
# deles arriscaria quebrar o build/healthcheck.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3000/api/health', res => process.exit(res.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

CMD ["npm", "start"]
