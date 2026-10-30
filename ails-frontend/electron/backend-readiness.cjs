const http = require('node:http')

async function waitForBackend({ port, token, getFailure, timeoutMs = 300000 }) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const failure = getFailure()
    if (failure) throw failure
    const ready = await new Promise(resolve => {
      const request = http.get(`http://127.0.0.1:${port}/api/health`, { headers: { 'X-AILS-Token': token } }, response => {
        response.resume()
        resolve(response.statusCode === 200)
      })
      request.once('error', () => resolve(false))
      request.setTimeout(1000, () => request.destroy())
    })
    if (ready) return
    await new Promise(resolve => setTimeout(resolve, 25))
  }
  throw new Error('Timed out waiting for the local AILS backend.')
}

module.exports = { waitForBackend }
