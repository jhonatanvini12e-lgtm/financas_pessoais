FROM node:22-alpine as build
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
# Nao rodamos "USER nginx" aqui de proposito: a imagem oficial nginx:alpine ja
# roda os worker processes (que efetivamente atendem as requisicoes) como o
# usuario "nginx" nao-root por padrao (configurado via "user nginx;" no
# nginx.conf principal da imagem, nao no nosso default.conf). So o master
# process roda como root, e isso e necessario para poder bindar a porta 80
# (<1024). Forcar "USER nginx" no Dockerfile impediria o master de bindar
# essa porta e quebraria o container. Para eliminar o root do master
# process seria preciso mudar para porta >=1024 (ex: 8080) + imagem
# nginx-unprivileged + ajustar o mapeamento de porta no docker-compose.yml --
# fora do escopo desta correcao pontual para nao arriscar quebrar o build/
# deploy sem poder testar.
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
