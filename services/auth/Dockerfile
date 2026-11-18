FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# 스터디용 개발 모드: src 는 compose 에서 바인드 마운트되어 hot reload 된다. migrations 도 마운트되지만 tsx watch 는 import 하지 않는 .sql 변경을 감지하지 못한다(새 마이그레이션은 서비스 재시작 시 적용).
CMD ["npm", "run", "dev"]
