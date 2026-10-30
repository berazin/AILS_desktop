import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { LiquidTabDragDroplet } from './features/desktop-shell/components/liquid-tab-drag-droplet.tsx'

createRoot(document.getElementById('root')!).render(<StrictMode><LiquidTabDragDroplet /></StrictMode>)
