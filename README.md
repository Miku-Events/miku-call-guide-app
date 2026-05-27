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

### 1. 의존성 설치
```bash
npm install
```

### 2. 환경 설정 (`.env`)
프로젝트 루트 폴더에 `.env` 파일을 생성하고 아래의 환경 변수 예시를 참고하여 필요한 설정을 주입해 주세요. (기본값 설정이 주입된 `.env.example` 파일을 복사해 사용할 수 있습니다.)

```bash
cp .env.example .env
```

| 변수명 | 필수 여부 | 설명 | 예시 |
|--------|-----------|------|------|
| `VITE_DATA_MANIFEST_URL` | **필수** | 빌드된 원본 일정/곡 매니페스트 URL | `http://localhost:4174/manifest.json` (로컬) |
| `VITE_CLOUDFLARE_TURNSTILE_SITE_KEY` | 선택 | 클라우드플레어 캡차 보안 키 | `1x00000000000000000000AA` (테스트용) |
| `VITE_SUBMISSION_API_URL` | 선택 | 제보/수정 API 서버리스 엔드포인트 | `https://api.example.com` |

### 3. 개발 서버 구동
```bash
# 로컬 개발 서버 구동 (기본 포트: 5173)
npm run dev
```

> [!TIP]
> **로컬 데이터 연동 개발**: 데이터 저장소(`miku-call-guide-data`)에서 `npm run dev`를 실행하면 `http://127.0.0.1:4174` 포트에서 빌드 데이터가 서빙됩니다. 이 경우 웹앱의 `VITE_DATA_MANIFEST_URL`을 위 로컬 포트로 설정하면 새로 추가하거나 편집 중인 응원콜 및 일정을 실시간으로 웹앱에 반영하여 테스트할 수 있습니다!

---

## 📂 폴더 구조 및 아키텍처 (Directory Structure)

```text
src/
├── app/               # 앱 진입점 및 라우팅 설정 (App.tsx, main.tsx)
├── assets/            # 정적 리소스 (이미지, 폰트 등)
├── components/        # 공통 UI 컴포넌트 (버튼, 입력 필드 등)
├── features/          # 기능 중심 모듈화 레이어
│   ├── callGuide/     # 노래 응원콜 뷰어 및 인터페이스
│   ├── catalog/       # 검색 필터링이 포함된 노래 목록 카탈로그
│   ├── data/          # 매니페스트 및 JSON 데이터 캐싱/페치 레이어
│   ├── events/        # 캘린더, 월별 일정 보기 및 GitHub API 연동 제보 폼
│   └── player/        # 유튜브 IFrame API 기반 비디오 연동 플레이어
├── shared/            # 공통 유틸리티 및 타임 핸들러
└── test/              # 테스트 설정 및 Mock 데이터
```

---

## 🧪 테스팅 가이드 (Testing Guide)

웹앱의 신뢰성을 보장하기 위해 두 종류의 테스팅 프레임워크가 긴밀하게 가동됩니다.

### 1. 단위 및 컴포넌트 테스트 (Vitest)
컴포넌트의 순수 렌더링 상태 및 로컬 캐시 연동 비즈니스 로직을 검증합니다.
```bash
# 전체 단위 테스트 실행
npm run test
```

### 2. 브라우저 End-to-End 테스트 (Playwright)
실제 크롬/사파리 등의 브라우저를 띄워 유튜브 플레이어 연동 및 캘린더 페이지의 사용자 동작 흐름을 온전히 검증합니다.
```bash
# E2E 브라우저 테스트 실행
npm run test:e2e
```

> [!NOTE]
> **Mock Player 모드**: E2E 테스트 수행 시 실제 유튜브 네트워크 요청을 차단하고 격리된 상태에서 비동기 플레이어 동작을 시뮬레이션하기 위해 주소창 뒤에 `?mockPlayer=1` 쿼리 파라미터를 추가하여 제어할 수 있는Mock 플레이어 모드가 탑재되어 있습니다.

---

## 🤖 에이전트 전용 명세서 안내
AI 에이전트를 사용하여 클래스 스타일링을 하거나, Playwright 브라우저 테스팅 자동화 코드를 기입하는 등의 작업을 맡기실 경우, 반드시 **[AGENTS.md](AGENTS.md) (혹은 [CLAUDE.md](CLAUDE.md))**의 기계 전용 엄격 명세 가이드를 바탕으로 구동할 수 있도록 에이전트 프롬프트를 조율해 주세요!
