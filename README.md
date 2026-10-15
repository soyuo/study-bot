# Study Bot

Discord 서버에서 Challenge를 등록·승인하고, Submission을 수집·스냅샷화한 뒤 자동 채점하는 TypeScript 기반 봇입니다.

## 주요 기능

- 여러 Discord 서버별 독립 설정
- 관리자 Challenge 초안 등록 및 개인 DM 승인 미리보기
- 승인된 Challenge 공개 게시
- 사용자별 Submission 채널 예약 및 제출 잠금
- 메시지·첨부 파일 Snapshot 및 Artifact 보존
- Grading Job 큐와 자동 채점 Worker
- 재채점, Archive 재시도, Audit Log, Health 조회
- 기본 시간대 `Asia/Seoul`, 첨부 파일 최대 10 MiB

## 기술 스택

- Node.js 20+
- TypeScript
- discord.js
- Prisma 7
- PostgreSQL
- Gemini API

## 시작하기

```bash
cp .env.example .env
npm install
```

`.env`에 최소한 다음 값을 입력합니다.

```dotenv
DISCORD_TOKEN=your-discord-bot-token
DISCORD_CLIENT_ID=your-discord-application-id
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/study_bot?schema=public
```

로컬 PostgreSQL을 기동하고 스키마를 적용합니다.

```bash
npm run db:bootstrap
npm run config:check
npm run dev
```

봇이 Ready 상태가 되면 서버 관리자 계정으로 `/config`를 실행해 Challenge 채널, Submission Category, Archive Category, 관리자 Role을 설정합니다.

## 검증

```bash
npm test
npm run typecheck
npm run build
npm run db:validate
npm run test:integration
```

통합 테스트는 `TEST_DATABASE_URL`이 설정된 경우에만 실제 PostgreSQL을 사용합니다. 미설정 시 테스트 데이터 오염을 막기 위해 자동으로 건너뜁니다.

## 문서

- [SPEC.md](./SPEC.md): 전체 요구사항과 설계 명세
- [OPERATIONS.md](./OPERATIONS.md): DB 기동, 마이그레이션, 배포 전 점검, 장애 대응
- [.env.example](./.env.example): 환경 변수 템플릿

## 운영 주의사항

- `.env`와 Discord Token을 커밋하지 않습니다.
- 운영 DB와 Artifact 저장소는 영속 볼륨과 백업 정책을 사용합니다.
- 운영 배포 전 `npm run db:migrate:deploy`를 실행합니다.
- Discord Bot에는 Guilds, Guild Messages, Message Content 권한이 필요합니다.
