import { useActionState, useEffect, useRef } from 'react'
import { X, Github, Send } from 'lucide-react'
import { TurnstileWidget } from '../../../components/TurnstileWidget'
import type { SubmissionSession } from '../submissionClient'
import { submitEditRequest, submitEventSubmission, githubLoginUrl } from '../submissionClient'
import type { CalendarEventSummary, EventOccurrence } from '../../data/types'
import { COMBINED_TIMEZONES, formatIsoWithOffset } from '../utils/timezone'

const eventTypeLabels: Record<string, string> = {
  concert: 'Concert',
  dj: 'DJ',
  popup: 'Popup',
  ticketApplication: 'Ticket apply',
  ticketGeneralSale: 'General sale',
  livestream: 'Livestream',
  exhibition: 'Exhibition',
  collaboration: 'Collab',
  announcement: 'Notice',
  other: 'Other',
}

type DialogState =
  | { kind: 'add' }
  | { kind: 'edit'; event: CalendarEventSummary; occurrence?: EventOccurrence }
  | null

interface EventSubmitDialogProps {
  dialog: DialogState
  setDialog: (state: DialogState) => void
  session: SubmissionSession
  turnstileToken: string | null
  setTurnstileToken: (token: string | null) => void
  submissionApiBaseUrl: string
  setSubmissionMessage: (msg: string | null) => void
}

