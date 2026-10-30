const MESSAGE = "상업판에서는 IDE·코드·노트북 파일을 사용할 수 없습니다. 기존 파일과 기록은 개발판에서 열 수 있습니다."
function ideEnabled(edition) { return edition !== "commercial" }
function requireIde(edition) { if (!ideEnabled(edition)) throw new Error(MESSAGE) }
function requireDocument(edition, value) {
  if (ideEnabled(edition)) return
  const name = String(value || "").replace(/\\/g, "/").split("/").pop().toLowerCase()
  if (["cmakelists.txt", "requirements.txt"].includes(name) || !/\.(md|markdown|txt|pdf|ppt|pptx|docx|xlsx|csv|hwp|hwpx|html|htm|epub|mobi|azw3?|fb2|rtf|mp3|wav|m4a|aac|flac|ogg|opus|wma|mp4|mov|mkv|webm|png|jpe?g|gif|webp|svg|bmp|ico)$/.test(name)) throw new Error(MESSAGE)
}
module.exports = { ideEnabled, requireIde, requireDocument }
