import { useEffect } from 'react'
import { AppPageShell } from '../../shared/layout/AppPageShell'
import './privacy.css'

export function PrivacyPage() {
  useEffect(() => {
    document.title = '개인정보 처리 안내 - 하츠네 미쿠 콜 가이드'
  }, [])

  return (
    <AppPageShell
      activeNav="privacy"
      className="privacy-shell"
      height="auto"
      kicker="Privacy"
      summaryItems={[]}
      title="개인정보 처리 안내"
    >
      <article className="privacy-content">
        <p className="privacy-lead">
          카탈로그와 이벤트 일정 조회에는 로그인이 필요하지 않습니다. 공식 사이트에서는 모든 페이지의
          방문 통계를 처리하며, GitHub 계정 정보는 일정 제보나 수정 요청 기능을 이용할 때만 처리됩니다.
        </p>

        <section aria-labelledby="privacy-session">
          <h2 id="privacy-session">로그인과 세션</h2>
          <ul>
            <li>서명된 HttpOnly 세션 쿠키에 GitHub의 변경되지 않는 사용자 ID와 현재 login을 저장합니다.</li>
            <li>세션은 발급 후 최대 7일 동안 유효하며, 로그아웃하면 브라우저의 세션 쿠키를 삭제합니다.</li>
            <li>GitHub OAuth access token은 callback에서 신원을 확인하는 데만 사용하고 별도로 저장하지 않습니다.</li>
          </ul>
        </section>

        <section aria-labelledby="privacy-submission">
          <h2 id="privacy-submission">제보와 수정 요청</h2>
          <ul>
            <li>제출 내용과 GitHub login은 비공개 data 저장소의 Pull Request 또는 Issue에 보관됩니다.</li>
            <li>공개 앱이 읽는 이벤트 YAML에는 제출자의 GitHub login을 저장하지 않습니다.</li>
            <li>제출 전 이 처리와 계정 표시에 명시적으로 동의해야 합니다.</li>
          </ul>
        </section>

        <section aria-labelledby="privacy-processors">
          <h2 id="privacy-processors">외부 처리 서비스</h2>
          <p>
            Cloudflare는 앱 호스팅, 네트워크 보안과 요청 처리를 제공하고, Turnstile은 제출 시 자동화된
            남용을 확인합니다.
          </p>
          <p>
            방문·이용 통계를 위해 Google Analytics를 사용합니다. Google Analytics는 방문 페이지,
            유입 경로, 브라우저·기기 정보와 IP 기반의 대략적인 지역을 처리하며, <code>_ga</code> 계열
            쿠키를 <code>.sekai.today</code> 범위에 설정할 수 있습니다. 주요 측정 요청은 Cloudflare
            Google Tag Gateway를 거쳐 Google로 전달되며, 태그 상태 확인 요청은 Google로 직접 전송될
            수 있습니다.
          </p>
        </section>
      </article>
    </AppPageShell>
  )
}
