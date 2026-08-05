# 운영 보안 체크리스트

이 문서는 저장소 코드만으로 적용할 수 없는 **외부 운영 설정**을 기록합니다. 아래 항목은 Cloudflare와 GitHub 관리 콘솔에서 운영자가 직접 적용하고, 배포 전 별도 계정으로 재확인해야 합니다.

## 1. Cloudflare custom domain과 보호 범위

- [ ] primary public origin은 GitHub의 `VITE_APP_ORIGIN` repository variable 한 곳에서 선택하고, 현재 값이 `https://miku.sekai.today`인지 확인합니다.
- [ ] 해당 hostname이 Pages 프로젝트의 Custom domains에 `Active` 상태로 연결되어 있고 브라우저 location을 유지한 채 응답하는지 확인합니다. `pages.dev`로 보내는 redirect rule은 두지 않습니다.
- [ ] 새 custom domain은 Pages 연결과 인증서 활성화를 먼저 끝낸 뒤 primary origin으로 전환하고, 이전 domain은 production smoke가 통과한 뒤 제거합니다.
- [ ] custom zone의 WAF rule이 `pages.dev` preview나 immutable deployment URL에도 적용된다고 가정하지 않습니다.
- [ ] 현재 구성에는 application rate limiter, Workers Rate Limiting binding, KV, Durable Object 또는 별도 limiter Worker를 추가하지 않습니다.
- [ ] `CLOUDFLARE_WRITE_RATE_LIMIT_CONFIGURED` 같은 확인 표식만으로 limiter가 존재하는 것처럼 보고하지 않습니다.
- [ ] Cloudflare의 자동 DDoS 보호, Turnstile 및 Pages Functions 할당량은 각각 별도 보호 계층이며 application rate limit과 동일한 계약으로 설명하지 않습니다.
- [ ] custom zone에서 HTML을 다시 쓰는 Zaraz auto-injection, Google Tag Gateway, JavaScript Detection과 Cache Everything 규칙을 점검합니다. nonce 연동을 별도로 검증하지 않은 inline injection은 비활성화하고, HTML cache rule을 제거한 뒤 zone cache를 purge합니다.

쓰기 API는 GitHub session, Turnstile action/hostname, JSON content type, 16 KiB body 제한과 입력 길이 제한을 계속 적용합니다. 향후 proxied custom domain을 도입할 때만 해당 zone에서 제공하는 WAF rate limiting을 별도 변경으로 재검토합니다.

## 2. Turnstile

- [ ] production Turnstile widget을 생성하고 허용 hostname을 실제 production hostname으로 제한합니다.
- [ ] production에 `VITE_CLOUDFLARE_TURNSTILE_SITE_KEY`와 `CLOUDFLARE_TURNSTILE_SECRET_KEY`를 설정합니다. 서버는 검증 응답의 hostname을 현재 API `Request.url`의 hostname과 비교합니다.
- [ ] production에 Cloudflare 공식 테스트 키, `YOUR_`, `changeme`, `replace-with-*` 값을 넣지 않습니다.
- [ ] 제출은 `event_submit`, 수정 요청은 `event_edit` action으로 검증되는지 확인합니다.

배포 workflow의 preview는 동일한 정적 artifact와 enforced CSP를 검증하는 기술 smoke입니다. OAuth나 Turnstile 제출을 실행하지 않으므로 별도 preview widget 또는 live auth secret을 요구하지 않습니다.

## 3. GitHub OAuth와 GitHub App

