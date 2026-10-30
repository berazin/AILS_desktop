function normalizeExternalUrl(value) {
  const url = new URL(String(value || "").trim())
  if (!["https:", "mailto:"].includes(url.protocol)) {
    throw new Error("Only HTTPS and mailto links can be opened externally.")
  }
  if (url.protocol === "https:" && !url.hostname) {
    throw new Error("The external HTTPS link is invalid.")
  }
  if (url.username || url.password) {
    throw new Error("External links cannot contain embedded credentials.")
  }
  return url.toString()
}

function isSameOriginUrl(value, applicationUrl) {
  try {
    const candidate = new URL(String(value || ""))
    const application = new URL(String(applicationUrl || ""))
    if (application.protocol === "ails-viewer:") {
      return candidate.protocol === application.protocol && candidate.host === "app"
        && application.host === "app" && !candidate.username && !candidate.password
    }
    return application.origin !== "null" && candidate.origin === application.origin
  } catch {
    return false
  }
}

module.exports = { isSameOriginUrl, normalizeExternalUrl }
