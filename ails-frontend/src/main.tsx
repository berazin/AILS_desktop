// Select the entry before loading styles and the application graph. The normal
// workspace fetches App and CSS together; drag droplets retain their small entry.
import { prepareExternalViewer } from './app/startup/prepare-external-viewer.ts'
if (new URLSearchParams(location.search).get('windowMode') === 'tab-drag-droplet') {
  void import('./tab-drag-entry.tsx')
} else {
  prepareExternalViewer()
  void import('./workspace-entry.tsx')
}
