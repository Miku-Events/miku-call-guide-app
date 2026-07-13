# 운영 보안 체크리스트

이 문서는 저장소 코드만으로 적용할 수 없는 **외부 운영 설정**을 기록합니다. 아래 항목은 Cloudflare와 GitHub 관리 콘솔에서 운영자가 직접 적용하고, 배포 전 별도 계정으로 재확인해야 합니다.

## 1. Cloudflare Dashboard 보호 범위

- [ ] canonical production origin이 `https://miku-call-guide-app.pages.dev`인지 확인합니다.
- [ ] `sekai.today` zone의 WAF rule이 `pages.dev` 요청에도 적용된다고 가정하지 않습니다.
- [ ] 현재 `pages.dev` 구성에는 application rate limiter, Workers Rate Limiting binding, KV, Durable Object 또는 별도 limiter Worker를 추가하지 않습니다.
- [ ] `CLOUDFLARE_WRITE_RATE_LIMIT_CONFIGURED` 같은 확인 표식만으로 limiter가 존재하는 것처럼 보고하지 않습니다.
- [ ] Cloudflare의 자동 DDoS 보호, Turnstile 및 Pages Functions 할당량은 각각 별도 보호 계층이며 application rate limit과 동일한 계약으로 설명하지 않습니다.

쓰기 API는 GitHub session, Turnstile action/hostname, JSON content type, 16 KiB body 제한과 입력 길이 제한을 계속 적용합니다. 향후 proxied custom domain을 도입할 때만 해당 zone에서 제공하는 WAF rate limiting을 별도 변경으로 재검토합니다.

## 2. Turnstile

- [ ] production Turnstile widget을 생성하고 허용 hostname을 실제 production hostname으로 제한합니다.
- [ ] production에 `VITE_CLOUDFLARE_TURNSTILE_SITE_KEY`, `CLOUDFLARE_TURNSTILE_SECRET_KEY`, `TURNSTILE_EXPECTED_HOSTNAME`을 설정합니다.
- [ ] production에 Cloudflare 공식 테스트 키, `YOUR_`, `changeme`, `replace-with-*` 값을 넣지 않습니다.
- [ ] 제출은 `event_submit`, 수정 요청은 `event_edit` action으로 검증되는지 확인합니다.

배포 workflow의 preview는 동일한 정적 artifact와 enforced CSP를 검증하는 기술 smoke입니다. OAuth나 Turnstile 제출을 실행하지 않으므로 별도 preview widget 또는 live auth secret을 요구하지 않습니다.

## 3. GitHub OAuth와 GitHub App

