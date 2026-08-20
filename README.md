# 가온: 잃어버린 기억

AI 동료에게 한국어로 작전을 지시하고 아이템을 활용해 길을 개척하는 2D 액션 어드벤처의 첫 프로토타입입니다.

## 실행

실제 AI 없이 정적 화면만 확인하려면 빌드 과정이나 패키지 설치가 필요 없습니다.

```bash
python3 -m http.server 8080
```

브라우저에서 `http://localhost:8080`을 엽니다. 정적 파일만 사용하므로 그대로 GitHub Pages에 배포할 수 있습니다.

## Solar Pro 4 연결

OpenRouter 키는 브라우저나 GitHub 저장소에 넣지 않고 서버 환경 변수로만 설정합니다. 노출된 키는 폐기하고 새 키를 발급한 후 실행하세요.

```bash
OPENROUTER_API_KEY="새로_발급한_키" node server.mjs
```

브라우저에서 `http://127.0.0.1:8765`를 엽니다. 서버는 `upstage/solar-pro4`를 호출하고 JSON Schema로 제한된 게임 행동만 반환합니다.

GitHub Pages에는 비밀 키를 보관할 서버 기능이 없으므로 정식 배포 시 `/api/interpret` 부분을 Cloudflare Workers 같은 서버리스 API로 배포하고 프런트엔드 요청 주소를 해당 API로 설정해야 합니다.

AI 서버를 배포한 뒤 `config.js`에 공개 서버 주소만 설정합니다.

```js
window.GAON_API_BASE = 'https://gaon-api.example.workers.dev';
```

API 키는 `config.js`가 아니라 AI 서버의 비밀 환경 변수에만 저장해야 합니다.

## GitHub Pages 최소 데모

현재 `config.js`의 `GAON_DEMO_MODE`가 `true`이므로 AI 서버 없이도 GitHub Pages에서 로컬 명령 해석기로 5개 스테이지를 테스트할 수 있습니다. `main` 브랜치에 푸시하면 `.github/workflows/pages.yml`이 정적 게임을 자동 배포합니다.

저장소의 **Settings → Pages → Build and deployment → Source**에서 **GitHub Actions**를 선택해야 합니다.

## 현재 구현

- 브라우저에 저장되는 모험가 프로필
- 프롬프트로만 실행되는 이동, 사다리 오르기, 플랫폼 충돌
- Solar Pro 4를 통해 한국어 자연어 명령을 제한된 게임 행동으로 변환하는 AI 해석 서버
- AI의 행동 계획 확인 후 실행
- 짧은 틈용 휴대용 발판, 넓은 절벽용 기억의 밧줄, 높은 지형용 접이식 사다리
- 첫 번째 스테이지와 완료 기록 저장

AI 서버에 연결할 수 없으면 기존 로컬 해석기가 임시 대체 수단으로 동작합니다.
