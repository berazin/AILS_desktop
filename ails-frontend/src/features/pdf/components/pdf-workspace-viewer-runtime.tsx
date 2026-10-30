import { useMemo, type ReactNode } from "react"

import type { PdfFloatingWindow } from "../hooks/use-pdf-floating-window.ts"
import type { PdfController } from "../hooks/use-pdf-controller.ts"
import type { PdfViewerWorkspace } from "../hooks/use-pdf-viewer-workspace.ts"
import type { PdfProblem } from "../../../lib/api"
import { pdfPracticeSurfacePlan } from "../../../lib/pdf-view-layout.ts"
import type { ViewerDocument } from "../../../lib/viewer-document.ts"
import { cn } from "../../../lib/utils.ts"
import { t } from "../../../lib/i18n.ts"
import { normalizedMaterialPath } from "../../../lib/material-navigation.ts"
import { PdfCodingOverlays } from "./pdf-coding-overlays.tsx"
import { PdfJsPage } from "./pdf-js-page.tsx"
import { PdfViewerChrome } from "./pdf-viewer-chrome.tsx"

type PdfWorkspaceViewerProps = {
  document: ViewerDocument
  floating: PdfFloatingWindow
  fullscreenOpen: boolean
  overlay?: (page: number) => ReactNode
  pdf: PdfController
  problems: {
    current: PdfProblem[]
    onSelect: (problem: PdfProblem) => void
  }
  textTools: {
    onSearch: () => void | Promise<void>
    onToggleSection: (id: string) => void
  }
  workspace: PdfViewerWorkspace
}

