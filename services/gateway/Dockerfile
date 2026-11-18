FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# 스터디용 개발 모드: src 는 compose 에서 바인드 마운트되어 hot reload 된다.
CMD ["npm", "run", "dev"]
