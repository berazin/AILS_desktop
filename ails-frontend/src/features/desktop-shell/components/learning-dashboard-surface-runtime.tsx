// Dashboard state and the file browser load when this surface is needed.
import { memo, useCallback, useMemo, type ComponentProps } from "react"

import type { MaterialKind } from "../../../lib/api"
import type { MaterialContextTarget } from "../../../lib/material-navigation.ts"
import { t } from "../../../lib/i18n.ts"
import { useEventCallback } from "../../../shared/hooks/use-event-callback.ts"
import type { InteractionRunner } from "../../code-sandbox/hooks/use-interaction-runner.ts"
import type { MaterialsController } from "../../materials/hooks/use-materials-controller.ts"
import type { MaterialsWorkflows } from "../../materials/hooks/use-materials-workflows.ts"
import type { MaterialSearchModalController, OpenMaterialSearchResult } from "../../materials/hooks/use-material-search-modal.ts"
import { MaterialSearchInline } from "../../materials/components/material-search-inline.tsx"
import { useWorkspaceEntryCreation } from "../../materials/hooks/use-workspace-entry-creation.ts"
import { useVisibleMaterialDirectory } from "../../materials/hooks/use-visible-material-directory.ts"
import { LearningDashboard, type DashboardRecentFile, type HomeQuickActions } from "./home-workspace.tsx"

type DashboardProps = ComponentProps<typeof LearningDashboard>
const MemoLearningDashboard = memo(LearningDashboard)

type LearningDashboardSurfaceProps = {
  workspaceOnly?: boolean
  splitFolderNavigation?: { folderPath: string; navigateToFolder: (path: string) => void }
  accountKey?: string
  activity: Pick<InteractionRunner, "busyActions" | "isBusy" | "runInteraction"> & {
    setNotice: (notice: string) => void
  }
  materials: MaterialsController
  navigation: {
    onBackToAgent: () => void
    openFile: (path: string) => void
    folderPath?: string
    navigateToFolder?: (path: string) => void
  }
  ocr: {
    excludedPaths?: string[]
    toggleExclusion: (path: string) => void
  }
  pdf: {
    activeOcrJobs?: DashboardProps["activeOcrJobs"]
    documentTags: DashboardProps["documentTags"]
    onDocumentMetaChanged: NonNullable<DashboardProps["onDocumentMetaChanged"]>
    onOpenAtPage: NonNullable<DashboardProps["onOpenAtPage"]>
    pageByDocument: NonNullable<DashboardProps["pdfPageByDocument"]>
  }
  quickActions: HomeQuickActions
  mdSavePath: string
  recentFiles: DashboardRecentFile[]
  search: {
    controller: MaterialSearchModalController
    onOpenResult?: OpenMaterialSearchResult
  }
  workflows: MaterialsWorkflows
  onGenerateFilePractice: (target: MaterialContextTarget) => void
  onSolvePractice: (path: string) => void
}

