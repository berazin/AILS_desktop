import { getAppDesktopApi } from '../../lib/desktop-api.ts'
import { initialDocumentReadiness } from '../../lib/initial-document-readiness.ts'
import { preparePdfWorkerPort } from '../../features/pdf/lib/pdf-worker-bootstrap.ts'
import { OFFICE_KINDS } from '../../features/office/types.ts'
import { prepareOfficeInput } from '../../features/office/prepared-office-input.ts'

/** Prepare only the selected file's existing viewer while the workspace starts. */
export function prepareExternalViewer() {
  const path = getAppDesktopApi()?.initial_document_path?.()
  if (!path) void import('../../features/desktop-shell/components/learning-dashboard-surface-runtime.tsx')
    .catch(error => console.warn('[AILS dashboard preparation]', error))
  if (path) {
    initialDocumentReadiness.begin()
    window.addEventListener('pagehide', () => initialDocumentReadiness.finish(), { once: true })
  }
  if (path) void import('../../lib/api/materials.ts').then(({ prepareInitialMaterialRead }) => {
    const cancel = prepareInitialMaterialRead(path)
    window.addEventListener('pagehide', cancel, { once: true })
  }).catch(error => console.warn('[AILS document preparation]', error))
  const extension = getAppDesktopApi()?.initial_document_extension?.()
  if (extension === 'ipynb') {
    void import('../../features/notebook/components/lazy-notebook-workspace.tsx')
      .then(module => module.NotebookWorkspace.preload()).catch(error => console.warn('[AILS notebook preparation]', error))
    return
  }
  if (extension && OFFICE_KINDS.has(extension)) {
    if (path) void import('../../lib/api/office.ts').then(({ prepareInitialOfficeRead }) => {
      const cancel = prepareInitialOfficeRead(path, file => prepareOfficeInput(file, extension))
      window.addEventListener('pagehide', cancel, { once: true })
    }).catch(error => console.warn('[AILS office read preparation]', error))
    void Promise.all([
      import('../../features/office/engine-loader.ts').then(({ loadOfficeEngine }) => loadOfficeEngine(extension)),
      import('../../features/office/lazy-office-workspace.tsx').then(module => module.OfficeWorkspace.preload()),
    ]).catch(error => console.warn('[AILS office preparation]', error))
    return
  }
  if (extension !== 'pdf') return
  try { preparePdfWorkerPort() } catch (error) { console.warn('[AILS PDF worker preparation]', error) }
  void Promise.all([
    import('../../features/pdf/lib/pdf-worker-lifetime.ts').then(runtime => runtime.preparePdfWorker()),
    import('../../features/pdf/components/pdf-js-page-runtime.tsx'),
    import('../../features/pdf/components/pdf-workspace-viewer.tsx').then(module => module.PdfWorkspaceViewer.preload()),
  ]).catch(error => console.warn('[AILS PDF preparation]', error))
}
