import { useMemo, useState, type ReactNode } from "react"
import { ChevronDown, Check, Copy, Loader2, Plus, X } from "lucide-react"
import { t } from "../../../lib/i18n.ts"
import { Button } from "../../../shared/ui/button.tsx"
import { buildPdfOutlineTree, type PdfOutlineNode } from "../../../lib/pdf-outline.ts"
import { detailDate, documentProcessingLabels, formatStudyDuration, type DocumentDetailOcrJob } from "../lib/document-detail-presentation.ts"
import type { DocumentDetailController } from "../hooks/use-document-detail.ts"
import type { MaterialItem } from "../hooks/use-materials-listing.ts"
import type { MaterialContextTarget } from "../../../lib/material-navigation.ts"

type DetailProps = { detailedModalItem: MaterialItem; detail: DocumentDetailController }
function InfoRows({ rows }: { rows: { label: string; value: ReactNode }[] }) {
  return <dl className="ails-properties-rows">{rows.map(row => <div key={row.label}>
    <dt>{row.label}</dt><dd>{row.value}</dd>
  </div>)}</dl>
}

export function DocumentDetailGeneral({ detailedModalItem, detail, activeOcrJob, copied, copyPath }: DetailProps & {
  activeOcrJob?: DocumentDetailOcrJob; copied: boolean; copyPath: () => void
}) {
  const { position, ocrStatus, ocrLoading, ocrError } = detail
  const status = documentProcessingLabels(detailedModalItem, ocrStatus, ocrLoading, ocrError)
  const lastOpened = detailDate(detailedModalItem.lastOpenedAt)
  return <>
    <InfoRows rows={[
      { label: t("파일 크기"), value: detailedModalItem.size || t("정보 없음") },
      ...(["PDF", "PPT", "PPTX"].includes(detailedModalItem.kind)
        ? [{ label: t("페이지 수"), value: position.total ? `${position.total} ${t("페이지")}` : ocrLoading ? t("확인 중…") : t("정보 없음") }] : []),
      ...(detailedModalItem.kind === "folder" && detailedModalItem.itemCount !== undefined
        ? [{ label: t("항목 수"), value: `${detailedModalItem.itemCount}${t("개")}` }] : []),
      { label: t("파일 경로"), value: <div className="ails-properties-path">
        <input aria-label={t("파일 경로")} readOnly value={detailedModalItem.path} title={detailedModalItem.path} />
        <Button aria-label={copied ? t("복사됨!") : t("경로 복사")} title={copied ? t("복사됨!") : t("경로 복사")} onClick={copyPath} size="icon" variant="ghost" type="button">
          {copied ? <Check size={14} /> : <Copy size={14} />}
        </Button>
      </div> },
      { label: t("마지막 열람"), value: lastOpened },
    ]} />
    {detailedModalItem.kind !== "folder" && <div className="ails-properties-reading">
      <div className="flex flex-wrap justify-between gap-1">
        <span>{t("열람 위치")}</span>
        <span className="tabular-nums">{position.page !== null
          ? position.total ? `p.${position.page} / ${position.total} · ${t("남은 분량")} ${position.remaining}p` : `p.${position.page} · ${t("총 분량 정보 없음")}`
          : ["PDF", "PPT", "PPTX"].includes(detailedModalItem.kind) ? t("저장된 열람 위치 없음") : detailedModalItem.readRange || t("페이지 단위 정보 없음")}</span>
      </div>
      {position.percent !== null && <div className="ails-properties-progress" role="progressbar" aria-label={t("문서 열람 위치")}
        aria-valuemin={0} aria-valuemax={100} aria-valuenow={position.percent} aria-valuetext={`p.${position.page} / ${position.total}`}>
        <span style={{ width: `${position.percent}%` }} />
      </div>}
      <p className="ails-properties-hint">{t("열람 위치는 학습 완료를 의미하지 않습니다.")}</p>
    </div>}
    {detailedModalItem.kind !== "folder" && <div className="ails-properties-group">
      <h3>{t("현재 처리 상태")}</h3>
      {activeOcrJob && <p className="ails-properties-active-work" role="status"><Loader2 size={13} className="animate-spin motion-reduce:animate-none" />
        <span>{activeOcrJob.cancelPending ? t("취소 처리 중") : activeOcrJob.phase || t("OCR 진행 중")}
          {activeOcrJob.progress.total > 0 ? ` · ${activeOcrJob.progress.page}/${activeOcrJob.progress.total}` : ""}</span>
      </p>}
      <InfoRows rows={[
        { label: t("OCR 텍스트"), value: status.ocr },
        { label: t("검색 색인"), value: status.indexing },
        ...(detailedModalItem.kind === "PDF" || detailedModalItem.problemCount !== undefined
          ? [{ label: t("감지된 문제"), value: detailedModalItem.problemCount !== undefined ? `${detailedModalItem.problemCount}${t("개")}` : t("분석 결과 없음") }] : []),
        ...(detailedModalItem.sttStatus ? [{ label: t("음성 분석"), value: detailedModalItem.sttStatus }] : []),
      ]} />
      {ocrError && <p className="ails-properties-error" role="alert">{ocrError}</p>}
    </div>}
    <details className="ails-properties-disclosure">
      <summary>{t("고급 정보")}</summary>
      <InfoRows rows={[
        { label: t("수정일"), value: detailDate(detailedModalItem.timestamp, t("정보 없음")) },
        ...(detailedModalItem.title !== detailedModalItem.path.split(/[\\/]/).pop()
          ? [{ label: t("자료 제목"), value: detailedModalItem.title }] : []),
        ...(ocrStatus?.language ? [{ label: t("문서 언어"), value: ocrStatus.language }] : []),
        ...(ocrStatus?.engine ? [{ label: t("OCR 엔진"), value: ocrStatus.engine }] : []),
        ...(ocrStatus?.model_variant ? [{ label: t("OCR 모델"), value: ocrStatus.model_variant }] : []),
        ...(ocrStatus?.index_source ? [{ label: t("색인 출처"), value: ocrStatus.index_source }] : []),
        ...(ocrStatus?.pipeline ? [{ label: t("분석 경로"), value: ocrStatus.pipeline }] : []),
        ...(ocrStatus?.analysis?.created_at ? [{ label: t("분석 일시"), value: detailDate(ocrStatus.analysis.created_at) }] : []),
      ]} />
    </details>
  </>
}

