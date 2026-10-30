// NSIS normally adds/signs elevate.exe after afterSign, immediately before
// compression. Use its cached helper now so the manifest covers the final bytes.
module.exports = async function prepareNsisHelper(context) {
  for (const target of context.targets || []) {
    if (target.name !== "nsis" && target.name !== "nsis-web") continue
    const helper = target.packageHelper?.elevateHelper
    if (typeof helper?.copy !== "function") {
      throw new Error("NSIS helper is unavailable; cannot create a complete update manifest.")
    }
    await helper.copy(context.appOutDir, target)
  }
}
