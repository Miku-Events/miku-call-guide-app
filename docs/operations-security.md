# 운영 보안 체크리스트

이 문서는 저장소 코드만으로 적용할 수 없는 **외부 운영 설정**을 기록합니다. 아래 항목은 Cloudflare와 GitHub 관리 콘솔에서 운영자가 직접 적용하고, 배포 전 별도 계정으로 재확인해야 합니다. 애플리케이션 내부 rate limiter가 이 설정을 대신하지 않습니다.

## 1. Cloudflare 쓰기 API rate limiting

- [ ] Cloudflare WAF의 단일 rate limiting rule에 아래 두 POST 경로를 함께 넣습니다. 반드시 한 규칙으로 합산해야 합니다.
  - 정확히 `/api/events/submissions`
  - `/api/events/*/edit-requests` (`*`는 한 개의 event id path segment)
- [ ] 집계 키는 클라이언트 IP로 설정합니다.
- [ ] 임계값은 **10분 동안 합산 10회**로 설정합니다.
- [ ] 초과 동작은 **30분 Block**으로 설정합니다.
- [ ] 정상 요청 10회, 11번째 요청의 차단, 30분 뒤 복구를 preview에서 검증합니다.
- [ ] Cloudflare edge 차단 응답의 `429`와 Ray ID를 확인하고, Ray ID를 운영 로그의 edge request 식별자로 사용합니다. WAF가 Function보다 먼저 차단하므로 애플리케이션 JSON 응답을 반환한다고 가정하지 않습니다.
- [ ] 규칙을 실제로 검증한 뒤에만 Pages production 환경 변수 `CLOUDFLARE_WRITE_RATE_LIMIT_CONFIGURED=true`를 설정합니다. `/api/ready`는 계정 수준 WAF 규칙을 런타임에서 조회할 수 없으므로 이 표식을 운영자 확인 증거로 사용합니다. 규칙을 제거하거나 바꾸기 전에 표식을 먼저 제거합니다.

> 이 규칙은 Cloudflare 계정의 WAF/Rate limiting 기능입니다. `wrangler.toml`이나 Pages Functions 코드가 자동 생성하지 않습니다.

## 2. Turnstile

- [ ] production과 preview에 각각 별도 Turnstile widget을 생성합니다.
- [ ] 허용 hostname을 각 환경의 실제 hostname으로 제한합니다.
- [ ] `VITE_CLOUDFLARE_TURNSTILE_SITE_KEY`, `CLOUDFLARE_TURNSTILE_SECRET_KEY`, `TURNSTILE_EXPECTED_HOSTNAME`을 해당 환경에 설정합니다.
- [ ] production/preview에 Cloudflare 공식 테스트 키, `YOUR_`, `changeme`, `replace-with-*` 값을 넣지 않습니다.
- [ ] 제출은 `event_submit`, 수정 요청은 `event_edit` action으로 검증되는지 확인합니다.

## 3. GitHub OAuth와 GitHub App

