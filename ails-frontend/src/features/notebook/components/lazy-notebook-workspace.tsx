import { createDeferredComponent } from '../../../shared/components/deferred-component.tsx'

export const NotebookWorkspace = createDeferredComponent(
  () => import('./notebook-workspace.tsx').then(module => module.NotebookWorkspace),
  'Notebook',
  props => props.controller.document?.kind === 'ipynb',
)
