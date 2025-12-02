# -----------------------------
# Build stage (se não tiver build local)
# -----------------------------
FROM node:18-alpine as build

WORKDIR /app
COPY . .

# se você tiver dependências de build do front
# RUN npm install && npm run build
# caso contrário o index.html já está no root e vamos só copiar

# -----------------------------
# Nginx stage
# -----------------------------
FROM nginx:stable-alpine

# Remover config padrão
RUN rm /etc/nginx/conf.d/default.conf

# Copiar nosso nginx.conf corrigido
COPY nginx.conf /etc/nginx/nginx.conf

# Copiar todos os arquivos estáticos
COPY . /usr/share/nginx/html

# Expor porta interna do nginx
EXPOSE 8086

# Healthcheck para o Coolify e Traefik
HEALTHCHECK --interval=15s --timeout=5s \
  CMD wget -qO- http://localhost:8086/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