export function EventSubmitDialog({
  dialog,
  setDialog,
  session,
  turnstileToken,
  setTurnstileToken,
  submissionApiBaseUrl,
  setSubmissionMessage,
}: EventSubmitDialogProps) {
  const dialogRef = useRef<HTMLDialogElement | null>(null)

  useEffect(() => {
    const dialogEl = dialogRef.current
    if (!dialogEl) return

    if (dialog) {
      if (!dialogEl.open) {
        dialogEl.showModal()
      }
    } else {
      if (dialogEl.open) {
        dialogEl.close()
      }
    }
  }, [dialog])

  const openLogin = () => {
    if (!submissionApiBaseUrl) {
      setSubmissionMessage('Submission API가 설정되지 않았습니다.')
      return
    }
    window.location.href = githubLoginUrl(submissionApiBaseUrl, window.location.href)
  }

  // React 19 Action State for adding event
  const [, addAction, addPending] = useActionState(
    async (_prevState: unknown, formData: FormData) => {
      try {
        const rawStartsAt = String(formData.get('startsAt') ?? '')
        const rawEndsAt = String(formData.get('endsAt') ?? '')
        const timezone = String(formData.get('timezone') ?? '')

        const startsAt = formatIsoWithOffset(rawStartsAt, timezone)
        const endsAt = rawEndsAt ? formatIsoWithOffset(rawEndsAt, timezone) : undefined

        const result = await submitEventSubmission(submissionApiBaseUrl, {
          title: String(formData.get('title') ?? ''),
          type: String(formData.get('type') ?? ''),
          startsAt,
          endsAt,
          timezone,
          snsUrl: String(formData.get('snsUrl') ?? ''),
          sourceUrl: String(formData.get('sourceUrl') ?? '') || undefined,
          note: String(formData.get('note') ?? '') || undefined,
          turnstileToken: turnstileToken || '',
        })
        setSubmissionMessage(result.url ? `PR 생성 요청이 접수되었습니다: ${result.url}` : 'PR 생성 요청이 접수되었습니다.')
        setDialog(null)
        setTurnstileToken(null)
        return { success: true }
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : '일정 추가 요청에 실패했습니다.'
        setSubmissionMessage(errorMsg)
        setTurnstileToken(null)
        return { success: false, error: errorMsg }
      }
    },
    null
  )

  // React 19 Action State for editing event
  const [, editAction, editPending] = useActionState(
    async (_prevState: unknown, formData: FormData) => {
      if (!dialog || dialog.kind !== 'edit') return null

      try {
        const result = await submitEditRequest(submissionApiBaseUrl, {
          eventId: dialog.event.id,
          occurrenceId: dialog.occurrence?.id,
          message: String(formData.get('message') ?? ''),
          sourceUrl: String(formData.get('sourceUrl') ?? '') || undefined,
          turnstileToken: turnstileToken || '',
        })
        setSubmissionMessage(result.url ? `수정 요청 이슈가 생성되었습니다: ${result.url}` : '수정 요청 이슈가 생성되었습니다.')
        setDialog(null)
        setTurnstileToken(null)
        return { success: true }
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : '수정 요청에 실패했습니다.'
        setSubmissionMessage(errorMsg)
        setTurnstileToken(null)
        return { success: false, error: errorMsg }
      }
    },
    null
  )

  const isSubmitting = addPending || editPending

  return (
    <dialog
      ref={dialogRef}
      className="event-dialog-backdrop"
      onClose={() => setDialog(null)}
    >
      {dialog ? (
        <div className="event-dialog">
          <div className="event-dialog-header">
            <div>
              <p>{session.authenticated ? `@${session.login ?? 'github-user'}` : 'GitHub login required'}</p>
              <h2>{dialog.kind === 'add' ? '일정 추가' : '수정 요청'}</h2>
            </div>
            <button aria-label="Close dialog" onClick={() => setDialog(null)} type="button">
              <X size={18} aria-hidden="true" />
            </button>
          </div>

          {!session.authenticated ? (
            <div className="event-login-panel">
              <p>GitHub 로그인 후 요청을 제출할 수 있습니다.</p>
              <button className="app-primary-button" onClick={openLogin} type="button">
                <Github size={16} aria-hidden="true" />
                GitHub 로그인
              </button>
            </div>
          ) : dialog.kind === 'add' ? (
            <form className="event-form" action={addAction}>
              <label>
                이벤트 제목
                <input name="title" required />
              </label>
              <label>
                종류
                <select name="type" required>
                  {Object.keys(eventTypeLabels).map((type) => (
                    <option key={type} value={type}>{eventTypeLabels[type]}</option>
                  ))}
                </select>
              </label>
              <label>
                시작 시간
                <input type="datetime-local" name="startsAt" required />
              </label>
              <label>
                종료 시간
                <input type="datetime-local" name="endsAt" />
              </label>
              <label>
                타임존
                <input
                  defaultValue={Intl.DateTimeFormat().resolvedOptions().timeZone}
                  name="timezone"
                  list="timezone-list"
                  required
                />
                <datalist id="timezone-list">
                  {COMBINED_TIMEZONES.map((tz) => (
                    <option key={tz} value={tz} />
                  ))}
                </datalist>
              </label>
              <label>
                SNS 링크
                <input name="snsUrl" placeholder="https://x.com/..." required />
              </label>
              <label>
                근거 링크
                <input name="sourceUrl" placeholder="https://..." />
              </label>
              <label>
                메모
                <textarea name="note" rows={4} />
              </label>
              <TurnstileWidget onVerify={setTurnstileToken} />
              <button className="app-primary-button" disabled={isSubmitting || !turnstileToken} type="submit">
                <Send size={16} aria-hidden="true" />
                PR 요청
              </button>
            </form>
          ) : (
            <form className="event-form" action={editAction}>
              <label>
                대상 이벤트
                <input readOnly value={dialog.event.id} />
              </label>
              <label>
                수정 요청 내용
                <textarea name="message" required rows={5} />
              </label>
              <label>
                근거 링크
                <input name="sourceUrl" placeholder="https://..." />
              </label>
              <TurnstileWidget onVerify={setTurnstileToken} />
              <button className="app-primary-button" disabled={isSubmitting || !turnstileToken} type="submit">
                <Send size={16} aria-hidden="true" />
                Issue 생성
              </button>
            </form>
          )}
        </div>
      ) : null}
    </dialog>
  )
}
