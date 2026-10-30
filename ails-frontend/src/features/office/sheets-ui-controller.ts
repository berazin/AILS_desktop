/**
 * Canvas mounting follows Univer's SingleUnitUIController (Apache-2.0,
 * Copyright 2023-present DreamNum Co., Ltd.). AILS waits for a measurable
 * content area instead of Univer 1.1's fixed 300ms startup timer.
 * https://www.apache.org/licenses/LICENSE-2.0
 */
import { Injector, IConfigService, IUniverInstanceService, LifecycleService, LifecycleStages, LifecycleUnreachableError, Quantity, isInternalEditorID } from '@univerjs/core'
import { IRenderManagerService } from '@univerjs/engine-render'
import { DesktopUIController, IDialogService, ILayoutService, IMenuManagerService, IUIPartsService, IUIController, IWorkbenchService, UniverUIPlugin, type IUniverUIConfig } from '@univerjs/ui'
import { UniverSheetsCorePreset } from '@univerjs/preset-sheets-core'
import { flushSync } from 'react-dom'
import { markDocumentStartupPhase } from '../../lib/document-presentation-diagnostics.ts'
import { SheetsMenuManager } from './sheets-menu-manager.ts'

class SheetsUIController extends DesktopUIController {
  protected override _bootstrapWorkbench() {
    // Univer debounces newly registered UI parts by 200ms and dialog events
    // are not replayed. Register the dialog host before the first React mount,
    // so an immediate toolbar search cannot lose its opening event.
    this._injector.get(IDialogService)
    // This override runs inside the superclass constructor, so all ownership
    // lives in this closure rather than subclass fields initialized afterward.
    let disposed = false, started = false, frame = 0, steadyTimer = 0
    let paint: { unsubscribe(): void } | undefined
    let observer: ResizeObserver | undefined
    let currentRenderId: string | undefined
    let content: HTMLElement | undefined
    const skeleton = this._injector.get(IWorkbenchService, Quantity.OPTIONAL)?.acquireSkeleton()
    if (skeleton) this.disposeWithMe(skeleton)
    this.disposeWithMe({ dispose: () => {
      disposed = true
      cancelAnimationFrame(frame); clearTimeout(steadyTimer)
      paint?.unsubscribe()
      observer?.disconnect()
      if (content) delete content.dataset.ailsSheetsPresented
    } })
    this.disposeWithMe(this.bootstrap(async (contentElement, containerElement) => {
      markDocumentStartupPhase('sheets-workbench-ready')
      content = contentElement
      this.disposeWithMe(this._layoutService.registerRootContainerElement(containerElement))
      this.disposeWithMe(this._layoutService.registerContentElement(contentElement))
      try {
        await this._lifecycleService.onStage(LifecycleStages.Ready)
        if (disposed) return
        markDocumentStartupPhase('sheets-lifecycle-ready')
        const mountRender = (id: string) => {
          if (disposed) return false
          const renderer = this._renderManagerService.getRenderUnitById(id)
          if (!renderer?.unitId || renderer.isMainScene === false || isInternalEditorID(renderer.unitId)) return false
          const canvas = renderer.engine.getCanvasElement()
          if (currentRenderId === id && contentElement.contains(canvas)) return false
          paint?.unsubscribe()
          delete contentElement.dataset.ailsSheetsPresented
          // afterRender$ replays the last canvas, which may predate mounting or
          // contain an old workbook size. Reveal only a fresh completed draw.
          let replay = true
          paint = renderer.scene.afterRender$.subscribe(rendered => {
            if (replay || !rendered || disposed || currentRenderId !== id
              || this._lifecycleService.stage < LifecycleStages.Rendered
              || !contentElement.contains(canvas) || !canvas.width || !canvas.height) return
            // This notification runs from the engine's animation frame, outside
            // React. Remove the loading overlay in that frame as well.
            flushSync(() => skeleton?.dispose())
            contentElement.dataset.ailsSheetsPresented = 'true'
            markDocumentStartupPhase('sheets-canvas-presented')
            paint?.unsubscribe(); paint = undefined
          })
          replay = false
          if (currentRenderId !== id) {
            const previous = currentRenderId ? this._renderManagerService.getRenderUnitById(currentRenderId) : null
            previous?.deactivate(); previous?.engine.unmount()
          }
          if (!contentElement.contains(canvas)) renderer.engine.mount(contentElement)
          canvas.dataset.ailsSheetsCanvas = 'true'
          renderer.activate(); currentRenderId = id
          return true
        }
        const start = () => {
          if (disposed || started) return
          markDocumentStartupPhase('sheets-layout-start')
          const rect = contentElement.getBoundingClientRect()
          if (rect.width <= 0 || rect.height <= 0) return
          markDocumentStartupPhase('sheets-layout-ready')
          started = true
          observer?.disconnect()
          for (const [id] of this._renderManagerService.getRenderAll()) if (mountRender(id)) break
          this.disposeWithMe(this._instanceService.focused$.subscribe(id => { if (id) mountRender(id) }))
          this.disposeWithMe(this._renderManagerService.created$.subscribe(renderer => {
            if (renderer.unitId === this._instanceService.getFocusedUnit()?.getUnitId()) mountRender(renderer.unitId)
          }))
          this.disposeWithMe(this._renderManagerService.disposed$.subscribe(id => {
            if (currentRenderId !== id) return
            paint?.unsubscribe(); paint = undefined
            currentRenderId = undefined
            delete contentElement.dataset.ailsSheetsPresented
          }))
          const render = () => { this._lifecycleService.stage = LifecycleStages.Rendered }
          const menuManager = this._injector.get(IMenuManagerService)
          if (menuManager instanceof SheetsMenuManager) menuManager.batch(render)
          else render()
          markDocumentStartupPhase('sheets-canvas-mounted')
          steadyTimer = window.setTimeout(() => { if (!disposed) this._lifecycleService.stage = LifecycleStages.Steady }, 3000)
        }
        observer = new ResizeObserver(() => {
          if (disposed || started) return
          cancelAnimationFrame(frame); frame = requestAnimationFrame(start)
        })
        observer.observe(contentElement)
        start()
      } catch (error) {
        if (!disposed && !(error instanceof LifecycleUnreachableError)) throw error
      }
    }))
  }
}

/** Override only this editor instance, preserving Univer menus and plugins. */
export function sheetsCorePreset(container: HTMLElement) {
  const preset = UniverSheetsCorePreset({ container, header: false })
  return {
    ...preset,
    plugins: preset.plugins.map(entry => {
      if (!Array.isArray(entry) || entry[0] !== UniverUIPlugin) return entry
      const config = entry[1] as IUniverUIConfig
      return [UniverUIPlugin, { ...config, override: [[IUIController, {
        useFactory: (injector: Injector) => new SheetsUIController(config, injector, injector.get(LifecycleService),
          injector.get(IRenderManagerService), injector.get(ILayoutService), injector.get(IUniverInstanceService),
          injector.get(IMenuManagerService), injector.get(IUIPartsService)),
        deps: [Injector],
      }], [IMenuManagerService, {
        useFactory: (injector: Injector) => new SheetsMenuManager(injector, injector.get(IConfigService)),
        deps: [Injector],
      }]] }] as typeof entry
    }),
  }
}
