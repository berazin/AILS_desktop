import { apiResourceUrl } from "../../../lib/api"

export function getPdfThumbnailUrl(filePath: string, page: number): string {
  const params = new URLSearchParams({
    page: String(Math.max(1, page)),
    path: filePath,
    target_width: "480",
  })
  return apiResourceUrl(`/material-file/pdf-page?${params.toString()}`)
}

// 썸네일 가로세로 비(너비/높이) 공유 캐시: 같은 파일을 최근파일/그리드/인스펙터에서 재측정하지 않는다.
export const coverAspectCache = new Map<string, number>()
