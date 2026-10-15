# Study Bot 운영 가이드

## 1. 사전 조건

- Node.js 20 이상
- Docker와 Docker Compose
- Discord Bot Token과 Application Client ID
- 운영 환경에서는 PostgreSQL과 Artifact 저장소를 영속 볼륨으로 구성

`.env`는 저장소에 커밋하지 않는다. 시작 전 `.env.example`을 복사하고 실제 값을 입력한다.

```bash
cp .env.example .env
npm install
```

필수 값은 `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, `DATABASE_URL`이다. `GEMINI_API_KEY`가 없으면 Challenge 등록 후 AI 파싱과 자동 채점 Worker가 비활성화된다.

## 2. 로컬 DB 기동과 마이그레이션

```bash
npm run db:up
npm run db:check
npm run db:migrate:deploy
npm run config:check
```

개발 중 스키마를 변경할 때는 다음을 사용한다.

```bash
npm run db:migrate
```

PostgreSQL을 중지할 때는 데이터를 보존하는 `stop`을 사용한다.

```bash
npm run db:down
```

## 3. 검증 순서

```bash
npm test
npm run typecheck
npm run build
npm run db:validate
npm run test:integration
```

통합 테스트를 실제 DB에서 실행하려면 테스트용 데이터베이스를 별도로 만들고 `TEST_DATABASE_URL`을 지정한다. 지정하지 않으면 통합 테스트는 데이터 오염을 막기 위해 자동으로 건너뛴다.

```bash
TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/study_bot_test?schema=public \
  npm run test:integration
```

## 4. Discord 등록과 서버 설정

```bash
npm run dev
```

봇이 Ready 상태가 되면 Slash Command를 등록한다. `DISCORD_GUILD_ID`를 지정하면 해당 서버에 즉시 등록하고, 비워 두면 전역 명령어로 등록한다.

Discord에서 관리자 권한으로 `/config`를 실행해 다음 값을 서버별로 저장한다.

- Challenge 등록 채널
- Submission 채널 Category
- Archive Category
- 관리자 Role

시간은 `Asia/Seoul` 기준이며 상대 기한 3일은 72시간으로 처리한다. 첨부 파일 제한은 서버 설정 기본값인 10 MiB다.

## 5. 배포 전 점검

- `.env`와 Bot Token이 이미지·로그·Git에 포함되지 않았는지 확인
- `DATABASE_URL`이 운영 PostgreSQL을 가리키는지 확인
- `npm run db:migrate:deploy` 실행
- `npm run config:check`에서 필수 환경 변수 확인
- `npm test`, `npm run typecheck`, `npm run build` 통과 확인
- 운영 Discord 서버에서 `/config`, `/health` 실행 확인
- Artifact 저장 경로가 영속 디스크인지 확인
- DB 백업과 Artifact 백업 정책 확인
- Discord Bot에 필요한 Guild/Message Content 권한이 있는지 확인

실행 명령은 다음과 같다.

```bash
npm run start
```

## 6. 장애 대응

- `/health`에서 Database가 `오류`이면 PostgreSQL 연결 문자열과 DB 상태를 확인한다.
- Archive 실패는 `/archive-retry`로 재시도한다.
- 자동 채점 실패는 Job 재시도 정책에 따라 처리되며, 관리자 재채점은 `/regrade`로 실행한다.
- DB 마이그레이션 전에는 PostgreSQL과 Artifact 저장소를 백업한다.
