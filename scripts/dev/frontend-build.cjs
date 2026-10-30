const fs = require('node:fs')
const path = require('node:path')
const { createHash } = require('node:crypto')

// Compare the complete source file inventory and change times, including added
// or removed files. Reading large public assets would defeat a fast launch.
function frontendFingerprint(root) {
  const frontend = path.join(root, 'ails-frontend')
  const hash = createHash('sha256')
  function add(relative) {
    const filename = path.join(root, relative)
    const stat = fs.statSync(filename, { bigint: true })
    if (stat.isDirectory()) {
      for (const name of fs.readdirSync(filename).sort()) add(path.join(relative, name))
    } else if (stat.isFile()) {
      hash.update(`${relative.replaceAll('\\', '/')}\0${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}\0`)
    }
  }
  for (const name of ['src', 'public', ...fs.readdirSync(frontend).filter(name => /^(?:index\.html|package(?:-lock)?\.json|vite\.config\.[cm]?[jt]s|tsconfig.*\.json|\.env(?:\..*)?)$/.test(name))].sort()) {
    add(path.join('ails-frontend', name))
  }
  add('editions/developer.json')
  return hash.digest('hex')
}

function currentFrontendBuild(root) {
  let fingerprint
  for (const relative of ['build/frontend_developer', 'ails-frontend/dist']) {
    const directory = path.join(root, relative)
    try {
      if (!fs.statSync(path.join(directory, 'index.html')).isFile()) continue
      const manifest = JSON.parse(fs.readFileSync(path.join(directory, '.ails-source-fingerprint'), 'utf8'))
      // A build pinned to a development API port cannot follow the gateway's
      // dynamically selected port. Let Vite handle that configuration.
      if (manifest.edition !== 'developer' || manifest.apiBase !== '') continue
      fingerprint ??= frontendFingerprint(root)
      if (manifest.sha256 === fingerprint) return directory
    } catch { /* Missing, stale or incomplete builds fall back to Vite. */ }
  }
  return null
}

module.exports = { frontendFingerprint, currentFrontendBuild }
