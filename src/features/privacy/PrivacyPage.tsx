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
          카탈로그와 이벤트 일정은 별도의 로그인 없이 이용할 수 있습니다. 공식 사이트에서는 방문 통계를
          처리합니다.
        </p>

        <section aria-labelledby="privacy-processors">
          <h2 id="privacy-processors">외부 처리 서비스</h2>
          <p>Cloudflare는 앱 호스팅, 네트워크 보안과 요청 처리를 제공합니다.</p>
          <p>
            Cloudflare Web Analytics를 사용해 방문자 수, 방문 페이지와 성능 지표를 분석합니다. 분석
            데이터는 Cloudflare가 처리하며, Cloudflare의 설명에 따르면 Web Analytics는 쿠키나
            localStorage를 사용하지 않고 개인 식별을 위한 핑거프린팅도 하지 않습니다.
          </p>
        </section>
      </article>
    </AppPageShell>
  )
}
