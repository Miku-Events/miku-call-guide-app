import { useEffect } from 'react'
import { AppPageShell } from '../../shared/layout/AppPageShell'
import './privacy.css'

const PRIVACY_CONTACT = '***REMOVED***'

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
          카탈로그와 이벤트 일정 조회에는 로그인이 필요하지 않습니다. 아래 정보는 일정 제보나
          수정 요청 기능을 이용할 때만 처리됩니다.
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
            남용을 확인합니다. 이 앱은 사용자 행동 분석 도구를 사용하지 않습니다.
          </p>
        </section>

        <section aria-labelledby="privacy-contact">
          <h2 id="privacy-contact">삭제·개인정보·보안 문의</h2>
          <p>
            저장된 제출 정보의 확인 또는 삭제와 개인정보·보안 문의는{' '}
            <a href={`mailto:${PRIVACY_CONTACT}`}>{PRIVACY_CONTACT}</a>로 보내 주세요.
          </p>
        </section>
      </article>
    </AppPageShell>
  )
}