function DocumentOutline({ detailedModalItem, detail, onOpenAtPage }: DetailProps & { onOpenAtPage?: (path: string, page: number) => void }) {
  const [toggled, setToggled] = useState<Set<string>>(() => new Set())
  const tree = useMemo(() => buildPdfOutlineTree(detail.modalOutline), [detail.modalOutline])
  function renderNodes(nodes: PdfOutlineNode[], depth: number): ReactNode {
    return nodes.map(node => {
      const expanded = depth === 0 ? !toggled.has(node.id) : toggled.has(node.id)
      const current = detail.modalCurrentChapter?.startPage === node.page
      return <li key={node.id}>
        <div className="ails-properties-outline-row" style={{ paddingLeft: Math.min(depth, 8) * 12 }}>
          {node.children.length ? <button type="button" aria-label={`${expanded ? t("접기") : t("펼치기")} · ${node.title}`}
            aria-expanded={expanded} onClick={() => setToggled(previous => { const next = new Set(previous); if (next.has(node.id)) next.delete(node.id); else next.add(node.id); return next })}>
            <ChevronDown size={12} className={expanded ? "" : "-rotate-90"} />
          </button> : <span className="w-5 shrink-0" />}
          <button type="button" disabled={!onOpenAtPage} aria-current={current ? "location" : undefined}
            title={`${node.title} · p.${node.page}`} onClick={() => onOpenAtPage?.(detailedModalItem.path, node.page)}>
            <span>{node.title}</span><span className="tabular-nums">p.{node.page}</span>
          </button>
        </div>
        {node.children.length > 0 && expanded && <ul>{renderNodes(node.children, depth + 1)}</ul>}
      </li>
    })
  }
  return tree.length ? <ul className="ails-properties-outline">{renderNodes(tree, 0)}</ul>
    : <p className="ails-properties-hint">{detail.ocrLoading ? t("불러오는 중…") : detail.ocrError ? t("목차를 불러오지 못했습니다.") : t("감지된 목차가 없습니다.")}</p>
}

