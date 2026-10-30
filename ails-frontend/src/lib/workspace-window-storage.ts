/** Secondary windows must not restore or overwrite the primary workspace. */
export function workspaceWindowStorage(): Storage {
  const secondary = new URLSearchParams(window.location.search).has("windowMode")
  return secondary ? window.sessionStorage : window.localStorage
}
