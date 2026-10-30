// Windows GUI launches can outlive the terminal that supplied stdout/stderr.
// A disconnected logging pipe must not open an uncaught-exception dialog.
function tolerateClosedLoggingPipes(streams = [process.stdout, process.stderr]) {
  for (const stream of streams) stream.on('error', error => {
    if (error.code !== 'EPIPE' && error.code !== 'ERR_STREAM_DESTROYED') throw error
  })
}
module.exports = { tolerateClosedLoggingPipes }
