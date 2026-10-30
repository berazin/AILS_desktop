export type ProjectBrowserEntry = {
  kind: "folder"
  name: string
  path: string
}

export function normalizeProjectPath(value: string): string {
  return String(value || "")
    .replace(/\\/g, "/")
    .split("/")
    .map((part) => part.trim())
    .filter((part) => part && part !== "." && part !== "..")
    .join("/")
}

export function projectBaseName(path: string): string {
  const normalized = normalizeProjectPath(path)
  return normalized.split("/").pop() || normalized
}

export function parentProjectPath(path: string): string {
  const normalized = normalizeProjectPath(path)
  const slash = normalized.lastIndexOf("/")
  return slash > 0 ? normalized.slice(0, slash) : ""
}

export function buildProjectBrowserEntries(projects: string[], currentFolder: string): ProjectBrowserEntry[] {
  const current = normalizeProjectPath(currentFolder)
  const normalizedProjects = Array.from(new Set(projects.map(normalizeProjectPath).filter(Boolean))).sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: "base" }),
  )
  const entriesByPath = new Map<string, ProjectBrowserEntry>()

  for (const project of normalizedProjects) {
    const relative = current ? project.slice(current.length + 1) : project
    if (current && project !== current && !project.startsWith(`${current}/`)) continue
    if (!relative || relative.startsWith("/")) continue

    const firstSegment = relative.split("/")[0]
    const childPath = current ? `${current}/${firstSegment}` : firstSegment
    entriesByPath.set(childPath, {
      kind: "folder",
      name: firstSegment,
      path: childPath,
    })
  }

  return Array.from(entriesByPath.values()).sort((a, b) => {
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
  })
}

export function moveProjectPath(sourcePath: string, targetFolderPath: string): string {
  const source = normalizeProjectPath(sourcePath)
  const targetFolder = normalizeProjectPath(targetFolderPath)
  if (!source) throw new Error("source project is empty")
  if (targetFolder === source || targetFolder.startsWith(`${source}/`)) {
    throw new Error("Cannot move a folder inside itself")
  }
  const destination = targetFolder ? `${targetFolder}/${projectBaseName(source)}` : projectBaseName(source)
  return normalizeProjectPath(destination)
}
