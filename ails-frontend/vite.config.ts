import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { gzipSync } from 'node:zlib'

import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const CONFIG_DIR = dirname(fileURLToPath(import.meta.url))
const { frontendFingerprint } = createRequire(import.meta.url)('../scripts/dev/frontend-build.cjs') as { frontendFingerprint(root: string): string }
const EDITION_ALIASES: Record<string, string> = { full: 'developer' }
const SUPPORTED_EDITIONS = new Set(['developer'])
const FEATURE_KEYS = ['summary.audio_pdf', 'summary.local_stt', 'summary.media_files', 'summary.web_inputs', 'ide', 'developer_tools', 'user_memory', 'insight_book'] as const
const SUMMARY_TASK_FEATURES: Record<string, (typeof FEATURE_KEYS)[number]> = {
  audio: 'summary.audio_pdf',
  video_detailed: 'summary.media_files',
  video_summary: 'summary.media_files',
  url: 'summary.web_inputs',
  youtube: 'summary.web_inputs',
  eclass_vod: 'summary.web_inputs',
}
const SUMMARY_START = '/* @ails-summary-generation:start */'
const SUMMARY_END = '/* @ails-summary-generation:end */'

type EditionManifest = {
  schema_version: number
  id: string
  features: Record<string, boolean>
  allowed_summary_task_types: string[]
}

function canonicalEdition(value: string) {
  const requested = value.trim().toLowerCase()
  const edition = EDITION_ALIASES[requested] ?? requested
  if (!SUPPORTED_EDITIONS.has(edition)) {
    throw new Error(`Unsupported AILS edition: ${requested}`)
  }
  return edition
}

function loadEditionManifest(edition: string): EditionManifest {
  const path = resolve(CONFIG_DIR, '..', 'editions', `${edition}.json`)
  const manifest = JSON.parse(readFileSync(path, 'utf8')) as EditionManifest
  if (manifest.schema_version !== 1 || manifest.id !== edition || !manifest.features) {
    throw new Error(`Invalid AILS edition manifest: ${path}`)
  }
  const featureKeys = Object.keys(manifest.features).sort()
  if (
    featureKeys.length !== FEATURE_KEYS.length
    || FEATURE_KEYS.some((feature) => typeof manifest.features[feature] !== 'boolean')
    || FEATURE_KEYS.some((feature) => !featureKeys.includes(feature))
  ) {
    throw new Error(`Invalid AILS feature flags: ${path}`)
  }
  if (
    manifest.features['summary.local_stt']
    && !manifest.features['summary.audio_pdf']
    && !manifest.features['summary.media_files']
  ) {
    throw new Error(`AILS local STT requires audio/PDF or media summaries: ${path}`)
  }
  const expectedTasks = Object.entries(SUMMARY_TASK_FEATURES)
    .filter(([, feature]) => manifest.features[feature])
    .map(([task]) => task)
    .sort()
  const allowedTasks = [...manifest.allowed_summary_task_types].sort()
  if (JSON.stringify(expectedTasks) !== JSON.stringify(allowedTasks)) {
    throw new Error(`AILS summary tasks do not match feature flags: ${path}`)
  }
  return manifest
}

function stripBlocks(source: string, id: string, startMarker: string, endMarker: string) {
  let result = source
    .replaceAll(`{${startMarker}}`, startMarker)
    .replaceAll(`{${endMarker}}`, endMarker)
  while (result.includes(startMarker)) {
    const start = result.indexOf(startMarker)
    const end = result.indexOf(endMarker, start + startMarker.length)
    if (end < 0) throw new Error(`Missing ${endMarker} in ${id}`)
    result = result.slice(0, start) + result.slice(end + endMarker.length)
  }
  if (result.includes(endMarker)) throw new Error(`Missing ${startMarker} in ${id}`)
  return result
}

