/** Explicit gzip rejection takes precedence over a wildcard preference. */
function acceptsGzip(header) {
  const entries = String(header || '').split(',').map(value => {
    const [name, ...parameters] = value.trim().toLowerCase().split(';')
    const quality = parameters.find(parameter => /^\s*q\s*=/.test(parameter))?.split('=')[1]?.trim()
    return { name: name.trim(), quality: quality === undefined ? 1
      : /^(?:0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/.test(quality) ? Number(quality) : 0 }
  })
  return (entries.find(entry => entry.name === 'gzip') ?? entries.find(entry => entry.name === '*'))?.quality > 0
}

module.exports = { acceptsGzip }
