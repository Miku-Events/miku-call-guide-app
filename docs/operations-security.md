# 운영 보안 체크리스트

저장소 코드로 적용할 수 없는 GitHub·Cloudflare 설정만 기록합니다. 완료 표시는 실제 설정과
배포 결과를 확인한 뒤에만 합니다.

## Pages와 secret

- [ ] Pages production branch는 `main`으로 두고 native Git 배포는 끕니다.
- [ ] custom domain의 TLS를 확인하고, `miku-call-guide-app.pages.dev`는 path/query를 보존해 custom
  domain으로 redirect합니다. 그 밖의 `pages.dev` hostname에서는 OAuth와 쓰기가 거부되어야 합니다.
- [ ] preview/production environment를 `main`으로 제한하고 각각 최소 권한
  `CLOUDFLARE_PREVIEW_API_TOKEN`/`CLOUDFLARE_PRODUCTION_API_TOKEN`을 사용합니다.
- [ ] account ID, app/data origin과 Turnstile site key는 repository variable에만 둡니다.
- [ ] OAuth, GitHub App, session, Turnstile runtime secret은 production Pages에만 저장합니다.
- [ ] repository-level deploy secret은 두지 않고 input 없는 `workflow_dispatch`로 환경별 token을 확인합니다.

## 외부 서비스

- [ ] production Turnstile hostname과 GitHub OAuth callback을 `miku.sekai.today`로 제한합니다.
- [ ] GitHub App은 private data 저장소 하나에 Contents/PR/Issues write와 Metadata read만 가집니다.
- [ ] Web Analytics, Tag Gateway, Zaraz, 자동 JavaScript 삽입과 HTML 변환/cache rule은 끕니다.

## 남용 대응

- [ ] `ops/cloudflare/waf-rate-limit-rule.json`을 custom zone에 적용하고, 동일 IP의 1–10번째 요청은
  허용, 11번째는 JSON 429, 10초 뒤 복구되는지 확인합니다.
- [ ] `pages.dev`에는 WAF가 적용된다고 가정하지 않고 앱의 origin/preview 차단을 별도로 확인합니다.
- [ ] 24시간 내 유효 제출 20건 초과, 1시간 내 rollback 실패 5건 초과, 또는 GitHub quota 20% 미만이면
  WAF와 `SUBMISSION_WRITES_ENABLED=false`로 쓰기를 중단합니다. D1/DO 도입 전에는 재개하지 않습니다.

이 WAF 규칙은 burst 완화용이며 분산 공격에 대한 정확한 전역 quota가 아닙니다.

## GitHub 설정

- [ ] 계정·조직 2FA와 복구 수단을 설정합니다.
- [ ] PR 필수(승인 0), conversation 해결, 최신 base, linear history, force-push/delete 금지와
  `Quality and build`, `Node 24 compatibility`, `Built-artifact E2E` required checks를 적용합니다.
- [ ] GitHub-owned Actions와 `cloudflare/wrangler-action`만 허용하고 full SHA, read-only token,
  외부 contributor 실행 승인을 강제합니다.
- [ ] dependency graph, Dependabot, Secret Scanning/Push Protection, private vulnerability reporting과
  CodeQL을 켭니다. CodeQL 첫 성공 뒤 required check에 추가합니다.
- [ ] squash merge와 merge 후 branch 삭제를 켭니다.

## 확인

- [ ] quality/functions/E2E/high audit/signature gate가 모두 통과해야 합니다.
- [ ] 자동 smoke에서 alias redirect, custom/immutable auth 정책, readiness, 대표 데이터 leaf,
  preview read-only UI, 보안 헤더와 release marker가 모두 통과해야 합니다.
- [ ] 제출자 login은 private PR/Issue에만 있고 YAML에는 없는지 표본 확인합니다.
- [ ] 개인정보·보안 연락처가 `***REMOVED***`인지 확인합니다.
