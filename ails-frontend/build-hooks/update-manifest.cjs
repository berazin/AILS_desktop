const crypto = require("node:crypto")
const fs = require("node:fs/promises")
const { createReadStream } = require("node:fs")
const path = require("node:path")
const prepareNsisHelper = require("./nsis-manifest-helper.cjs")

const MANIFEST_NAME = "ails-update-manifest.json"

async function writeManifest(root, version, executable) {
  const files = []
  async function visit(directory) {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const fullPath = path.join(directory, entry.name)
      const relative = path.relative(root, fullPath).split(path.sep).join("/")
      if (relative === MANIFEST_NAME) continue
      if (entry.isSymbolicLink()) throw new Error(`Update package contains a link: ${relative}`)
      if (entry.isDirectory()) {
        await visit(fullPath)
      } else if (entry.isFile()) {
        const digest = crypto.createHash("sha256")
        for await (const chunk of createReadStream(fullPath)) digest.update(chunk)
        files.push({ path: relative, size: (await fs.stat(fullPath)).size, sha256: digest.digest("hex") })
      }
    }
  }
  await visit(root)
  files.sort((a, b) => a.path.localeCompare(b.path))
  for (const required of [executable, "resources/app.asar", "resources/backend/AILSBackend/AILSBackend.exe"]) {
    if (!files.some(file => file.path === required)) throw new Error(`Update package is incomplete: ${required}`)
  }
  await fs.writeFile(path.join(root, MANIFEST_NAME), JSON.stringify({ protocol: 1, version, executable, files }))
}

// afterPack covers unsigned builds; afterSign refreshes hashes after resource
// editing/signing. artifactBuildCompleted advertises support before YAML creation.
module.exports = async function updateManifest(context) {
  if (context.appOutDir && context.electronPlatformName === "win32") {
    await prepareNsisHelper(context)
    await writeManifest(context.appOutDir, context.packager.appInfo.version, `${context.packager.appInfo.productFilename}.exe`)
  } else if (context.target?.name === "nsis" && context.isWriteUpdateInfo && context.file.endsWith(".exe")) {
    context.updateInfo = { ...context.updateInfo, ailsStagedInstall: 1 }
  }
}
module.exports.writeManifest = writeManifest
