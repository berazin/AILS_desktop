import { useEffect, useState } from 'react'
import { officeRequest } from '../../lib/api/office.ts'
import { htmlPreview } from './html-preview.ts'

export function HtmlPreviewPanel({ path, source }: { path: string; source: string }) {
  const [html, setHtml] = useState(''), [error, setError] = useState('')
  useEffect(() => {
    let cancelled = false
    const timer = setTimeout(() => {
      void htmlPreview(source, relative => officeRequest('resource', { path, relative }))
        .then(value => { if (!cancelled) { setHtml(value); setError('') } })
        .catch(error => { if (!cancelled) setError(String(error)) })
    }, 250)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [path, source])
  return <div className="flex h-full min-w-0 flex-col">
    <div className="border-b border-[var(--border)] p-2 text-xs text-[var(--muted-foreground)]">HTML 미리보기 · 스크립트 및 외부 통신 차단</div>
    {error && <div role="alert">{error}</div>}
    <iframe title="HTML 미리보기" sandbox="" referrerPolicy="no-referrer" srcDoc={html} className="min-h-0 w-full flex-1 border-0 bg-white" />
  </div>
}
