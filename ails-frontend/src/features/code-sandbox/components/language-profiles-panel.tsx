import { t } from "../../../lib/i18n.ts"
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react"
import {
  AlertCircle,
  CheckCircle2,
  Download,
  Loader2,
  Package,
  Plus,
  RefreshCw,
  Search,
  Server,
  Trash2,
} from "lucide-react"

import {
  deleteLanguageProfile,
  getLanguagePackInstallStatus,
  getLanguageProfiles,
  installLanguagePack,
  saveLanguageProfile,
  searchLanguageRegistry,
  type LanguagePackInstallJob,
  type LanguageProfile,
  type LanguageProfileCommand,
  type LanguageRegistrySearchPayload,
} from "../../../lib/api"


const EMPTY_PROFILE: LanguageProfile = {
  id: "",
  label: "",
  extensions: [],
  executable: "",
  arguments: ["{file}"],
  commands: { run: { executable: "", arguments: ["{file}"] } },
  version_arguments: ["--version"],
  template: "",
  command_state: "ready",
}

const PHASE_LABELS: Record<string, string> = {
  preparing: "설치 준비",
  downloading_syntax: "문법 확장 검증 및 다운로드",
  installing_runtime: "런타임 설치",
  installing_language_server: "언어 서버 설치",
  verifying_toolchain: "컴파일러 및 실행 명령 검증",
  registering_profile: "프로필 등록",
  completed: "설치 완료",
  failed: "설치 실패",
}

interface LanguageProfilesPanelProps {
  allowInstallation?: boolean
  onProfilesChange?: (profiles: LanguageProfile[]) => void
}

function command(profile: LanguageProfile, action: "run" | "build" | "test"): LanguageProfileCommand | undefined {
  if (action === "run") {
    return profile.commands?.run || { executable: profile.executable, arguments: profile.arguments }
  }
  return profile.commands?.[action]
}

