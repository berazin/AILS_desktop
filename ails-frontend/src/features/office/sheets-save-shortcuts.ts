import { CommandType, ICommandService, type Injector } from '@univerjs/core'
import { whenFormulaEditorActivated, whenSheetEditorActivated, whenSheetEditorFocused } from '@univerjs/sheets-ui'
import { IShortcutService, KeyCode, MetaKeys } from '@univerjs/ui'

export function registerSheetsSaveShortcuts(injector: Injector, container: HTMLElement) {
  const commands = injector.get(ICommandService)
  const shortcuts = injector.get(IShortcutService)
  // Univer keeps its focused cell editor in a portal outside OfficeWorkspace.
  // Route its shortcuts through the workbook's own focus and lifetime scope.
  const registrations = [false, true].flatMap(copy => {
    const id = copy ? 'ails.operation.save-sheet-copy' : 'ails.operation.save-sheet'
    return [commands.registerCommand({ id, type: CommandType.OPERATION, handler: () => {
      container.dispatchEvent(new CustomEvent('ails:office-save', { detail: { copy } }))
      return true
    } }), shortcuts.registerShortcut({ id,
      binding: KeyCode.S | MetaKeys.CTRL_COMMAND | (copy ? MetaKeys.SHIFT : 0),
      preconditions: context => container.checkVisibility() && (whenSheetEditorFocused(context)
        || whenSheetEditorActivated(context) || whenFormulaEditorActivated(context)),
    })]
  })
  return { dispose: () => registrations.forEach(registration => registration.dispose()) }
}
