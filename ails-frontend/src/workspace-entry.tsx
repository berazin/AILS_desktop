import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ThemeProvider } from 'next-themes'
import App from './App.tsx'
import './index.css'
import { TabWindowOpening } from './features/desktop-shell/components/tab-window-opening.tsx'
import { BackendStartupNotice } from './features/desktop-shell/components/backend-startup-notice.tsx'
import { installWorkspaceScrollbars } from './shared/ui/workspace-scrollbars.ts'

const disposeScrollbars = installWorkspaceScrollbars(document)
import.meta.hot?.dispose(disposeScrollbars)
createRoot(document.getElementById('root')!).render(<StrictMode>
  <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
    <TabWindowOpening><App /><BackendStartupNotice /></TabWindowOpening>
  </ThemeProvider>
</StrictMode>)

// An external stylesheet must not block the initial module graph or first frame.
const fontStyle = document.createElement('link')
fontStyle.rel = 'stylesheet'
fontStyle.href = 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap'
let fontTimer: ReturnType<typeof setTimeout> | undefined
let fontFrame = requestAnimationFrame(() => {
  fontFrame = requestAnimationFrame(() => {
    fontTimer = setTimeout(() => document.head.append(fontStyle), 1000)
  })
})
import.meta.hot?.dispose(() => {
  cancelAnimationFrame(fontFrame); clearTimeout(fontTimer); fontStyle.remove()
})
