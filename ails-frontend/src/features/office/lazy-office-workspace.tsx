import { createDeferredComponent } from '../../shared/components/deferred-component.tsx'

export const OfficeWorkspace = createDeferredComponent(
  () => import('./office-workspace.tsx').then(module => module.OfficeWorkspace),
  'Office',
)
