# 미쿠 콜가이드 웹앱

하츠네 미쿠 곡의 가사와 콜을 YouTube 재생 시점에 맞춰 연습하고,
공연과 티켓팅 일정을 확인하는 웹앱입니다.

[miku.sekai.today에서 보기](https://miku.sekai.today)

관련 권리자와 제휴하거나 공식 승인을 받은 서비스가 아닌 비공식 팬 프로젝트입니다.

## 주요 기능

- 곡 검색과 YouTube 재생 연동
- 재생 시점에 맞춘 가사·콜 표시
- 월별 공연·티켓팅 일정과 공식 SNS 링크
- GitHub 로그인으로 일정 제보와 수정 요청
- 데이터 로드 실패 시 검증된 캐시 사용

## 기술 스택

React 19와 TypeScript로 작성했으며 Vite 8, React Router, Tailwind CSS 4, Astryx를
사용합니다. Cloudflare Pages와 Pages Functions에 배포하고 Vitest와 Playwright로 테스트합니다.

## 로컬 개발

Node.js 26.5.1과 npm 11.17.0이 필요합니다. `.env.example`을 `.env`로 복사한 뒤 실행합니다.

```bash
npm ci
npm run dev
```

기본 설정은 공개 데이터와 Turnstile 테스트 키를 사용합니다. GitHub 로그인이나 제출 기능을
개발할 때만 `.env.example`의 서버 변수를 추가로 설정하세요. 실제 secret이 든 `.env`는
커밋하지 않습니다.

## 검증

```bash
npm run check
```

Functions나 사용자 흐름을 변경할 때 필요한 추가 검증은 [CONTRIBUTING.md](CONTRIBUTING.md)를
참고하세요.

## 관련 문서

- [기여 안내](CONTRIBUTING.md)
- [보안 정책](SECURITY.md)
- [행동강령](CODE_OF_CONDUCT.md)
- [운영 보안 설정](docs/operations-security.md)

## 라이선스

이 저장소 전체에 대한 재사용 라이선스를 부여하지 않습니다. 기여자의 권리와 제출 조건은
[CONTRIBUTING.md](CONTRIBUTING.md), 제3자 소프트웨어와 자산의 고지는
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)를 참고하세요.
