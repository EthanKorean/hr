export class NotFoundError extends Error {
  constructor(message = '고객사를 찾을 수 없습니다.') {
    super(message);
  }
}
export class DuplicateBizNoError extends Error {
  constructor() {
    super('이미 등록된 사업자등록번호입니다.');
  }
}
export class ValidationError extends Error {}
export class ConflictError extends Error {
  constructor() {
    super('다른 요청과 충돌했습니다. 잠시 후 다시 시도하세요.');
  }
}
