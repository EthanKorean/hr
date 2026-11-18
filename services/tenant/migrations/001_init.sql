-- 고객사(테넌트). 이후 근로자/근로자 관리자는 tenant_id 로 이 테이블을 참조한다.
CREATE TABLE tenants (
  id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name          VARCHAR(150) NOT NULL,
  biz_no        VARCHAR(20)  NOT NULL UNIQUE COMMENT '사업자등록번호',
  contact_name  VARCHAR(100) NOT NULL,
  contact_email VARCHAR(190) NOT NULL,
  contact_phone VARCHAR(30)  NOT NULL DEFAULT '',
  max_employees INT UNSIGNED NOT NULL DEFAULT 10,
  start_date    DATE NOT NULL COMMENT '사용 시작일',
  end_date      DATE NOT NULL COMMENT '사용 종료일(포함)',
  status        ENUM('active','suspended') NOT NULL DEFAULT 'active' COMMENT '관리자 수동 정지 여부',
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_tenants_end_date (end_date)
) ENGINE=InnoDB;
