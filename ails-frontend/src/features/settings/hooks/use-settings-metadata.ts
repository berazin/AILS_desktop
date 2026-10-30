import { PERSONAL_MODE } from "../../../edition.ts"
import { useEffect, useState } from "react"

import {
  getManagedAiPolicy,
  /* @ails-feature:developer_tools:start */
  getPhoenixStatus,
  /* @ails-feature:developer_tools:end */
  type ManagedAiPolicyResponse,
  /* @ails-feature:developer_tools:start */
  type PhoenixStatus,
  /* @ails-feature:developer_tools:end */
} from "../../../lib/api"

type UseSettingsMetadataOptions = {
  developerToolsEnabled: boolean
  open: boolean
}

export function useSettingsMetadata({ developerToolsEnabled, open }: UseSettingsMetadataOptions) {
  const [managedAiPolicy, setManagedAiPolicy] = useState<ManagedAiPolicyResponse | null>(null)
  const [managedAiPolicyError, setManagedAiPolicyError] = useState(false)
  /* @ails-feature:developer_tools:start */
  const [phoenixStatus, setPhoenixStatus] = useState<PhoenixStatus | null>(null)
  /* @ails-feature:developer_tools:end */

  useEffect(() => {
    if (PERSONAL_MODE || !open) return
    let cancelled = false
    setManagedAiPolicy(null)
    setManagedAiPolicyError(false)
    void getManagedAiPolicy()
      .then((policy) => { if (!cancelled) setManagedAiPolicy(policy) })
      .catch(() => { if (!cancelled) setManagedAiPolicyError(true) })
    return () => { cancelled = true }
  }, [open])

  /* @ails-feature:developer_tools:start */
  useEffect(() => {
    if (!developerToolsEnabled || !open) return
    let cancelled = false
    void getPhoenixStatus()
      .then((status) => {
        if (!cancelled) setPhoenixStatus(status)
      })
      .catch(() => {
        if (!cancelled) setPhoenixStatus(null)
      })
    return () => {
      cancelled = true
    }
  }, [developerToolsEnabled, open])
  /* @ails-feature:developer_tools:end */

  return {
    managedAiPolicy,
    managedAiPolicyError,
    /* @ails-feature:developer_tools:start */
    phoenixStatus,
    /* @ails-feature:developer_tools:end */
  }
}
