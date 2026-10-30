import type { LanguageProfile } from '../../../lib/api.ts'

// Keep routing independent of the Monaco runtime so opening a file does not
// have to load an editor before deciding which workspace owns it.
const extensions: Record<string, string> = {}
for (const [language, suffixes] of Object.entries({
  c: 'c', cpp: 'cpp cc cxx cp c++ h hpp hh hxx h++ inl ipp tpp cu cuh',
  objectivec: 'm mm', csharp: 'cs csx', python: 'py pyw pyi pyx pxd',
  javascript: 'js jsx mjs cjs', typescript: 'ts tsx mts cts',
  java: 'java jav', kotlin: 'kt kts', scala: 'scala sc', groovy: 'groovy gradle',
  go: 'go', rust: 'rs', swift: 'swift', dart: 'dart', lua: 'lua', r: 'r', julia: 'jl',
  ruby: 'rb rake gemspec', perl: 'pl pm', php: 'php phtml php3 php4 php5 php7 php8',
  shell: 'sh bash zsh fish ksh csh', bat: 'bat cmd', powershell: 'ps1 psm1 psd1',
  html: 'html htm xhtml', css: 'css', scss: 'scss', less: 'less', sass: 'sass',
  vue: 'vue', svelte: 'svelte', astro: 'astro',
  json: 'json jsonc json5', yaml: 'yaml yml', toml: 'toml', ini: 'ini cfg conf properties env',
  xml: 'xml xsl xslt xsd svg', sql: 'sql', graphql: 'graphql gql', protobuf: 'proto',
  dockerfile: 'dockerfile containerfile', makefile: 'mk mak make', cmake: 'cmake',
  fsharp: 'fs fsi fsx', clojure: 'clj cljs cljc edn', haskell: 'hs lhs',
  elixir: 'ex exs', erlang: 'erl hrl', ocaml: 'ml mli', scheme: 'scm ss', lisp: 'lisp lsp cl',
  fortran: 'f f90 f95 f03 f08 for', pascal: 'pas pp', vb: 'vb vbs',
  asm: 'asm s', verilog: 'v vh sv svh', vhdl: 'vhd vhdl', zig: 'zig', nim: 'nim nims',
  solidity: 'sol', hcl: 'hcl tf tfvars', nix: 'nix', tex: 'tex sty cls', diff: 'diff patch',
})) {
  for (const suffix of suffixes.split(' ')) extensions[suffix] = language
}

const filenames: Record<string, string> = {
  makefile: 'makefile', gnumakefile: 'makefile', bsdmakefile: 'makefile',
  'cmakelists.txt': 'cmake', dockerfile: 'dockerfile', containerfile: 'dockerfile',
  gemfile: 'ruby', rakefile: 'ruby', guardfile: 'ruby', vagrantfile: 'ruby', jenkinsfile: 'groovy',
  '.bashrc': 'shell', '.bash_profile': 'shell', '.profile': 'shell', '.zshrc': 'shell', '.zprofile': 'shell',
  '.gitignore': 'ini', '.gitattributes': 'ini', '.gitmodules': 'ini', '.dockerignore': 'ini',
  '.editorconfig': 'ini', '.npmrc': 'ini', '.yarnrc': 'ini', '.prettierrc': 'json', '.eslintrc': 'json',
  'requirements.txt': 'plaintext', 'pipfile': 'toml', 'cargo.lock': 'toml', 'poetry.lock': 'toml',
}

function basename(path: string) { return path.replace(/\\/g, '/').split('/').pop()?.toLowerCase() ?? '' }

export function codeLanguageForPath(path: string): string | undefined {
  const name = basename(path)
  if (Object.hasOwn(filenames, name)) return filenames[name]
  if (/^(?:\.env|dockerfile|containerfile)(?:\..+)?$/.test(name)) return name.startsWith('.env') ? 'ini' : 'dockerfile'
  const dot = name.lastIndexOf('.')
  const suffix = name.slice(dot + 1)
  return dot >= 0 && Object.hasOwn(extensions, suffix) ? extensions[suffix] : undefined
}

export function isCodeFile(path: string, profiles: readonly Pick<LanguageProfile, 'extensions'>[] = []) {
  if (codeLanguageForPath(path)) return true
  const name = basename(path)
  return profiles.some(profile => profile.extensions.some(extension => {
    const suffix = extension.trim().replace(/^\.+/, '').toLowerCase()
    return suffix && name.endsWith(`.${suffix}`)
  }))
}
