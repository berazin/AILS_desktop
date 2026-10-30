import { useState } from "react"
import { coverAspectCache, getPdfThumbnailUrl } from "../../pdf/components/pdf-thumbnail.ts"

export function StudyCardCover({
  card,
  lastPage,
  className,
  onThumbnailAspect,
  compact = false,
}: {
  card: { title: string; coverTheme?: string; path: string; kind: string }
  lastPage: number
  className?: string
  onThumbnailAspect?: (aspect: number | null) => void
  compact?: boolean
}) {
  const [imageError, setImageError] = useState(false)
  const isSample = card.path.startsWith("sample-")
  const isEpub = card.kind?.toUpperCase() === "EPUB"
  const kindUpper = card.kind?.toUpperCase() || ""
  // 썸네일은 항상 첫 장을 보여준다. PPT/PPTX는 LibreOffice 변환 PDF의 첫 장을 쓴다.
  const hasRenderedThumbnail = kindUpper === "PDF" || kindUpper === "PPT" || kindUpper === "PPTX"
  const thumbnailUrl = hasRenderedThumbnail && !isSample ? getPdfThumbnailUrl(card.path, 1) : null
  const baseSize = className || "h-44 w-32"

  if (thumbnailUrl && !imageError) {
    return (
      <div
        className={`group/cover relative flex shrink-0 overflow-hidden rounded-xl border border-slate-200/90 bg-slate-100 shadow-md transition-all duration-200 group-hover:scale-[1.03] group-hover:shadow-lg dark:border-white/[0.1] dark:bg-[#1a1d2e] ${baseSize}`}
      >
        <img
          alt={card.title}
          className="h-full w-full object-contain"
          loading="lazy"
          onError={() => setImageError(true)}
          onLoad={(event) => {
            const img = event.currentTarget
            const value =
              img.naturalWidth > 0 && img.naturalHeight > 0 ? img.naturalWidth / img.naturalHeight : null
            if (value != null) coverAspectCache.set(card.path, value)
            onThumbnailAspect?.(value)
          }}
          src={thumbnailUrl}
        />

        {/* 우측 상단 종류 뱃지 */}
        {!compact && <span className="absolute top-1.5 right-1.5 z-10 rounded-md bg-rose-500/90 backdrop-blur-xs px-1.5 py-0.5 font-sans text-[9px] font-bold text-white shadow-xs">
          {card.kind || "PDF"}
        </span>}

        {/* 우측 하단 페이지 뱃지 */}
        {!compact && <span className="absolute bottom-1.5 right-1.5 z-10 rounded-md bg-black/75 backdrop-blur-xs px-1.5 py-0.5 font-mono text-[9px] font-semibold text-white shadow-xs">
          p.{lastPage}
        </span>}
      </div>
    )
  }

  const defaultTheme = isEpub
    ? "from-violet-950 via-purple-950 to-slate-950"
    : "from-blue-900 via-indigo-950 to-slate-950"

  if (compact) return <div className={`relative flex shrink-0 flex-col justify-between overflow-hidden bg-gradient-to-b ${card.coverTheme || defaultTheme} p-2 text-white ${baseSize}`}>
    <div className="pointer-events-none absolute inset-y-0 left-0 w-1 bg-gradient-to-r from-black/35 to-transparent" />
    <div className="h-px w-4 bg-white/40" />
    <span className="text-[7px] font-bold tracking-wider">AILS</span>
  </div>

  return (
    <div
      className={`group/cover relative flex shrink-0 flex-col justify-between overflow-hidden rounded-xl bg-gradient-to-b ${card.coverTheme || defaultTheme} p-3 text-white shadow-md transition-all duration-200 group-hover:scale-[1.03] group-hover:shadow-lg ${baseSize}`}
    >
      {/* 책등(Book Spine) 입체 음영 */}
      <div className="pointer-events-none absolute inset-y-0 left-0 w-2.5 bg-gradient-to-r from-black/35 via-black/15 to-transparent z-10" />
      <div className="pointer-events-none absolute inset-y-0 left-2.5 w-[1px] bg-white/20 z-10" />

      {/* 우측 상단 종류 뱃지 */}
      <div className="flex items-center justify-between">
        <div className="h-1 w-5 rounded-full bg-white/40" />
        <span
          className={`rounded-md px-1.5 py-0.5 text-[9px] font-bold tracking-wider uppercase backdrop-blur-xs ${
            isEpub ? "bg-violet-500/80 text-white" : "bg-white/15 text-white/90"
          }`}
        >
          {card.kind || "PDF"}
        </span>
      </div>

      <div className="my-auto py-2">
        <div className="text-xs font-bold leading-snug line-clamp-3 drop-shadow-sm break-keep">
          {card.title}
        </div>
      </div>

      <div className="flex items-center justify-between border-t border-white/15 pt-2 text-[9px] opacity-75">
        <span>{isEpub ? "EPUB eBook" : "AILS Edition"}</span>
        {lastPage && !isEpub ? <span>p.{lastPage}</span> : null}
      </div>
    </div>
  )
}