export function LanguageProfilesPanel({ onProfilesChange, allowInstallation = true }: LanguageProfilesPanelProps) {
  const [mode, setMode] = useState<"registry" | "manual">(allowInstallation ? "registry" : "manual")
  const [profiles, setProfiles] = useState<LanguageProfile[]>([])
  const [path, setPath] = useState("")
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [draft, setDraft] = useState<LanguageProfile>(EMPTY_PROFILE)
  const [extensionsText, setExtensionsText] = useState("")
  const [runArguments, setRunArguments] = useState("{file}")
  const [buildExecutable, setBuildExecutable] = useState("")
  const [buildArguments, setBuildArguments] = useState("")
  const [testExecutable, setTestExecutable] = useState("")
  const [testArguments, setTestArguments] = useState("")
  const [query, setQuery] = useState("")
  const [searching, setSearching] = useState(false)
  const [results, setResults] = useState<LanguageRegistrySearchPayload | null>(null)
  const [selectedExtension, setSelectedExtension] = useState("")
  const [selectedRuntime, setSelectedRuntime] = useState("")
  const [selectedServer, setSelectedServer] = useState("")
  const [installJob, setInstallJob] = useState<LanguagePackInstallJob | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError("")
    try {
      const result = await getLanguageProfiles()
      setProfiles(result.profiles)
      setPath(result.path)
      onProfilesChange?.(result.profiles)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError))
    } finally {
      setLoading(false)
    }
  }, [onProfilesChange])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    if (!installJob || !["queued", "running"].includes(installJob.status)) return
    const timer = window.setTimeout(() => {
      void getLanguagePackInstallStatus(installJob.job_id)
        .then((job) => {
          setInstallJob(job)
          if (job.status === "completed") void load()
        })
        .catch((pollError) => setError(pollError instanceof Error ? pollError.message : String(pollError)))
    }, 700)
    return () => window.clearTimeout(timer)
  }, [installJob, load])

  const chosenExtension = useMemo(
    () => results?.extensions.find((item) => item.id === selectedExtension),
    [results, selectedExtension],
  )
  const oneClickReady = Boolean(
    chosenExtension &&
    results?.recipe.available &&
    selectedRuntime &&
    selectedRuntime === results.recommended_runtime_id,
  )

  function editProfile(profile: LanguageProfile) {
    const run = command(profile, "run")
    const build = command(profile, "build")
    const test = command(profile, "test")
    setDraft({ ...profile, executable: run?.executable || "", arguments: run?.arguments || [] })
    setExtensionsText(profile.extensions.join(", "))
    setRunArguments((run?.arguments || []).join("\n"))
    setBuildExecutable(build?.executable || "")
    setBuildArguments((build?.arguments || []).join("\n"))
    setTestExecutable(test?.executable || "")
    setTestArguments((test?.arguments || []).join("\n"))
    setMode("manual")
    setError("")
  }

  function resetDraft() {
    setDraft(EMPTY_PROFILE)
    setExtensionsText("")
    setRunArguments("{file}")
    setBuildExecutable("")
    setBuildArguments("")
    setTestExecutable("")
    setTestArguments("")
    setError("")
  }

  function splitArguments(value: string) {
    return value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean)
  }

  async function save() {
    setSaving(true)
    setError("")
    try {
      const commands: LanguageProfile["commands"] = {
        run: {
          ...draft.commands?.run,
          executable: draft.executable,
          arguments: splitArguments(runArguments),
        },
      }
      if (buildExecutable.trim()) commands.build = {
        ...draft.commands?.build,
        executable: buildExecutable.trim(),
        arguments: splitArguments(buildArguments),
      }
      if (testExecutable.trim()) commands.test = {
        ...draft.commands?.test,
        executable: testExecutable.trim(),
        arguments: splitArguments(testArguments),
      }
      await saveLanguageProfile({
        ...draft,
        extensions: extensionsText.split(/[\s,]+/).map((value) => value.trim()).filter(Boolean),
        arguments: splitArguments(runArguments),
        commands,
        command_state: "ready",
      })
      resetDraft()
      await load()
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError))
    } finally {
      setSaving(false)
    }
  }

  async function remove(profileId: string) {
    setError("")
    try {
      await deleteLanguageProfile(profileId)
      if (draft.id === profileId) resetDraft()
      await load()
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : String(deleteError))
    }
  }

  async function searchRegistry() {
    if (query.trim().length < 1) return
    setSearching(true)
    setError("")
    setInstallJob(null)
    try {
      const next = await searchLanguageRegistry(query.trim())
      setResults(next)
      setSelectedExtension(next.extensions[0]?.id || "")
      setSelectedRuntime(next.recommended_runtime_id || "")
      setSelectedServer("")
    } catch (searchError) {
      setError(searchError instanceof Error ? searchError.message : String(searchError))
    } finally {
      setSearching(false)
    }
  }

  async function installSelected() {
    if (!chosenExtension) return
    setError("")
    try {
      const job = await installLanguagePack({
        extension: { id: chosenExtension.id, version: chosenExtension.version },
        runtime_id: selectedRuntime || undefined,
        language_server_id: selectedServer || undefined,
        language_id: results?.recipe.language_id || query.trim(),
      })
      setInstallJob(job)
    } catch (installError) {
      setError(installError instanceof Error ? installError.message : String(installError))
    }
  }

  const installing = Boolean(installJob && ["queued", "running"].includes(installJob.status))

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-white/10 pb-3">
        <div className="flex rounded-md border border-white/10 bg-black/20 p-0.5">
          {allowInstallation && <button className={`h-8 rounded px-3 text-[10px] font-semibold ${mode === "registry" ? "bg-white/10 text-white" : "text-white/45"}`} onClick={() => setMode("registry")} type="button">{t("레지스트리")}</button>}
          <button className={`h-8 rounded px-3 text-[10px] font-semibold ${mode === "manual" ? "bg-white/10 text-white" : "text-white/45"}`} onClick={() => setMode("manual")} type="button">{t("직접 설정")}</button>
        </div>
        <button className="flex h-8 w-8 items-center justify-center rounded-md border border-white/10 bg-white/5 text-white/65" onClick={() => void load()} title={t("새로 고침")} type="button">
          <RefreshCw className={loading ? "animate-spin" : ""} size={13} />
        </button>
      </div>

      {allowInstallation && mode === "registry" ? (
        <div className="min-h-0 flex-1 overflow-y-auto pr-1">
          <form className="flex gap-2" onSubmit={(event) => { event.preventDefault(); void searchRegistry() }}>
            <div className="relative min-w-0 flex-1">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-white/35" size={14} />
              <input className="h-9 w-full rounded-md border border-white/10 bg-black/25 pl-8 pr-3 text-xs text-white outline-none focus:border-[var(--brand)]" onChange={(event) => setQuery(event.target.value)} placeholder="Zig, Elixir, Kotlin, C3..." value={query} />
            </div>
            <button className="flex h-9 items-center gap-2 rounded-md bg-[var(--brand)] px-4 text-[10px] font-semibold text-white disabled:opacity-50" disabled={searching || query.trim().length < 1} type="submit">
              {searching ? <Loader2 className="animate-spin" size={13} /> : <Search size={13} />} {t("검색")}</button>
          </form>

          {!results && (
            <div className="mt-5 grid divide-y divide-white/10 border-y border-white/10 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
              <SourceItem icon={<Package size={15} />} label="Open VSX" value={t("문법 및 파일 형식")} />
              <SourceItem icon={<Download size={15} />} label="mise" value={t("컴파일러 및 런타임")} />
              <SourceItem icon={<Server size={15} />} label="Mason" value={t("언어 서버 바이너리")} />
            </div>
          )}

          {results && (
            <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(260px,0.8fr)]">
              <section className="min-w-0">
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="text-[11px] font-semibold text-white/75">{t("Open VSX 문법 확장")}</h3>
                  <span className="text-[9px] text-white/30">{results.extensions.length}{t("개")}</span>
                </div>
                <div className="divide-y divide-white/10 border-y border-white/10">
                  {results.extensions.map((extension) => (
                    <button className={`flex w-full items-start gap-3 px-2 py-3 text-left ${selectedExtension === extension.id ? "bg-white/[0.07]" : "hover:bg-white/[0.035]"}`} key={`${extension.id}-${extension.version}`} onClick={() => setSelectedExtension(extension.id)} type="button">
                      <span className={`mt-1 h-3 w-3 shrink-0 rounded-full border ${selectedExtension === extension.id ? "border-[var(--brand)] bg-[var(--brand)] shadow-[inset_0_0_0_3px_#18181b]" : "border-white/25"}`} />
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-2 text-[11px] font-semibold text-white/80">
                          {extension.label}
                          {extension.verified && <span className="text-[8px] font-medium text-emerald-300">{t("인증 게시자")}</span>}
                        </span>
                        <span className="mt-0.5 block truncate text-[9px] text-white/40">{extension.id} · v{extension.version} · {extension.downloads.toLocaleString()}{t("회")}</span>
                        {extension.description && <span className="mt-1 block line-clamp-2 text-[9px] leading-4 text-white/35">{extension.description}</span>}
                      </span>
                    </button>
                  ))}
                  {results.extensions.length === 0 && <div className="px-3 py-5 text-center text-[10px] text-white/35">{t("검색된 문법 확장이 없습니다.")}</div>}
                </div>
              </section>

              <section className="min-w-0 border-l border-white/10 pl-4">
                <h3 className="mb-3 text-[11px] font-semibold text-white/75">{t("설치 구성")}</h3>
                <div className={`mb-3 border-l-2 pl-2 text-[9px] leading-4 ${results.recipe.available ? "border-emerald-400/70 text-emerald-200/80" : "border-amber-400/70 text-amber-200/80"}`}>
                  {results.recipe.available ? (
                    <>
                      <div className="flex items-center gap-1.5 font-semibold"><CheckCircle2 size={11} /> {t("안전한 실행 레시피 확인")}</div>
                      <div className="text-white/35">{results.recipe.source}{results.recipe.version ? ` v${results.recipe.version}` : ""} · {results.recipe.executables.join(", ")}</div>
                    </>
                  ) : (
                    <div className="flex items-center gap-1.5"><AlertCircle size={11} /> {t("자동 실행 레시피를 찾지 못했습니다.")}</div>
                  )}
                </div>
                <label className="grid gap-1.5 text-[10px] font-medium text-white/50">
                  {t("런타임 · mise")}<select className="h-9 rounded-md border border-white/10 bg-[#18181b] px-2 text-[10px] text-white outline-none focus:border-[var(--brand)]" onChange={(event) => setSelectedRuntime(event.target.value)} value={selectedRuntime}>
                    <option value="">{t("설치하지 않음")}</option>
                    {results.runtimes.map((runtime) => <option key={runtime.id} value={runtime.id}>{runtime.label}@latest{runtime.recommended ? t(" (추천)") : ""}</option>)}
                  </select>
                </label>
                {results.recipe.available && !results.recommended_runtime_id && (
                  <div className="mt-2 text-[9px] leading-4 text-amber-200/70">{t("이 실행 레시피와 호환되는 Windows 런타임이 mise 레지스트리에 없습니다.")}</div>
                )}
                {selectedRuntime && selectedRuntime !== results.recommended_runtime_id && (
                  <div className="mt-2 text-[9px] leading-4 text-amber-200/70">{t("선택한 런타임과 실행 명령의 호환성이 확인되지 않았습니다.")}</div>
                )}
                <label className="mt-3 grid gap-1.5 text-[10px] font-medium text-white/50">
                  {t("언어 서버 바이너리 · Mason")}<select className="h-9 rounded-md border border-white/10 bg-[#18181b] px-2 text-[10px] text-white outline-none focus:border-[var(--brand)]" onChange={(event) => setSelectedServer(event.target.value)} value={selectedServer}>
                    <option value="">{t("설치하지 않음")}</option>
                    {results.language_servers.map((server) => <option disabled={!server.install_supported} key={server.id} value={server.id}>{server.label}{server.install_supported ? "" : t(" (자동 설치 미지원)")}</option>)}
                  </select>
                </label>

                {results.errors.length > 0 && (
                  <div className="mt-3 border-l-2 border-amber-400/60 pl-2 text-[9px] leading-4 text-amber-200/75">
                    {results.errors.map((item) => <div key={item.source}>{item.source}: {item.error}</div>)}
                  </div>
                )}

                {installJob && (
                  <div className="mt-4 border-y border-white/10 py-3">
                    <div className="flex items-center justify-between text-[9px] text-white/55">
                      <span>{t(PHASE_LABELS[installJob.phase] || installJob.phase)}</span>
                      <span>{Math.round(installJob.progress_percent)}%</span>
                    </div>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10">
                      <div className={`h-full transition-[width] ${installJob.status === "failed" ? "bg-red-400" : "bg-[var(--brand)]"}`} style={{ width: `${installJob.progress_percent}%` }} />
                    </div>
                    {installJob.status === "completed" && (
                      <div className="mt-2 flex items-center gap-1.5 text-[9px] text-emerald-300"><CheckCircle2 size={12} /> {installJob.profile?.label} {t("프로필 등록 완료")}</div>
                    )}
                    {installJob.error && <div className="mt-2 whitespace-pre-wrap text-[9px] leading-4 text-red-300">{installJob.error}</div>}
                    {installJob.output && <pre className="mt-2 max-h-24 overflow-auto whitespace-pre-wrap bg-black/20 p-2 text-[8px] leading-4 text-white/35">{installJob.output}</pre>}
                  </div>
                )}

                <button className="mt-4 flex h-9 w-full items-center justify-center gap-2 rounded-md bg-[var(--brand)] text-[10px] font-semibold text-white disabled:opacity-40" disabled={!oneClickReady || installing} onClick={() => void installSelected()} type="button">
                  {installing ? <Loader2 className="animate-spin" size={13} /> : <Download size={13} />}
                  {installing ? t("설치 중") : t("언어 원클릭 설치")}
                </button>
                <div className="mt-2 text-[8px] leading-4 text-white/30">{t("문법, 추천 런타임, 검증된 실행 레시피를 함께 설치합니다. 언어 서버는 선택 사항이며 외부 확장 코드는 실행하지 않습니다.")}</div>
              </section>
            </div>
          )}
        </div>
      ) : (
        <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[minmax(220px,0.72fr)_minmax(360px,1.28fr)]">
          <section className="min-h-0 overflow-y-auto border-r border-white/10 pr-3">
            <button className="mb-2 flex w-full items-center gap-2 rounded-md border border-dashed border-white/15 px-3 py-2 text-left text-[10px] font-semibold text-white/60 hover:bg-white/5" onClick={resetDraft} type="button">
              <Plus size={13} /> {t("새 프로필")}</button>
            <div className="divide-y divide-white/10 border-y border-white/10">
              {profiles.map((profile) => (
                <div className="flex items-center gap-2 py-2" key={profile.id}>
                  {profile.installed ? <CheckCircle2 className="shrink-0 text-emerald-400" size={14} /> : <AlertCircle className="shrink-0 text-amber-400" size={14} />}
                  <button className="min-w-0 flex-1 text-left" onClick={() => editProfile(profile)} type="button">
                    <span className="flex items-center gap-1.5 truncate text-[11px] font-semibold text-white/80">
                      {profile.label}
                      {profile.source?.registry && <span className="text-[8px] font-normal text-sky-300">{profile.source.registry}</span>}
                    </span>
                    <span className="block truncate font-mono text-[9px] text-white/35">.{profile.extensions.join(", .")} · {profile.executable}</span>
                    {profile.command_state === "needs_review" && <span className="text-[8px] text-amber-300">{t("실행 명령 검토 필요")}</span>}
                  </button>
                  <button className="flex h-7 w-7 items-center justify-center rounded-md text-white/35 hover:bg-red-500/15 hover:text-red-300" onClick={() => void remove(profile.id)} title={t("프로필 삭제")} type="button"><Trash2 size={13} /></button>
                </div>
              ))}
              {!loading && profiles.length === 0 && <div className="p-4 text-center text-[10px] text-white/30">{t("추가된 프로필이 없습니다.")}</div>}
            </div>
            {path && <div className="mt-3 truncate font-mono text-[8px] text-white/20" title={path}>{path}</div>}
          </section>

          <section className="min-h-0 overflow-y-auto pr-1">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t("프로필 ID")}><input className="profile-input" onChange={(event) => setDraft((current) => ({ ...current, id: event.target.value }))} placeholder="zig" value={draft.id} /></Field>
              <Field label={t("표시 이름")}><input className="profile-input" onChange={(event) => setDraft((current) => ({ ...current, label: event.target.value }))} placeholder="Zig" value={draft.label} /></Field>
              <Field label={t("파일 확장자")}><input className="profile-input font-mono" onChange={(event) => setExtensionsText(event.target.value)} placeholder="zig, zon" value={extensionsText} /></Field>
              <Field label={t("실행 파일")}><input className="profile-input font-mono" onChange={(event) => setDraft((current) => ({ ...current, executable: event.target.value }))} placeholder="zig" value={draft.executable} /></Field>
              <Field className="sm:col-span-2" label={t("실행 인수 · 한 줄에 하나")}><textarea className="profile-textarea min-h-16" onChange={(event) => setRunArguments(event.target.value)} value={runArguments} /></Field>
              <Field label={t("빌드 실행 파일 · 선택")}><input className="profile-input font-mono" onChange={(event) => setBuildExecutable(event.target.value)} placeholder="zig" value={buildExecutable} /></Field>
              <Field label={t("빌드 인수")}><textarea className="profile-textarea min-h-16" onChange={(event) => setBuildArguments(event.target.value)} placeholder={"build-exe\n{file}"} value={buildArguments} /></Field>
              <Field label={t("테스트 실행 파일 · 선택")}><input className="profile-input font-mono" onChange={(event) => setTestExecutable(event.target.value)} placeholder="zig" value={testExecutable} /></Field>
              <Field label={t("테스트 인수")}><textarea className="profile-textarea min-h-16" onChange={(event) => setTestArguments(event.target.value)} placeholder={"test\n{file}"} value={testArguments} /></Field>
              <Field className="sm:col-span-2" label={t("새 파일 템플릿")}><textarea className="profile-textarea min-h-24" onChange={(event) => setDraft((current) => ({ ...current, template: event.target.value }))} value={draft.template} /></Field>
            </div>
            <div className="mt-2 text-[9px] text-white/35"><code>{"{file}"}</code> <code>{"{file_name}"}</code> <code>{"{work_dir}"}</code> <code>{"{project_dir}"}</code></div>
            <div className="mt-3 flex justify-end">
              <button className="flex items-center gap-2 rounded-md bg-[var(--brand)] px-3 py-2 text-[10px] font-semibold text-white disabled:opacity-50" disabled={saving || !draft.id || !draft.label || !draft.executable || !extensionsText.trim()} onClick={() => void save()} type="button">
                {saving ? <Loader2 className="animate-spin" size={13} /> : <Plus size={13} />} {t("프로필 저장")}</button>
            </div>
          </section>
        </div>
      )}

      {error && <div className="shrink-0 whitespace-pre-wrap border-l-2 border-red-400 bg-red-500/10 px-3 py-2 text-[10px] text-red-300">{error}</div>}
    </div>
  )
}

function SourceItem({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return <div className="flex items-center gap-3 px-4 py-3 text-white/50">{icon}<div><div className="text-[10px] font-semibold text-white/70">{label}</div><div className="text-[9px]">{value}</div></div></div>
}

function Field({ label, className = "", children }: { label: string; className?: string; children: ReactNode }) {
  return <label className={`grid gap-1 text-[10px] font-medium text-white/50 ${className}`}>{label}{children}</label>
}
