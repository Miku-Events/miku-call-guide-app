# 🎵 미쿠 콜가이드 웹앱 (Miku Call Guide App)

하츠네 미쿠의 음악과 곡 가사, 콜(Chant/Penlight Cues)을 유튜브 재생과 싱크하여 연습할 수 있는 **반응형 웹 어플리케이션**입니다. 

---

## 🛠️ 기술 스택 (Tech Stack)

* **프레임워크**: React 19 (Vite 기반)
* **스타일링**: Tailwind CSS v4 (CSS-first 컴파일러 사용)
* **라우팅**: React Router Dom
* **아이콘**: Lucide React
* **테스팅**: Vitest (단위 테스트), Playwright (E2E 브라우저 테스트)

---

## ✨ 주요 기능 (Key Features)

* 🎵 **곡 카탈로그**: 고정밀 곡 검색 및 응원 가이드 카탈로그 제공.
* 📅 **이벤트 캘린더**: 월별 공연/티켓팅 일정 조회, 행사 종류별 필터링, SNS 오리지널 공지 임베디드 뷰 지원.
* 🎬 **유튜브 싱크 플레이어**: YouTube IFrame Player API를 활용하여 실제 뮤직비디오 재생 타임라인과 가사/응원 싱크 정밀 연동.
* 📌 **가사 기반 앵커링**: 응원 시점 화살표 및 강조 표시(Bracket/Underline)를 가사 줄의 문자 좌표(Grapheme) 기반으로 동적 배치.
* 📥 **일정 제보 및 수정 요청**: 사용자가 웹 폼을 통해 일정을 제보하면 GitHub API와 연동되어 자동으로 Pull Request나 Issue가 생성되는 제보 워크플로우 탑재.
* 💾 **탄력적 로컬 캐싱**: 오프라인 상태에서도 동작할 수 있도록 데이터를 브라우저 로컬 캐시로 자동 대체 및 페칭.

---

## 🚀 5분 로컬 구동 가이드 (Getting Started)

### 1. Node.js 준비

이 저장소는 `.node-version`에 고정된 **Node.js 24.11.1**을 사용합니다.

### 2. 의존성 설치
```bash
npm ci
```

### 3. 환경 설정 (`.env`)
프로젝트 루트 폴더에 `.env` 파일을 생성하고 아래의 환경 변수 예시를 참고하여 필요한 설정을 주입해 주세요. (기본값 설정이 주입된 `.env.example` 파일을 복사해 사용할 수 있습니다.)

```bash
cp .env.example .env
```

| 변수명 | 필수 여부 | 설명 | 예시 |
|--------|-----------|------|------|
| `VITE_DATA_MANIFEST_URL` | **필수** | 빌드된 원본 일정/곡 매니페스트 URL | `http://localhost:4174/manifest.json` (로컬) |
| `VITE_APP_ORIGIN` | **운영 필수** | canonical 및 보안 정책에 사용할 정확한 `URL.origin` 형식 | `http://localhost:5173` (로컬) |
| `VITE_RELEASE_ID` | CI 자동 설정 | `dist/release.json`에 기록할 공개 배포 식별자 | GitHub Actions의 `GITHUB_SHA` |
| `VITE_CLOUDFLARE_TURNSTILE_SITE_KEY` | 선택 | 클라우드플레어 캡차 보안 키 | `1x00000000000000000000AA` (테스트용) |
| `VITE_SUBMISSION_API_URL` | 선택 | 제보/수정 API 서버리스 엔드포인트 | `http://localhost:8788` (로컬) |

GitHub 로그인과 제보 API를 로컬에서 실행할 때는 서버 전용 변수도 설정해야 합니다. `APP_ENV`는 로컬 HTTP 개발에서는 `local`, 운영에서는 `production`을 사용합니다. 배포 workflow의 preview는 동일한 정적 artifact와 CSP를 확인하는 기술 smoke이며 live OAuth·Turnstile 설정을 요구하지 않습니다. `SESSION_SECRET`은 아래처럼 32바이트 이상의 임의 값으로 생성하고 저장소에 커밋하지 마세요.

