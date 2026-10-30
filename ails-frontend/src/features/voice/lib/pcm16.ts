export function pcm16Base64(samples: Float32Array) {
  const bytes = new Uint8Array(samples.length * 2)
  const view = new DataView(bytes.buffer)
  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index]))
    view.setInt16(index * 2, sample < 0 ? sample * 32768 : sample * 32767, true)
  }
  return btoa(String.fromCharCode(...bytes))
}
