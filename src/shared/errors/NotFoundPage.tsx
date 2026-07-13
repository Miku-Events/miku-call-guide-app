import { Button } from '@astryxdesign/core/Button'
import { RecoveryPageShell } from './RecoveryPageShell'

export function NotFoundPage() {
  return (
    <RecoveryPageShell>
      <section className="mx-auto flex max-w-2xl flex-col gap-4 px-4 py-12">
        <p className="text-sm font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]">404</p>
        <h1 className="text-2xl font-bold">페이지를 찾을 수 없습니다.</h1>
        <p className="text-[var(--color-text-secondary)]">
          주소가 바뀌었거나 더 이상 제공되지 않는 페이지입니다.
        </p>
        <div>
          <Button href="/" label="카탈로그로 돌아가기" variant="secondary" />
        </div>
      </section>
    </RecoveryPageShell>
  )
}