- [ ] OAuth callback URL을 `${APP_ORIGIN}/api/auth/github/callback`으로 정확히 등록합니다.
- [ ] OAuth authorize 요청이 공개 `id`와 `login` 확인에 불필요한 `read:user` scope를 요청하지 않는지 확인합니다.
- [ ] `GITHUB_OAUTH_CLIENT_ID`와 `GITHUB_OAUTH_CLIENT_SECRET`을 production 환경 secret으로 저장합니다.
- [ ] GitHub App 설치 대상을 `miku-call-guide-data` 저장소 하나로 제한합니다.
- [ ] Repository permissions는 `Contents: Read and write`, `Pull requests: Read and write`, `Issues: Read and write`, `Metadata: Read-only`만 허용합니다.
- [ ] `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_APP_INSTALLATION_ID`, `GITHUB_DATA_OWNER`, `GITHUB_DATA_REPO`, `GITHUB_DATA_BASE_BRANCH`를 production 환경에 설정합니다.
- [ ] `GITHUB_APP_PRIVATE_KEY`에는 GitHub App에서 내려받은 비암호화 `RSA PRIVATE KEY`(PKCS#1) 또는 `PRIVATE KEY`(PKCS#8) PEM 전체를 저장합니다. 실제 줄바꿈과 `\n` 형식 모두 지원하며, 헤더·푸터를 제거하거나 encrypted/EC/OpenSSH 키로 바꾸지 않습니다.
- [ ] private key와 OAuth client secret의 교체 주기 및 폐기 담당자를 기록합니다.

## 4. 세션·origin·Cloudflare API token

- [ ] production의 `APP_ENV=production`을 명시하고, `APP_ORIGIN`과 `VITE_APP_ORIGIN`을 동일한 정확한 HTTPS `URL.origin` 문자열로 설정합니다. hostname은 canonical 소문자를 사용하고 후행 `/`, 기본 포트 `:443`, path/query/fragment, credentials, 바깥 공백을 넣지 않습니다.
- [ ] `wrangler.toml`을 Pages runtime 변수의 source of truth로 사용합니다. production 배포 preflight는 이전 dashboard 구성에 남은 동명 `APP_ORIGIN` binding만 제거하며 다른 변수나 secret은 변경하지 않습니다.
- [ ] production `SESSION_SECRET`은 32 UTF-8 bytes 이상의 고유 난수로 생성합니다.
- [ ] Cloudflare deploy token은 대상 계정 하나와 Pages 배포에 필요한 `Cloudflare Pages: Edit` 권한만 부여합니다. DNS·Workers·다른 계정 권한은 부여하지 않습니다. Cloudflare API token은 개별 Pages project로 resource를 제한할 수 없으므로 project 단위 격리가 필수라면 `miku-call-guide-app` 전용 account를 사용합니다.
- [ ] GitHub 무료 private 저장소에서는 environment required reviewer를 전제로 하지 않습니다. 한 운영자가 PR을 main에 merge한 뒤 input 없는 `workflow_dispatch`를 main에서 별도로 실행하는 수동 승격 절차를 따릅니다. release ID는 dispatch된 `github.sha`에서 자동 생성합니다.
- [ ] `CLOUDFLARE_API_TOKEN`과 `CLOUDFLARE_ACCOUNT_ID`는 GitHub Actions secret으로, Pages Function의 session/OAuth/GitHub App/Turnstile 값은 Cloudflare Pages production 환경 secret으로 저장합니다.

## 5. 배포 전후 확인

- [ ] Cloudflare Pages Web Analytics 설정은 유지하고, 정적 CSP는 공식 beacon과 collector origin인 `static.cloudflareinsights.com`, `cloudflareinsights.com`만 허용하는지 확인합니다.
- [ ] 동일한 artifact의 enforced CSP를 preview와 production에서 사용합니다. preview browser smoke는 `/`, `/#/events`, `/#/songs/39-music`을 순회하며 CSP violation과 page error가 있으면 production 승격을 중단합니다. console 메시지는 진단으로 기록하되 단독 실패 조건으로 사용하지 않습니다.
- [ ] preview 정적 응답과 production 정적·Function 응답이 모두 `Content-Security-Policy`를 반환하고 `Content-Security-Policy-Report-Only`를 반환하지 않는지 확인합니다.
- [ ] production artifact의 `dist/_headers`에 wildcard `script-src`와 `'unsafe-eval'`이 없는지 확인합니다.
- [ ] production 전환 후 OAuth state 불일치·만료·재사용, PKCE 실패, Turnstile action/hostname 불일치, 16 KiB 초과 JSON, GitHub timeout이 모두 표준 JSON 오류와 request ID를 반환하는지 운영 검증합니다. 이 검증은 정적 preview smoke의 범위가 아닙니다.
- [ ] `/api/auth/logout`이 POST에 204를 반환하고 세션 및 OAuth cookie를 삭제하는지 확인합니다.
- [ ] `/api/ready`가 production의 `APP_ENV`, 정확한 canonical HTTPS `APP_ORIGIN`, session secret, OAuth/GitHub App 자격 증명과 Turnstile secret/hostname을 검증하고 `x-miku-readiness-contract: runtime-config-v1`과 정확히 `{ "ready": true }`만 반환하는지 확인합니다. 미준비 응답은 값이나 누락된 변수 이름을 공개하지 않는 `{ "error": "service_not_ready", "requestId": "..." }` 503이어야 합니다.
- [ ] 빌드 artifact의 `release.json`이 GitHub commit SHA와 일치하는지 확인합니다. 배포 smoke는 Wrangler의 고유 `deployment-url`과 canonical origin에서 이 값을 각각 확인하므로 이전 정상 배포가 새 배포를 대신해 통과할 수 없습니다.

`main` push는 품질 검사만 실행합니다. production 배포는 main의 input 없는 `workflow_dispatch`에서만 시작하며, dispatch된 `github.sha`로 한 번 생성한 artifact를 enforced-CSP preview와 production이 순서대로 공유합니다. preview smoke가 통과한 뒤 production에 배포하고, post-deploy smoke가 고유 deployment URL과 canonical origin의 release marker 및 readiness를 확인합니다. 실패하면 이전 Pages deployment로 rollback합니다. 이 수동 경계를 유지하려면 Cloudflare Pages의 native Git production 자동 배포를 비활성화해야 합니다.