```bash
node --input-type=module -e "import { randomBytes } from 'node:crypto'; console.log(randomBytes(48).toString('base64url'))"
```

`production`과 `preview`에서는 OAuth 및 세션 쿠키가 Secure `__Host-` 쿠키로 발급됩니다. HTTP 기반 `local`과 `test`만 비-`__Host` 쿠키 이름을 사용합니다. OAuth state/PKCE 거래는 10분, 로그인 세션은 7일 동안 유효합니다.

`APP_ENV`는 반드시 `local`, `test`, `preview`, `production` 중 하나로 명시해야 합니다. `local`과 `test`에서는 Turnstile secret을 생략하면 공식 성공 테스트 secret을 사용하지만, live API를 사용하는 `preview`와 `production`은 실제 `CLOUDFLARE_TURNSTILE_SECRET_KEY`와 `TURNSTILE_EXPECTED_HOSTNAME`(프로토콜 없는 hostname)을 모두 요구하며 공식 테스트 키와 placeholder를 거부합니다. 운영의 `APP_ORIGIN`과 `VITE_APP_ORIGIN`은 정확히 `https://miku-call-guide-app.pages.dev`, `VITE_DATA_MANIFEST_URL`은 정확히 `https://miku-call-guide-data.pages.dev/manifest.json`이어야 합니다. 운영 빌드는 실제 Turnstile site key도 요구하며, 이 값들에서 CSP를 생성해 `dist/_headers`에 포함합니다. 운영 readiness는 고정된 runtime `APP_ORIGIN`, OAuth/GitHub App/session/Turnstile 설정과 외부 WAF rate-limit 확인 표식 `CLOUDFLARE_WRITE_RATE_LIMIT_CONFIGURED=true`를 함께 검증합니다.

### 4. 개발 서버 구동
```bash
# 로컬 개발 서버 구동 (기본 포트: 5173)
npm run dev
```

> [!TIP]
> **로컬 데이터 연동 개발**: 데이터 저장소(`miku-call-guide-data`)에서 `npm run dev`를 실행하면 `http://127.0.0.1:4174` 포트에서 빌드 데이터가 서빙됩니다. 이 경우 웹앱의 `VITE_DATA_MANIFEST_URL`을 위 로컬 포트로 설정하면 새로 추가하거나 편집 중인 응원콜 및 일정을 실시간으로 웹앱에 반영하여 테스트할 수 있습니다!

---

## 📂 폴더 구조 및 아키텍처 (Directory Structure)

```text
├── api/                         # 플랫폼 중립 GitHub/OAuth/Turnstile API handlers
├── functions/api/               # Cloudflare Pages Function adapters
├── data-contracts/              # 데이터 저장소에서 생성·동기화한 타입/validator
├── docs/                        # 운영 보안 및 외부 설정 체크리스트
├── public/                      # favicon과 1200×630 OG 이미지
├── scripts/                     # 계약, 배포 환경, bundle, smoke 검사
├── src/
│   ├── main.tsx                 # Theme/LinkProvider/HashRouter 진입점
│   ├── App.tsx                  # lazy route, Error Boundary, 404
│   ├── app/config.ts            # 공개 런타임 환경 읽기
│   ├── components/              # 앱 공통 위젯
│   ├── features/
│   │   ├── callGuide/           # 동기화 가사·콜 연습 화면
│   │   ├── catalog/             # 곡/이벤트 카탈로그
│   │   ├── data/                # 계약 검증, fetch, versioned snapshot cache
│   │   ├── events/              # 월간 캘린더와 GitHub 제보 흐름
│   │   └── player/              # YouTube IFrame API 경계
│   ├── shared/                  # layout, error, i18n, time 공통 코드
│   └── test/                    # Vitest setup과 API/security tests
└── tests/                       # Playwright fixtures와 E2E specs
```

앱은 Cloudflare Pages 데이터 origin을 canonical production source로 사용합니다. 브라우저 캐시는 manifest origin·`dataVersion`·resource path로 분리되며 24시간은 fresh, 이후 최대 30일까지 명시적인 stale 경고와 함께 마지막 정상 snapshot을 사용할 수 있습니다.

