function normalizeEdition(value) {
  const edition = String(value || "developer").trim().toLowerCase()
  if (!["developer", "full"].includes(edition)) throw new Error(`Unsupported AILS edition: ${edition}`)
  return "developer"
}

function updatesEnabled(edition) {
  return normalizeEdition(edition) === "developer"
}

module.exports = { normalizeEdition, updatesEnabled }
