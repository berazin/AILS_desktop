import { useEffect, useState } from "react"
import { waitForInitialDocument } from '../../../lib/initial-document-readiness.ts'
import { getMaterialFileSiblings } from "../../../lib/api/materials.ts"
import type { SiblingNavigationResult } from "../../../lib/material-navigation.ts"

export function useMaterialSiblings(filePath?: string) {
  const [siblings, setSiblings] = useState<SiblingNavigationResult | null>(null)
  useEffect(() => {
    setSiblings(null)
    if (!filePath) return
    let active = true
    const controller = new AbortController()
    void waitForInitialDocument(controller.signal).then(() => getMaterialFileSiblings(filePath)).then(result => {
      if (active) setSiblings(result)
    }).catch(() => {
      if (active) setSiblings(null)
    })
    return () => { active = false; controller.abort() }
  }, [filePath])
  return siblings
}