---

## 🧪 테스팅 가이드 (Testing Guide)

웹앱의 신뢰성을 보장하기 위해 두 종류의 테스팅 프레임워크가 긴밀하게 가동됩니다.

### 1. 단위 및 컴포넌트 테스트 (Vitest)
컴포넌트의 순수 렌더링 상태 및 로컬 캐시 연동 비즈니스 로직을 검증합니다.
```bash
# 전체 단위 테스트 실행
npm run test

# 린트, 두 TypeScript 설정, 단위 테스트, 프로덕션 빌드 일괄 검증
npm run check

# sibling 데이터 dist를 현재 앱 validator로 검사
npm run data:check

# 생성 계약 동기화/드리프트 검사
npm run contracts:sync
npm run contracts:check

# 빌드된 main JS와 전체 CSS의 gzip 예산 검사
npm run bundle:check
```

### 2. 브라우저 End-to-End 테스트 (Playwright)
Chromium 데스크톱과 Pixel 7 모바일 환경에서 유튜브 플레이어 연동 및 캘린더 페이지의 사용자 동작 흐름을 검증합니다. 현재 CI browser gate는 Chromium 계열 두 viewport이며 Firefox/WebKit 호환을 보장하는 별도 project는 아직 없습니다. 기본 명령은 Vite 개발 서버를 사용합니다.
```bash
# 개발 서버 기반 E2E 실행
npm run test:e2e

# 이미 빌드된 dist artifact를 Vite preview로 서빙해 E2E 실행
npm run build
npm run test:e2e:ci
```

> [!NOTE]
> **Mock Player 모드**: E2E 테스트 수행 시 실제 유튜브 네트워크 요청을 차단하고 격리된 상태에서 비동기 플레이어 동작을 시뮬레이션하기 위해 주소창 뒤에 `?mockPlayer=1` 쿼리 파라미터를 추가합니다.

### 3. CI 및 배포

GitHub Actions는 저장소에 vendoring된 생성 계약과 `data-contracts.lock.json`의 파일 hash를 먼저 검증합니다. lock의 데이터 저장소 commit은 생성물의 provenance 기록이며 CI checkout 지시가 아닙니다. 이어서 `npm run check`와 high-severity 의존성 감사를 통과한 `dist`를 한 번만 artifact로 생성합니다. Playwright E2E, enforced-CSP Pages preview, production 배포가 이 동일 artifact와 `github.sha`를 사용합니다. 빌드에는 `GITHUB_SHA` 기반 `release.json`이 포함됩니다. 배포 후 smoke는 Wrangler가 반환한 고유 deployment URL과 canonical origin 양쪽에서 동일 release ID, 엄격한 CSP/HSTS/nosniff/Referrer/Permissions 헤더, OG 이미지, manifest, `runtime-config-v1` JSON readiness Function을 확인합니다.

계약을 갱신할 때는 데이터 저장소가 생성한 contract bundle을 명시적으로 동기화하고 lock의 provenance와 파일 hash를 함께 commit합니다. 앱 CI는 이 vendored snapshot을 자체 검증하므로 다른 비공개 저장소 token이나 cross-repository checkout이 필요하지 않습니다.

`VITE_APP_ORIGIN`은 후행 `/` 없는 정확한 HTTPS `URL.origin` 형식으로 root canonical과 절대 OG URL을 생성합니다. `public/og-image.png`는 실제 1200×630 PNG이며 metadata test가 크기와 경로를 검사합니다.

Cloudflare WAF rate limit, Turnstile hostname, GitHub App 최소 권한, 배포 token과 수동 production 승격처럼 저장소 밖에서 적용해야 하는 항목은 [운영 보안 체크리스트](docs/operations-security.md)를 따릅니다.

---

## 🤖 에이전트 전용 명세서 안내
AI 에이전트 작업 규칙의 기준 문서는 **[AGENTS.md](AGENTS.md)**입니다. `CLAUDE.md`는 같은 문서를 가리키는 짧은 참조만 유지합니다.