export function PdfWorkspaceViewer({
  document,
  floating,
  fullscreenOpen,
  overlay,
  pdf,
  problems,
  textTools,
  workspace,
}: PdfWorkspaceViewerProps) {
  const {
    document: {
      isEditingPage,
      pageInputDraft,
      pageInputRef,
      pdfAltCheckpointPage,
      pdfViewerContainerRef,
      setIsEditingPage,
      setPageInputDraft,
    },
    ocr: {
      isPdfOcrHintDismissed,
      isPdfRegionOcrBusy,
      pdfFullOcrStatus,
      pdfOcrSelection,
    },
    study: {
      pdfProblemsAnalyzing,
      pdfProblemsError,
      pdfProblemsLoading,
    },
    view: {
      expandedPdfOutlineSections,
      pdfColorMode,
      pdfOcrTextVisible,
      pdfSearchQuery,
      pdfSearchResults,
      pdfSearchLoading,
      pdfTextToolsOpen,
      pdfThemeBrightness,
      pdfThemeContrast,
      pdfViewZoom,
      setPdfSearchQuery,
      setPdfTextToolsOpen,
    },
  } = pdf
  const {
    coding,
    document: viewer,
    navigation,
  } = workspace
  const practiceSurfacePlan = pdfPracticeSurfacePlan(coding.active)
  const viewerStyle = useMemo(
    () => viewer.studyViewerActive ? { height: "100%" } : undefined,
    [viewer.studyViewerActive],
  )
  const captionOutline = useMemo(() => pdfFullOcrStatus
    && normalizedMaterialPath(pdfFullOcrStatus.path).toLowerCase() === normalizedMaterialPath(viewer.activePath).toLowerCase()
    ? pdfFullOcrStatus.outline : [], [pdfFullOcrStatus, viewer.activePath])

  return (
    <div
      className={cn(
        "relative flex items-center justify-center bg-[var(--panel)]",
        floating.pdfViewerFloating
          ? "fixed z-[80] isolate shadow-xl overflow-hidden cursor-default"
          : viewer.studyViewerActive
            ? "h-full w-full overflow-hidden"
            : cn(
                "w-full overflow-hidden",
                viewer.usesPortraitLayout
                  ? "max-w-[1100px] mx-auto min-h-[750px] max-h-[88vh]"
                  : "min-h-[var(--viewer-min-height)]",
              ),
      )}
      data-ails-pdf-viewer="true"
      data-ails-quick-chat-focus-surface={viewer.studyViewerActive && !fullscreenOpen ? "true" : undefined}
      tabIndex={viewer.studyViewerActive ? 0 : undefined}
      onMouseDown={floating.pdfViewerFloating && !coding.active ? floating.handlePdfDragDown : undefined}
      onMouseEnter={navigation.onViewerMouseEnter}
      onMouseLeave={navigation.onViewerMouseLeave}
      ref={pdfViewerContainerRef}
      style={floating.pdfViewerFloating ? {
        height: floating.pdfViewerSize.height,
        left: floating.pdfViewerPosition.x,
        top: floating.pdfViewerPosition.y,
        width: floating.pdfViewerSize.width,
      } : undefined}
    >
      <PdfViewerChrome
        floating={{
          active: floating.pdfViewerFloating,
          toggle: floating.togglePdfViewerFloating,
        }}
        page={{
          checkpoint: pdfAltCheckpointPage,
          count: viewer.pageCount,
          current: viewer.currentPage,
          draft: pageInputDraft,
          editing: isEditingPage,
          label: viewer.pageLabel,
          setDraft: setPageInputDraft,
          setEditing: setIsEditingPage,
          submit: navigation.submitPage,
        }}
        pageInputRef={pageInputRef}
        status={{
          problemError: pdfProblemsError,
          problemsAnalyzing: pdfProblemsAnalyzing,
          problemsLoading: pdfProblemsLoading,
        }}
        textTools={{
          available: !fullscreenOpen,
          statusMessage: !pdfFullOcrStatus ? t("PDF 텍스트 정보를 아직 사용할 수 없습니다. 검색을 시도하거나 문서를 다시 열어 주세요.") : !pdfFullOcrStatus.has_text ? t("검색 가능한 텍스트가 없습니다. OCR 후 검색할 수 있습니다.") : undefined,
          close: () => setPdfTextToolsOpen(false),
          expandedSections: expandedPdfOutlineSections,
          onNavigate: navigation.goToPage,
          onSearch: textTools.onSearch,
          onToggleSection: textTools.onToggleSection,
          open: pdfTextToolsOpen,
          outline: pdfFullOcrStatus?.outline ?? [],
          query: pdfSearchQuery,
          results: pdfSearchResults,
          loading: pdfSearchLoading,
          setQuery: setPdfSearchQuery,
          toggle: () => setPdfTextToolsOpen((current) => !current),
        }}
      />
      {!fullscreenOpen && practiceSurfacePlan.showPdfImagePage && (
        <PdfJsPage
          className={cn(
            "h-full w-full bg-[var(--panel)]",
            floating.pdfViewerFloating || viewer.studyViewerActive ? "min-h-0" : "min-h-[var(--viewer-height)]",
          )}
          invertColors={viewer.themeInvertEnabled}
          matchThemeColors={pdfColorMode === "theme"}
          onNavigate={navigation.goByDirection}
          capturePagePointer={coding.canDragText}
          onPageClick={coding.canDragText ? coding.regionOcr.handlePdfImageClick : undefined}
          onPagePointerCancel={coding.canDragText ? coding.regionOcr.handlePdfOcrPointerCancel : undefined}
          onPagePointerDown={coding.canDragText ? coding.regionOcr.handlePdfOcrPointerDown : undefined}
          onPagePointerMove={coding.canDragText ? coding.regionOcr.handlePdfOcrPointerMove : undefined}
          onPagePointerUp={coding.canDragText ? coding.regionOcr.handlePdfOcrPointerUp : undefined}
          overlay={overlay}
          pageCount={viewer.pageCount}
          pageNumber={viewer.currentPage}
          pageNumbers={viewer.visiblePageNumbers}
          pdfPath={document.rendered_file_path || document.file_path}
          style={viewerStyle}
          themeBrightness={pdfThemeBrightness}
          themeContrast={pdfThemeContrast}
          visualScale={pdfViewZoom}
        />
      )}
      {!fullscreenOpen && practiceSurfacePlan.showCodingImage && (
        <PdfJsPage
          className={cn("h-full w-full bg-[var(--panel)]", coding.canDragText ? "cursor-default touch-none select-none" : "cursor-default")}
          invertColors={viewer.themeInvertEnabled}
          matchThemeColors={pdfColorMode === "theme"}
          onNavigate={navigation.goByDirection}
          capturePagePointer={coding.canDragText}
          onPageClick={coding.canDragText ? coding.regionOcr.handlePdfImageClick : undefined}
          onPagePointerCancel={coding.canDragText ? coding.regionOcr.handlePdfOcrPointerCancel : undefined}
          onPagePointerDown={coding.canDragText ? coding.regionOcr.handlePdfOcrPointerDown : undefined}
          onPagePointerMove={coding.canDragText ? coding.regionOcr.handlePdfOcrPointerMove : undefined}
          onPagePointerUp={coding.canDragText ? coding.regionOcr.handlePdfOcrPointerUp : undefined}
          onPageRendered={({ width, height }) => {
            coding.onGeometryLoaded({ aspect: width / height, portrait: height > width })
            coding.setRenderedKey(coding.pageKey)
            window.requestAnimationFrame(coding.updatePageRect)
          }}
          overlay={overlay}
          pageCount={viewer.pageCount}
          pageLayerRef={coding.imageRef}
          pageNumber={viewer.currentPage}
          pdfPath={document.rendered_file_path || document.file_path}
          style={viewerStyle}
          themeBrightness={pdfThemeBrightness}
          themeContrast={pdfThemeContrast}
          visualScale={pdfViewZoom}
        />
      )}
      <PdfCodingOverlays
        containedPage={{
          activePath: viewer.activePath,
          onSelectProblem: problems.onSelect,
          page: viewer.currentPage,
          pageCount: viewer.pageCount,
          problems: problems.current,
          rect: coding.pageRect,
          show: !overlay && coding.active
            && coding.renderedKey === coding.pageKey
            && coding.pageRect.width > 0
            && coding.pageRect.height > 0,
          textVisible: pdfOcrTextVisible,
        }}
        floating={{
          active: floating.pdfViewerFloating,
          onResize: floating.handlePdfResizeDown,
        }}
        selection={{
          busy: isPdfRegionOcrBusy,
          canDragText: coding.canDragText,
          codingModeActive: coding.active || coding.canDragText,
          hintDismissed: isPdfOcrHintDismissed,
          value: pdfOcrSelection,
        }}
        title={document.title}
        outline={captionOutline}
      />
    </div>
  )
}
