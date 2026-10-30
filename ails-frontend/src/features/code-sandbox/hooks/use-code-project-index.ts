import { IDE_ENABLED } from "../../../edition.ts"
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"

import { getCodeProjects } from "../../../lib/api.ts"
import { normalizeProjectPath } from "../lib/code-project-browser.ts"

export function useCodeProjectIndex(baseDir: string) {
  const projectListLoadSeqRef = useRef(0)
  const projectListBaseScopeRef = useRef(normalizeProjectPath(baseDir).toLocaleLowerCase())
  const [projectList, setProjectList] = useState<string[]>([])
  const [managedProjectList, setManagedProjectList] = useState<string[]>([])
  const [projectsLoaded, setProjectsLoaded] = useState(false)

  const refreshProjects = useCallback(async () => {
    if (!IDE_ENABLED) { setProjectsLoaded(true); return }
    const requestBaseScope = normalizeProjectPath(baseDir).toLocaleLowerCase()
    const requestSeq = ++projectListLoadSeqRef.current
    try {
      const res = await getCodeProjects({ base_dir: baseDir })
      if (
        requestSeq !== projectListLoadSeqRef.current
        || requestBaseScope !== projectListBaseScopeRef.current
      ) return
      if (res.success && res.projects) {
        setProjectList(res.projects.map(normalizeProjectPath).filter(Boolean))
        setManagedProjectList((res.managed_projects || []).map(normalizeProjectPath).filter(Boolean))
      }
    } catch (error) {
      if (
        requestSeq === projectListLoadSeqRef.current
        && requestBaseScope === projectListBaseScopeRef.current
      ) console.error(error)
    } finally {
      if (
        requestSeq === projectListLoadSeqRef.current
        && requestBaseScope === projectListBaseScopeRef.current
      ) setProjectsLoaded(true)
    }
  }, [baseDir])

  useLayoutEffect(() => {
    const nextBaseScope = normalizeProjectPath(baseDir).toLocaleLowerCase()
    if (projectListBaseScopeRef.current === nextBaseScope) return
    projectListBaseScopeRef.current = nextBaseScope
    projectListLoadSeqRef.current += 1
    setProjectsLoaded(false)
    setProjectList([])
    setManagedProjectList([])
  }, [baseDir])

  useEffect(() => {
    void refreshProjects()
  }, [refreshProjects])

  return {
    managedProjectList,
    projectList,
    projectsLoaded,
    refreshProjects,
    setManagedProjectList,
    setProjectList,
    setProjectsLoaded,
  }
}
