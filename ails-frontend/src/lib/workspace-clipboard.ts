export type WorkspaceClipboard = {
  version: 1
  id: string
  mode: "copy" | "cut"
  root: string
  paths: string[]
}
