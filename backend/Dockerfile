FROM node:22-bookworm-slim

RUN apt-get update && apt-get install -y python3 make g++

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

RUN mkdir -p /app/data /app/backups

EXPOSE 3000

CMD ["npm", "start"]