export function DocumentDetailLearning({ detailedModalItem, detail, onOpenAtPage, onGeneratePractice, onSolvePractice, practiceSet }: DetailProps & {
  onOpenAtPage?: (path: string, page: number) => void
  onGeneratePractice?: (target: MaterialContextTarget) => void
  onSolvePractice?: (path: string) => void
  practiceSet?: { valid: boolean; question_count: number; errors?: string[] } | null
}) {
  const { modalStudyInfo, studyLoading, studyError, modalCurrentChapter } = detail
  const status = documentProcessingLabels(detailedModalItem, detail.ocrStatus, detail.ocrLoading, detail.ocrError)
  if (detailedModalItem.kind !== "PDF") return <>
    <p className="ails-properties-empty">{t("이 파일 형식의 학습 시간·세션 통계는 제공되지 않습니다.")}</p>
    <InfoRows rows={[
      { label: t("정리본 상태"), value: detailedModalItem.summaryDone === true ? t("정리본 파일") : detailedModalItem.summaryDone === false ? t("미생성") : t("정보 없음") },
      ...(practiceSet ? [{ label: t("연습문제"), value: `${practiceSet.question_count}${t("개")}` }] : []),
    ]} />
    {detailedModalItem.kind === "MD" && <div className="mt-3 flex flex-wrap gap-2">
      {onGeneratePractice && <Button size="sm" variant="outline" onClick={() => onGeneratePractice({ path: detailedModalItem.path,
        fileName: detailedModalItem.path.split(/[\\/]/).pop() || detailedModalItem.title, title: detailedModalItem.title, kind: "md" })}>{t("연습문제 만들기")}</Button>}
      {practiceSet && onSolvePractice && <Button size="sm" variant="outline" disabled={!practiceSet.valid} onClick={() => onSolvePractice(detailedModalItem.path)}>{t("풀기")}</Button>}
      {practiceSet && !practiceSet.valid && <p className="ails-properties-error" role="alert">{t("연습문제 형식 오류")}: {practiceSet.errors?.join("; ")}</p>}
    </div>}
  </>
  return <>
    {studyError ? <p className="ails-properties-error" role="alert">{t("학습 정보를 불러오지 못했습니다.")} {studyError}</p>
      : <dl className="ails-properties-statistics">{[
        [t("총 학습 시간"), modalStudyInfo ? formatStudyDuration(modalStudyInfo.study.total_active_seconds) : t("불러오는 중…")],
        [t("학습 세션"), modalStudyInfo ? `${modalStudyInfo.study.session_count}${t("회")}` : "—"],
        [t("북마크"), modalStudyInfo ? `${modalStudyInfo.bookmarks.length}${t("개")}` : "—"],
        [t("페이지 메모"), modalStudyInfo ? `${modalStudyInfo.memos.length}${t("개")}` : "—"],
      ].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>}
    {!studyLoading && modalStudyInfo?.study.session_count === 0 && <p className="ails-properties-hint">{t("집계된 학습 세션이 없습니다. 1분 이상 열람한 세션부터 집계합니다.")}</p>}
    <p className="ails-properties-hint">{t("학습 시간은 무조작 시간을 최대 30분까지 포함합니다.")}</p>
    {modalCurrentChapter && <InfoRows rows={[{ label: t("현재 챕터"), value: <button className="ails-properties-text-link" disabled={!onOpenAtPage}
      onClick={() => onOpenAtPage?.(detailedModalItem.path, modalCurrentChapter.startPage)}>{modalCurrentChapter.title}</button> }]} />}
    <details className="ails-properties-disclosure">
      <summary>{t("최근 학습 기록 · 북마크와 페이지 메모")}</summary>
      <p className="ails-properties-hint">{t("저장된 북마크·메모를 최신순으로 표시합니다.")}</p>
      {studyLoading ? <p className="ails-properties-hint">{t("불러오는 중…")}</p> : modalStudyInfo && <>
        <h4>{t("북마크")}</h4>
        {modalStudyInfo.bookmarks.length ? <ul className="ails-properties-records">{[...modalStudyInfo.bookmarks].sort((a, b) => b.created_at.localeCompare(a.created_at)).map(bookmark => <li key={bookmark.bookmark_id}>
          <button type="button" disabled={!onOpenAtPage} onClick={() => onOpenAtPage?.(detailedModalItem.path, bookmark.page)}>
            <span className="tabular-nums">p.{bookmark.page}</span><span className="min-w-0 flex-1">{bookmark.label || t("북마크")}</span><time>{detailDate(bookmark.created_at)}</time>
          </button>
        </li>)}</ul> : <p className="ails-properties-hint">{t("북마크가 없습니다. 문서의 북마크 버튼으로 추가할 수 있습니다.")}</p>}
        <h4>{t("페이지 메모")}</h4>
        {modalStudyInfo.memos.length ? <ul className="ails-properties-records">{[...modalStudyInfo.memos].sort((a, b) => b.updated_at.localeCompare(a.updated_at)).map(memo => <li key={memo.annotation_id}>
          <button type="button" disabled={!onOpenAtPage} onClick={() => onOpenAtPage?.(detailedModalItem.path, memo.page)}>
            <span className="tabular-nums">p.{memo.page}</span><span className="min-w-0 flex-1 whitespace-pre-wrap">{memo.text}</span><time>{detailDate(memo.updated_at)}</time>
          </button>
        </li>)}</ul> : <p className="ails-properties-hint">{t("PDF 뷰어에서 페이지를 클릭해 메모를 남길 수 있습니다.")}</p>}
      </>}
    </details>
    <details className="ails-properties-disclosure"><summary>{t("목차")}</summary>
      <DocumentOutline detailedModalItem={detailedModalItem} detail={detail} onOpenAtPage={onOpenAtPage} />
    </details>
    <details className="ails-properties-disclosure" open><summary>{t("개인 메모")}</summary>
      <textarea aria-label={t("개인 메모")} className="ails-properties-input" rows={2} disabled={!modalStudyInfo}
        placeholder={t("이 파일에 대한 메모를 남기세요.")} value={detail.modalNoteDraft}
        onChange={event => { detail.setModalNoteDraft(event.target.value); detail.setModalNoteSaved(false) }} />
      <div className="mt-2 flex items-center justify-between gap-2"><span className="ails-properties-hint" role="status">{detail.modalNoteSaved ? t("저장됨") : ""}</span>
        <Button size="sm" variant="outline" disabled={!modalStudyInfo || detail.modalNoteSaving} onClick={() => void detail.saveModalNote()}>{detail.modalNoteSaving ? t("저장 중…") : t("메모 저장")}</Button>
      </div>
    </details>
    <details className="ails-properties-disclosure"><summary>{t("태그")}</summary>
      <div className="ails-properties-tags">{modalStudyInfo?.tags.map(tag => <span key={tag}>{tag}
        <button type="button" aria-label={`${t("태그 삭제")} · ${tag}`} disabled={detail.modalTagsSaving}
          onClick={() => void detail.saveModalTags(modalStudyInfo.tags.filter(value => value !== tag))}><X size={11} /></button>
      </span>)}{modalStudyInfo?.tags.length === 0 && <span className="ails-properties-hint">{t("태그가 없습니다.")}</span>}</div>
      <div className="mt-2 flex gap-2"><input className="ails-properties-input min-w-0 flex-1" aria-label={t("태그 추가")}
        disabled={!modalStudyInfo || detail.modalTagsSaving} placeholder={t("태그 추가 후 Enter")} value={detail.modalTagDraft}
        onChange={event => detail.setModalTagDraft(event.target.value)} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); detail.addModalTag() } }} />
        <Button size="sm" variant="outline" disabled={!modalStudyInfo || detail.modalTagsSaving || !detail.modalTagDraft.trim()} onClick={detail.addModalTag}><Plus size={12} />{t("추가")}</Button>
      </div><p className="ails-properties-hint">{t("태그는 홈 화면 검색에 사용됩니다.")}</p>
    </details>
    <details className="ails-properties-disclosure"><summary>{t("AI 분석 결과와 정리본")}</summary>
      <InfoRows rows={[
        { label: t("문서 분석"), value: status.analysis },
        { label: t("정리본 상태"), value: detailedModalItem.summaryDone === true ? t("생성 완료") : detailedModalItem.summaryDone === false ? t("미생성") : t("정보 없음") },
      ]} />
    </details>
    {detail.saveError && <p className="ails-properties-error" role="alert">{detail.saveError}</p>}
  </>
}