- [ ] OAuth callback URL을 `${APP_ORIGIN}/api/auth/github/callback`으로 정확히 등록합니다.
- [ ] `GITHUB_OAUTH_CLIENT_ID`와 `GITHUB_OAUTH_CLIENT_SECRET`을 preview/production 환경 secret으로 저장합니다.
- [ ] GitHub App 설치 대상을 `miku-call-guide-data` 저장소 하나로 제한합니다.
- [ ] Repository permissions는 `Contents: Read and write`, `Pull requests: Read and write`, `Issues: Read and write`, `Metadata: Read-only`만 허용합니다.
- [ ] `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_APP_INSTALLATION_ID`, `GITHUB_DATA_OWNER`, `GITHUB_DATA_REPO`, `GITHUB_DATA_BASE_BRANCH`를 환경별로 설정합니다.
- [ ] `GITHUB_APP_PRIVATE_KEY`에는 GitHub App에서 내려받은 비암호화 `RSA PRIVATE KEY`(PKCS#1) 또는 `PRIVATE KEY`(PKCS#8) PEM 전체를 저장합니다. 실제 줄바꿈과 `\n` 형식 모두 지원하며, 헤더·푸터를 제거하거나 encrypted/EC/OpenSSH 키로 바꾸지 않습니다.
- [ ] private key와 OAuth client secret의 교체 주기 및 폐기 담당자를 기록합니다.

## 4. 세션·origin·Cloudflare API token

- [ ] `APP_ENV`를 `preview` 또는 `production`으로 명시하고, `APP_ORIGIN`과 `VITE_APP_ORIGIN`을 동일한 정확한 HTTPS `URL.origin` 문자열로 설정합니다. hostname은 canonical 소문자를 사용하고 후행 `/`, 기본 포트 `:443`, path/query/fragment, credentials, 바깥 공백을 넣지 않습니다.
- [ ] `SESSION_SECRET`은 32 UTF-8 bytes 이상의 고유 난수로 생성하며 preview와 production에서 서로 다른 값을 사용합니다.
- [ ] Cloudflare deploy token은 대상 계정 하나와 Pages 배포에 필요한 `Cloudflare Pages: Edit` 권한만 부여합니다. DNS·Workers·다른 계정 권한은 부여하지 않습니다. Cloudflare API token은 개별 Pages project로 resource를 제한할 수 없으므로 project 단위 격리가 필수라면 `miku-call-guide-app` 전용 account를 사용합니다.
- [ ] GitHub Actions `production` environment에 required reviewer와 main branch 보호 규칙을 설정합니다.
- [ ] `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` 및 서버 secret은 repository variable이 아니라 environment secret으로 저장합니다.

## 5. 배포 전후 확인

- [ ] Cloudflare Pages Web Analytics 주입을 production과 preview 모두에서 비활성화합니다. `static.cloudflareinsights.com`은 의도적으로 CSP allowlist에 추가하지 않습니다.
- [ ] preview artifact가 `Content-Security-Policy-Report-Only`만 반환하고, Playwright browser smoke에서 `securitypolicyviolation`, console error, page error가 모두 0인지 확인합니다. 이 smoke가 실패하면 production environment 승인을 진행하지 않습니다.
- [ ] preview의 Pages Function은 `APP_ENV=preview`, production Function은 `APP_ENV=production`을 사용하고 각각 report-only/enforced CSP를 반환하는지 확인합니다.
- [ ] production artifact의 `dist/_headers`에 wildcard `script-src`와 `'unsafe-eval'`이 없는지 확인합니다.
- [ ] OAuth state 불일치·만료·재사용, PKCE 실패, Turnstile action/hostname 불일치, 16 KiB 초과 JSON, GitHub timeout이 모두 표준 JSON 오류와 request ID를 반환하는지 smoke test합니다.
- [ ] `/api/auth/logout`이 POST에 204를 반환하고 세션 및 OAuth cookie를 삭제하는지 확인합니다.
- [ ] `/api/ready`가 production의 `APP_ENV`, 정확한 canonical HTTPS `APP_ORIGIN`, session secret, OAuth/GitHub App 자격 증명, Turnstile secret/hostname, WAF 확인 표식을 검증하고 정확히 `{ "ready": true }`만 반환하는지 확인합니다. 요청의 `x-miku-expected-app-origin`도 동일한 정확한 origin이어야 합니다. 미준비 응답은 값이나 누락된 변수 이름을 공개하지 않는 `{ "error": "service_not_ready", "requestId": "..." }` 503이어야 합니다.
- [ ] 빌드 artifact의 `release.json`이 GitHub commit SHA와 일치하는지 확인합니다. 배포 smoke는 Wrangler의 고유 `deployment-url`과 canonical origin에서 이 값을 각각 확인하므로 이전 정상 배포가 새 배포를 대신해 통과할 수 없습니다.

`main` push는 품질 검사만 실행합니다. production 배포는 `workflow_dispatch`에서만 시작하며, 한 운영자가 정확한 full release SHA, `miku-call-guide-app.pages.dev`, 해당 SHA의 이 체크리스트 URL을 입력합니다. report-only Pages preview와 browser smoke가 먼저 통과한 뒤 GitHub `production` environment 승인을 수행하는 2단계 절차입니다.

정상 production 배포는 publish 전에 현재 canonical `/api/ready`를 호출합니다. 이 preflight가 실패하면 Wrangler를 실행하지 않으므로 먼저 Pages production binding과 secret을 고친 뒤 재시도해야 합니다. JSON `503`, redirect, 기존 readiness contract 오류를 bootstrap으로 우회하지 않습니다.

### 최초 readiness contract bootstrap

기존 production에서 `/api/ready`가 root SPA 문서로 fallback되는 최초 migration에만 다음 순서를 한 번 사용합니다.

1. 위 체크리스트의 모든 production binding, secret, WAF rate-limit 표식을 먼저 설정하고 별도 운영자가 값을 재확인합니다.
2. `main`의 **Run workflow**에서 full release SHA, production hostname, immutable checklist URL을 입력하고 `bootstrap_readiness_contract=true`를 선택합니다.
3. report-only preview browser smoke가 CSP violation과 console/page error 없이 통과한 뒤 GitHub `production` environment 승인을 수행합니다. bootstrap 입력은 저장소 variable이나 secret으로 저장하지 않습니다.
4. bootstrap preflight는 exact canonical origin의 root와 `/api/ready`가 모두 redirect 없는 `200 text/html`이고, readiness contract header가 없으며, SPA root와 hashed JS/CSS asset marker가 있고, 두 body의 SHA-256이 동일할 때만 허용합니다. `404`, JSON readiness/`503`, redirect, 서로 다른 HTML, 기존 contract는 모두 실패합니다.
5. 같은 실행의 post-deploy smoke가 새 JSON expected-origin contract, 입력한 full release SHA, 고유 deployment URL, canonical origin을 모두 검증했는지 확인합니다. 이후 모든 실행은 bootstrap을 `false`로 둡니다.

이미 새 readiness contract가 응답하는 환경에서 설정 오류가 발생했다면 bootstrap 입력은 이를 우회하지 못합니다. 설정을 수정해 일반 preflight가 통과하도록 복구합니다.