function featureMarkers(feature: string) {
  return [
    `/* @ails-feature:${feature}:start */`,
    `/* @ails-feature:${feature}:end */`,
  ] as const
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    const fields = Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    return `{${fields.join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

export default defineConfig(({ mode }) => {
  const fallback = ['development', 'production', 'test'].includes(mode) ? 'developer' : mode
  const edition = canonicalEdition(process.env.AILS_EDITION || fallback)
  const manifest = loadEditionManifest(edition)
  const manifestSha256 = createHash('sha256').update(canonicalJson(manifest), 'utf8').digest('hex')
  const summaryEnabled = Boolean(
    manifest.features['summary.audio_pdf']
    || manifest.features['summary.media_files']
    || manifest.features['summary.web_inputs'],
  )
  const defaultTaskTab = manifest.features['summary.web_inputs']
    ? 'url'
    : manifest.features['summary.audio_pdf'] || manifest.features['summary.media_files']
      ? 'media'
      : 'markdown'
  const configuredApiPort = Number(process.env.AILS_PORT || 8765)
  const apiPort = Number.isInteger(configuredApiPort) && configuredApiPort > 0 ? configuredApiPort : 8765
  let builtApiBase = ''

  return {
    cacheDir: process.env.AILS_VITE_CACHE_DIR || resolve(CONFIG_DIR, '.vite-cache'),
    server: {
      // Prepare styles before mounting the shared workspace. Warming the whole
      // application graph here delays the initial HTML response in development.
      warmup: { clientFiles: ['./src/index.css'] },
      // Exclude the directories themselves, not just their descendants, so
      // Windows does not enumerate dependency/cache trees before serving UI.
      watch: { ignored: ['**/node_modules', '**/.vite-cache'] },
      proxy: {
        '/api': {
          target: `http://127.0.0.1:${apiPort}`,
          changeOrigin: true,
          ws: true,
        },
      },
    },
    build: {
      outDir: process.env.AILS_FRONTEND_OUT_DIR || 'dist',
      emptyOutDir: true,
      // Shared icons and React otherwise become dozens of tiny HTTP requests
      // before the home workspace can evaluate. Keep heavy tools lazy.
      rolldownOptions: {
        output: {
          codeSplitting: {
            groups: [
              { name: 'ui-icons', test: /node_modules[\\/]lucide-react[\\/]/ },
              { name: 'react-runtime', test: /node_modules[\\/](?:react|react-dom|scheduler|next-themes)[\\/]/ },
              // Keep the early entry and document reads independent of App so
              // worker/read preparation can still overlap workspace loading.
              { name: 'startup', tags: ['$initial'] },
              { name: 'document-api', test: /[\\/]src[\\/]lib[\\/]api[\\/](?:core|materials|office)\.ts$/ },
              // Parsing an initial workbook must not await the grid's large UI
              // module. Its one-use response owns the result until mounting.
              { name: 'xlsx-parser', test: /[\\/]src[\\/]features[\\/]office[\\/]xlsx-adapter\.ts$/ },
              // Merge only the workspace's static dependency graph. Optional
              // editors/screens retain their dynamic import boundaries.
              { name: 'workspace', test: /[\\/]src[\\/]workspace-entry\.tsx$/ },
            ],
          },
        },
      },
    },
    define: {
      __AILS_EDITION__: JSON.stringify(edition),
      __AILS_EDITION_MANIFEST_SHA256__: JSON.stringify(manifestSha256),
      __AILS_EDITION_FEATURES__: JSON.stringify(manifest.features),
      __AILS_DEFAULT_TASK_TAB__: JSON.stringify(defaultTaskTab),
      __AILS_SUMMARY_GENERATION__: JSON.stringify(summaryEnabled),
    },
    plugins: [
      {
        name: 'ails-development-build-fingerprint',
        apply: 'build',
        configResolved(config) { builtApiBase = String(config.env.VITE_AILS_API_BASE || '').trim() },
        buildStart() {
          this.emitFile({ type: 'asset', fileName: '.ails-source-fingerprint',
            source: JSON.stringify({ edition, apiBase: builtApiBase, sha256: frontendFingerprint(resolve(CONFIG_DIR, '..')) }) })
        },
        generateBundle: { order: 'post', handler(_options, bundle) {
          // Large editor/worker scripts otherwise cross the local HTTP stack
          // uncompressed on every fresh profile. Compress generated code only;
          // document responses and public assets keep their existing behavior.
          // Run after Vite's generateBundle import/preload rewrites so the
          // compressed representation contains the exact final JavaScript.
          const compressed: string[] = []
          for (const asset of Object.values(bundle)) {
            if (!/^assets\/.+-[\w-]{8}\.(?:js|mjs|css)$/.test(asset.fileName)) continue
            const bytes = Buffer.from(asset.type === 'chunk' ? asset.code : asset.source)
            if (bytes.length < 1024) continue
            const gzip = gzipSync(bytes)
            if (gzip.length >= bytes.length * 0.9) continue
            compressed.push(asset.fileName)
            this.emitFile({ type: 'asset', fileName: `${asset.fileName}.gz`, source: gzip })
          }
          this.emitFile({ type: 'asset', fileName: '.ails-compressed-assets.json', source: JSON.stringify(compressed) })
          // Only generated, content-addressed assets can be reused without
          // validation. Public files and index.html retain normal revalidation.
          this.emitFile({ type: 'asset', fileName: '.ails-immutable-assets.json',
            source: JSON.stringify(Object.keys(bundle).filter(name => /^assets\/.+-[\w-]{8}\.[^/]+$/.test(name))) })
          const sheets = Object.values(bundle).find(chunk => chunk.type === 'chunk'
            && chunk.facadeModuleId?.replaceAll('\\', '/').endsWith('/src/features/office/sheets-engine.ts'))
          if (sheets) this.emitFile({ type: 'asset', fileName: '.ails-entry-preloads.json',
            source: JSON.stringify({ csv: sheets.fileName, xlsx: sheets.fileName }) })
        } },
      },
      {
        name: 'ails-edition-source-filter',
        enforce: 'pre',
        transform(source, id) {
          if (!/[\\/]src[\\/].+\.[cm]?[jt]sx?$/.test(id)) return null
          if (!manifest.features.ide) {
            const path = id.replaceAll('\\', '/')
            if (path.endsWith('/notebook-workspace.tsx')) return { code: 'export const NotebookWorkspace = () => null', map: null }
            if (path.endsWith('/folder-editor.tsx')) return { code: 'export const FolderEditor = () => null', map: null }
            if (path.endsWith('/code-start-screen.tsx')) return { code: 'export const CodeStartScreen = () => null', map: null }
          }
          // No subscription code, polling, OAuth UI or API URLs in release builds.
          if (edition !== 'developer' && edition !== 'personal') {
            const path = id.replaceAll('\\', '/')
            if (path.endsWith('/chatgpt-plan-indicator.tsx')) return { code: 'export const ChatGPTPlanIndicator = () => null; export const ChatGPTPlanIndicatorForConfig = () => null', map: null }
            if (path.endsWith('/ai-provider-settings.tsx')) return { code: 'export const AiProviderSettingsPanel = () => null', map: null }
            if (path.endsWith('/use-chatgpt-composer-models.ts')) return { code: 'export const useChatGPTComposerModels = () => ({ models: [], loading: false, error: "", reload: undefined })', map: null }
            if (path.endsWith('/lib/api/chatgpt.ts')) throw new Error(`Subscription API reached non-developer bundle: ${id}`)
          }
          let code = source
          if (!summaryEnabled) {
            code = stripBlocks(code, id, SUMMARY_START, SUMMARY_END)
          }
          for (const [feature, enabled] of Object.entries(manifest.features)) {
            if (enabled) continue
            const [start, end] = featureMarkers(feature)
            code = stripBlocks(code, id, start, end)
          }
          return code === source ? null : { code, map: null }
        },
      },
      react(),
      tailwindcss(),
    ],
  }
})