export function LearningDashboardSurface({
  workspaceOnly,
  splitFolderNavigation,
  accountKey,
  activity,
  materials,
  navigation,
  ocr,
  pdf,
  quickActions,
  mdSavePath,
  recentFiles,
  search,
  workflows,
  onGenerateFilePractice,
  onSolvePractice,
}: LearningDashboardSurfaceProps) {
  // Tab changes rebuild the composition ports, but unchanged Home data should
  // reuse its rendered list. Event bridges keep the latest workflow closures.
  const onBackToAgent = useEventCallback(navigation.onBackToAgent)
  const onDocumentMetaChanged = useEventCallback(pdf.onDocumentMetaChanged)
  const onMoveToTrash = useEventCallback(workflows.moveDashboardItemToTrash)
  const onMoveSelectionToTrash = useEventCallback(workflows.requestDeleteBulk)
  const onTransferEntries = useEventCallback(workflows.pasteWorkspaceEntries)
  const onSetOcrExclusions = useEventCallback(workflows.setOcrExclusions)
  const onOpenAtPage = useEventCallback(pdf.onOpenAtPage)
  const onOpenRecent = useEventCallback(navigation.openFile)
  const folderNavigation = workspaceOnly ? splitFolderNavigation : navigation
  const visibleMaterials = useVisibleMaterialDirectory(folderNavigation?.folderPath ?? "", materials.data.lectureMaterials, materials.data.pendingFileDeletes, activity.setNotice)
  const onNavigateFolder = useEventCallback((path: string) => folderNavigation?.navigateToFolder?.(path))
  const onCreateEntry = useWorkspaceEntryCreation(materials.data.setLectureMaterials)
  const onRefresh = useEventCallback(() => {
    void activity.runInteraction("refresh-materials", t("강의자료 목록 갱신"), async () => {
      await materials.actions.refreshLectureMaterials()
      return t("강의자료 목록을 갱신했습니다.")
    })
  })
  const onRenameFile = useEventCallback((target: { path: string; title: string; kind: string; newName?: string }) => {
    if (target.kind === "folder") return workflows.commitFolderRename(target.path, target.newName)
    const fileName = target.path.split(/[\\/]/).pop() || target.title
    return workflows.renameFileTarget({
      path: target.path, fileName, title: target.title,
      kind: target.kind.toLowerCase() as MaterialKind,
    }, target.newName)
  })
  const searchContent = useMemo(() => workspaceOnly ? undefined : <MaterialSearchInline controller={search.controller} />, [search.controller, workspaceOnly])
  const onToggleOcrExclusion = useEventCallback(ocr.toggleExclusion)
  const generateFilePractice = useEventCallback(onGenerateFilePractice)
  const solvePractice = useEventCallback(onSolvePractice)
  const openCode = useEventCallback(quickActions.openCode)
  const openFolder = useEventCallback(quickActions.openFolder)
  const openFile = useEventCallback(quickActions.openFile)
  const openHelp = useEventCallback(quickActions.openHelp)
  const openPractice = useEventCallback(quickActions.openPractice)
  const openSettings = useEventCallback(quickActions.openSettings)
  const openSummary = useEventCallback(quickActions.openSummary)
  const openChatbot = useEventCallback(quickActions.openChatbot)
  const openWorkQueue = useEventCallback(quickActions.openWorkQueue)
  const onToggleFavorite = useEventCallback((path: string) => materials.tree.toggleMaterialFavorite(path))
  const favoriteEntries = useMemo(() => [
    ...(materials.data.favoriteMaterialItems?.favoriteFolders ?? []).map((folder) => ({ path: folder.path, title: folder.name, kind: "folder" })),
    ...(materials.data.favoriteMaterialItems?.favoriteFiles ?? []).map(({ target }) => ({ path: target.path, title: target.title || target.fileName, kind: target.kind })),
  ], [materials.data.favoriteMaterialItems])
  const runOcr = useEventCallback(quickActions.runOcr)
  const runTranslation = useEventCallback(quickActions.runTranslation)
  const stableQuickActions = useMemo(() => ({
    openCode, openFile, openFolder, openHelp, openPractice, openSettings, openSummary, openChatbot, openWorkQueue, runOcr, runTranslation,
  }), [openCode, openFile, openFolder, openHelp, openPractice, openSettings, openSummary, openChatbot, openWorkQueue, runOcr, runTranslation])
  // Render-time busy state must invalidate memoization immediately.
  const isOpeningRecent = useCallback((path: string) => Boolean(activity.busyActions[`material-file-${path}`]), [activity.busyActions])

  return (
    <MemoLearningDashboard
      workspaceOnly={workspaceOnly}
      folderPath={folderNavigation?.folderPath}
      onNavigateFolder={folderNavigation?.navigateToFolder ? onNavigateFolder : undefined}
      onCreateEntry={onCreateEntry}
      accountKey={accountKey}
      favoritePaths={materials.data.favoriteMaterialPaths}
      favoriteEntries={favoriteEntries}
      onToggleFavorite={onToggleFavorite}
      documentTags={pdf.documentTags}
      isOpeningRecent={isOpeningRecent}
      lectureMaterials={visibleMaterials}
      onBackToAgent={onBackToAgent}
      onDocumentMetaChanged={onDocumentMetaChanged}
      onMoveToTrash={onMoveToTrash}
      onMoveSelectionToTrash={onMoveSelectionToTrash}
      onTransferEntries={onTransferEntries}
      onSetOcrExclusions={onSetOcrExclusions}
      onOpenAtPage={onOpenAtPage}
      onOpenRecent={onOpenRecent}
      onRefresh={onRefresh}
      onRenameFile={onRenameFile}
      searchContent={searchContent}
      onToggleOcrExclusion={onToggleOcrExclusion}
      onGenerateFilePractice={generateFilePractice}
      onSolvePractice={solvePractice}
      ocrExcludedPaths={ocr.excludedPaths}
      pdfPageByDocument={pdf.pageByDocument}
      activeOcrJobs={pdf.activeOcrJobs}
      quickActions={stableQuickActions}
      mdSavePath={mdSavePath}
      recentFiles={recentFiles}
      refreshing={activity.isBusy("refresh-materials")}
    />
  )
}
