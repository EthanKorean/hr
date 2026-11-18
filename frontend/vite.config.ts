import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // macOS/Windows Docker 바인드 마운트에서 변경 감지 (compose 가 CHOKIDAR_USEPOLLING 을 켠다. 호스트 직접 실행 시엔 불필요한 폴링 CPU 낭비를 피한다)
    watch: { usePolling: process.env.CHOKIDAR_USEPOLLING === 'true' },
    proxy: { '/api': process.env.API_TARGET ?? 'http://localhost:8001' },
  },
});
