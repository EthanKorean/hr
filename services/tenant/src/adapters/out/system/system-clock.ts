import type { Clock } from '../../../application/ports.js';

export class SystemClock implements Clock {
  // 컨테이너 TZ(Asia/Seoul) 기준 로컬 날짜. 'sv-SE' 로케일이 YYYY-MM-DD 를 준다.
  today() {
    return new Date().toLocaleDateString('sv-SE');
  }
}