- [ ] 현재 custom domain과 domain 전환 중 함께 제공할 각 origin의 `${origin}/api/auth/github/callback`을 GitHub App callback URL에 등록합니다. authorize/token 요청은 현재 request origin의 callback을 명시합니다.
- [ ] OAuth authorize 요청이 공개 `id`와 `login` 확인에 불필요한 `read:user` scope를 요청하지 않는지 확인합니다.
- [ ] `GITHUB_OAUTH_CLIENT_ID`와 `GITHUB_OAUTH_CLIENT_SECRET`을 production 환경 secret으로 저장합니다.
- [ ] GitHub App 설치 대상을 `miku-call-guide-data` 저장소 하나로 제한합니다.
- [ ] Repository permissions는 `Contents: Read and write`, `Pull requests: Read and write`, `Issues: Read and write`, `Metadata: Read-only`만 허용합니다.
- [ ] `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_APP_INSTALLATION_ID`, `GITHUB_DATA_OWNER`, `GITHUB_DATA_REPO`, `GITHUB_DATA_BASE_BRANCH`를 production 환경에 설정합니다.
- [ ] `GITHUB_APP_PRIVATE_KEY`에는 GitHub App에서 내려받은 비암호화 `RSA PRIVATE KEY`(PKCS#1) 또는 `PRIVATE KEY`(PKCS#8) PEM 전체를 저장합니다. 실제 줄바꿈과 `\n` 형식 모두 지원하며, 헤더·푸터를 제거하거나 encrypted/EC/OpenSSH 키로 바꾸지 않습니다.
- [ ] private key와 OAuth client secret의 교체 주기 및 폐기 담당자를 기록합니다.

## 4. 세션·origin·Cloudflare API token

- [ ] production의 `APP_ENV=production`을 명시합니다. runtime origin은 설정값이 아니라 Cloudflare가 전달한 표준 `Request.url`에서 파생하며, CORS는 같은 request origin만 허용합니다.
- [ ] `VITE_APP_ORIGIN`에는 SEO metadata가 가리킬 primary public HTTPS origin을 설정합니다. hostname은 canonical 소문자를 사용하고 후행 `/`, 기본 포트 `:443`, path/query/fragment, credentials, 바깥 공백을 넣지 않습니다.
- [ ] `wrangler.toml`에는 hostname별 `APP_ORIGIN` 또는 `TURNSTILE_EXPECTED_HOSTNAME` binding을 두지 않습니다. domain 변경이 Functions 재구성에 의존하지 않는지 확인합니다.
- [ ] production `SESSION_SECRET`은 32 UTF-8 bytes 이상의 고유 난수로 생성합니다.
- [ ] Cloudflare deploy token은 대상 계정 하나와 Pages 배포에 필요한 `Cloudflare Pages: Edit` 권한만 부여합니다. DNS·Workers·다른 계정 권한은 부여하지 않습니다. Cloudflare API token은 개별 Pages project로 resource를 제한할 수 없으므로 project 단위 격리가 필수라면 `miku-call-guide-app` 전용 account를 사용합니다.
- [ ] GitHub 무료 private 저장소에서는 environment required reviewer를 전제로 하지 않습니다. 보호된 `main`에 PR을 merge하면 push workflow가 production 설정을 검증하고 preview smoke 통과 후 자동 승격합니다. 복구나 동일 절차 재실행에는 `main`에서 input 없는 `workflow_dispatch`를 사용합니다. release ID는 실행 대상 `github.sha`에서 자동 생성합니다.
- [ ] `CLOUDFLARE_API_TOKEN`과 `CLOUDFLARE_ACCOUNT_ID`는 GitHub Actions secret으로, Pages Function의 session/OAuth/GitHub App/Turnstile 값은 Cloudflare Pages production 환경 secret으로 저장합니다.

## 5. 배포 전후 확인

- [ ] Cloudflare Pages Web Analytics 설정은 유지하고, 정적 CSP는 공식 beacon과 collector origin인 `static.cloudflareinsights.com`, `cloudflareinsights.com`만 허용하는지 확인합니다.
- [ ] 동일한 artifact의 enforced CSP를 preview와 production에서 사용합니다. preview와 실제 custom domain browser smoke는 `/`, `/#/events`, `/#/songs/39-music`을 순회하며 origin 이탈, CSP violation, page error 또는 lazy chunk MIME 오류가 있으면 실패합니다. console 메시지는 진단으로 기록하되 단독 실패 조건으로 사용하지 않습니다.
- [ ] preview 정적 응답과 production 정적·Function 응답이 모두 `Content-Security-Policy`를 반환하고 `Content-Security-Policy-Report-Only`를 반환하지 않는지 확인합니다.
- [ ] production artifact의 `dist/_headers`에 wildcard `script-src`, `'unsafe-eval'`, `'unsafe-inline'` script 허용과 일시적인 inline script hash가 없는지 확인합니다.
- [ ] HTML 응답이 `Cache-Control: no-cache, no-transform`을 포함하고, fingerprint asset은 올바른 JavaScript/CSS MIME으로 응답하며, 존재하지 않는 asset이 `index.html` 200으로 fallback하지 않는지 확인합니다.
- [ ] production 전환 후 OAuth state 불일치·만료·재사용, PKCE 실패, Turnstile action/hostname 불일치, 16 KiB 초과 JSON, GitHub timeout이 모두 표준 JSON 오류와 request ID를 반환하는지 운영 검증합니다. 이 검증은 정적 preview smoke의 범위가 아닙니다.
- [ ] `/api/auth/logout`이 POST에 204를 반환하고 세션 및 OAuth cookie를 삭제하는지 확인합니다.
- [ ] `/api/ready`가 production의 `APP_ENV`, session secret, OAuth/GitHub App 자격 증명과 Turnstile secret을 검증하고 `x-miku-readiness-contract: runtime-config-v1`과 정확히 `{ "ready": true }`만 반환하는지 확인합니다. 미준비 응답은 값이나 누락된 변수 이름을 공개하지 않는 `{ "error": "service_not_ready", "requestId": "..." }` 503이어야 합니다.
- [ ] 빌드 artifact의 `release.json`이 GitHub commit SHA와 일치하는지 확인합니다. 배포 smoke는 Wrangler의 고유 `deployment-url`과 canonical origin에서 이 값을 각각 확인하므로 이전 정상 배포가 새 배포를 대신해 통과할 수 없습니다.

`main` push는 production 설정을 검증한 뒤 한 번 생성한 artifact로 품질 검사와 E2E를 실행하고, 같은 artifact를 enforced-CSP preview와 production이 순서대로 공유합니다. preview smoke가 통과한 뒤 production에 자동 배포하고, custom-domain browser smoke와 post-deploy smoke가 location 유지, lazy route, 고유 deployment URL, primary origin의 release marker 및 readiness를 확인합니다. main의 input 없는 `workflow_dispatch`도 복구를 위해 같은 절차를 재실행합니다. 실패하면 이전 Pages deployment로 rollback합니다. 중복 배포와 경합을 막기 위해 Cloudflare Pages의 native Git production 자동 배포는 비활성화해야 합니다.
