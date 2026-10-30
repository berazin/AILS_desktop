const fs = require('node:fs')
const path = require('node:path')

function pythonPath(root, env = process.env) {
  if (env.AILS_PYTHON) return env.AILS_PYTHON
  const candidate = path.join(root, '.venv', 'Scripts', 'python.exe')
  return fs.existsSync(candidate) ? candidate : 'python'
}

module.exports = { pythonPath }
