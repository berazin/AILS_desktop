import { useEffect, useMemo } from "react"

import type {
  LectureMaterialFolder,
  PdfAnnotation,
  PdfProblem,
} from "../../../lib/api"
import type { ViewerDocument } from "../../../lib/viewer-document.ts"
import type { useCodeSandboxWorkspace } from "../../code-sandbox/hooks/use-code-sandbox-workspace.ts"
import { useEventCallback } from "../../../shared/hooks/use-event-callback.ts"
import type { PdfCoreWorkspace } from "./use-pdf-core-workspace.ts"
import { usePdfPageOverlays } from "./use-pdf-page-overlays.tsx"
import { usePdfViewerInteractions } from "./use-pdf-viewer-interactions.ts"
import { usePdfViewerWorkspace } from "./use-pdf-viewer-workspace.ts"
import { usePdfWorkspaceWorkflows } from "./use-pdf-workspace-workflows.ts"
import { pdfSiblingNavigation } from "../lib/pdf-sibling-navigation.ts"
import {
  normalizedMaterialPath,
  siblingNavigation as domainSiblingNavigation,
  type SiblingNavigationResult,
} from "../../../lib/material-navigation.ts"

type ViewerOptions = Parameters<typeof usePdfViewerWorkspace>[0]
type WorkflowOptions = Parameters<typeof usePdfWorkspaceWorkflows>[0]
type InteractionOptions = Parameters<typeof usePdfViewerInteractions>[0]
type CodeSandboxWorkspace = ReturnType<typeof useCodeSandboxWorkspace>

type UsePdfWorkspaceDomainOptions = {
  viewer: ViewerOptions
  workflow: {
    configuration: WorkflowOptions["configuration"]
    document: Pick<WorkflowOptions["document"], "applyMaterialFile" | "getViewerSource" | "openMaterialFile">
    interaction: WorkflowOptions["interaction"]
    materials: WorkflowOptions["materials"]
  }
  interactions: {
    coding: InteractionOptions["coding"]
    fullscreen: boolean
    materialFolders: LectureMaterialFolder[]
    openMaterial: InteractionOptions["viewer"]["openMaterial"]
    setFullscreen: InteractionOptions["viewer"]["setFullscreen"]
    scrollRef?: InteractionOptions["viewer"]["scrollRef"]
    fullscreenScrollRef?: InteractionOptions["viewer"]["fullscreenScrollRef"]
    diskSiblings?: SiblingNavigationResult | null
  }
  overlays: {
    onCommitAnnotation: (annotation: PdfAnnotation) => void
    onDeleteAnnotation: (annotationId: string) => void
  }
  practice: {
    activeSandboxBaseDir: string
    activeFileName: string
    bindOpen: PdfCoreWorkspace["practice"]["bindOpen"]
    codingModeActive: boolean
    openCodeSandbox: CodeSandboxWorkspace["actions"]["open"]
    projectName: string
  }
}

function siblingNavigation(
  folders: LectureMaterialFolder[],
  viewerDocument: ViewerDocument | null,
  diskSiblings?: SiblingNavigationResult | null,
) {
  return domainSiblingNavigation(folders, viewerDocument, diskSiblings)
}

export function usePdfWorkspaceDomain({
  interactions,
  overlays,
  practice,
  viewer: viewerOptions,
  workflow,
}: UsePdfWorkspaceDomainOptions) {
  const viewer = usePdfViewerWorkspace(viewerOptions)
  const {
    document: {
      activePageLayout,
      activePath,
      currentPage,
      pageCount,
      visiblePages,
    },
    navigation,
    ocr: { statusMatchesActivePath },
    practice: {
      activeProblemSourceKey,
      activeProblemSourceKeyRef,
      activePathRef,
      baseDir,
    },
  } = viewer
  const pdf = viewerOptions.pdf

  const workflows = usePdfWorkspaceWorkflows({
    configuration: workflow.configuration,
    document: {
      activePath,
      activePathRef,
      activeSourceKey: activeProblemSourceKey,
      applyMaterialFile: workflow.document.applyMaterialFile,
      baseDir,
      codingModeActive: viewerOptions.coding.active,
      currentPage,
      getViewerSource: workflow.document.getViewerSource,
      goToPage: navigation.goToPage,
      latestPageRef: pdf.document.latestPdfPageRef,
      ocrStatusMatchesActivePath: statusMatchesActivePath,
      openMaterialFile: workflow.document.openMaterialFile,
      pageCount,
      visiblePages,
    },
    interaction: workflow.interaction,
    materials: workflow.materials,
    pdf,
    study: {
      activeSourceKeyRef: activeProblemSourceKeyRef,
      baseDir,
    },
  })

  const siblings = useMemo(
    () => siblingNavigation(interactions.materialFolders, viewerOptions.document, interactions.diskSiblings),
    [interactions.materialFolders, viewerOptions.document, interactions.diskSiblings],
  )
  usePdfViewerInteractions({
    coding: interactions.coding,
    navigation: {
      goByDelta: navigation.goByDelta,
      goToPage: navigation.goToPage,
      pageCount,
    },
    pdf,
    viewer: {
      document: viewerOptions.document,
      fullscreen: interactions.fullscreen,
      layoutKey: activePageLayout,
      openMaterial: interactions.openMaterial,
      setFullscreen: interactions.setFullscreen,
      scrollRef: interactions.scrollRef,
      fullscreenScrollRef: interactions.fullscreenScrollRef,
      keyboardBlocked: viewerOptions.quickChat.blocked,
      siblings,
    },
  })

  const openPractice = useEventCallback(() => {
    if (practice.codingModeActive) return
    const nextSession = normalizedMaterialPath(practice.activeSandboxBaseDir).toLocaleLowerCase()
      !== normalizedMaterialPath(baseDir).toLocaleLowerCase()
      ? {
          open: true,
          baseDir,
          projectName: practice.projectName,
          activeFileName: practice.activeFileName || "main.py",
        }
      : undefined
    practice.openCodeSandbox(nextSession, "problems")
  })
  const bindOpenPractice = practice.bindOpen
  useEffect(() => {
    bindOpenPractice(openPractice)
  }, [bindOpenPractice, openPractice])

  const pageOverlays = usePdfPageOverlays({
    activePath,
    onCommitAnnotation: overlays.onCommitAnnotation,
    onDeleteAnnotation: overlays.onDeleteAnnotation,
    onSelectProblem: workflows.problems.handleSelectPdfProblem,
    pageCount,
    pdf,
    problems: workflows.problems.activePdfProblems as PdfProblem[],
  })

  return {
    pageOverlays,
    practicePdfNavigation: { ...pdfSiblingNavigation(siblings, viewerOptions.document?.file_path ?? ""), open: interactions.openMaterial },
    viewer,
    workflows,
  }
}

export type PdfWorkspaceDomain = ReturnType<typeof usePdfWorkspaceDomain>
