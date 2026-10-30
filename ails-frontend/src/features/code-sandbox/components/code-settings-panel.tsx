import { t } from "../../../lib/i18n.ts"
import React from "react"
import { ArrowLeft, Keyboard, Layers, RefreshCw, Settings, Terminal, Type, X } from "lucide-react"
import { type CodeConsoleEncoding, type LanguageProfile } from "../../../lib/api"
/* @ails-feature:developer_tools:start */
import { DeveloperToolsPanel } from "./developer-tools-panel.tsx"
import { LanguageProfilesPanel } from "./language-profiles-panel.tsx"
/* @ails-feature:developer_tools:end */
import { CODE_SHORTCUT_DEFINITIONS, formatCodeShortcut, type CodeKeymapProfile, type CodeShortcutAction } from "../lib/code-shortcuts.ts"
import { fallbackTemplate, getLanguageLabel } from "../lib/code-sandbox-support.ts"

interface CodeSettingsPanelProps {
  consoleEncoding: CodeConsoleEncoding
  changeConsoleEncoding: (value: string) => void
  folderMode?: boolean
  applyTemplate?: () => void

  settingsTab: "editor" | "templates" | "toolchains" | "languages"
  setSettingsTab: React.Dispatch<React.SetStateAction<"editor" | "templates" | "toolchains" | "languages">>
  setIsSettingTemplate: React.Dispatch<React.SetStateAction<boolean>>
  handleSettingsContentWheel: (event: React.WheelEvent<HTMLElement>) => void
  settingsContentRef: React.RefObject<HTMLElement | null>
  settingsContentFontSize: number
  keymapProfile: CodeKeymapProfile
  changeKeymapProfile: (profile: string) => void
  resetAllCodeShortcuts: () => void
  shortcutMessage: string
  recordingShortcutAction: "run" | "save" | "saveAll" | "newFile" | "newProject" | "closeFile" | "renameFile" | "nextTab" | "previousTab" | "nextProject" | "previousProject" | "nextPdfPage" | "previousPdfPage" | "promptEdit" | "toggleChatbot" | null
  shortcutOverridesByProfile: Partial<Record<CodeKeymapProfile, Partial<Record<"run" | "save" | "saveAll" | "newFile" | "newProject" | "closeFile" | "renameFile" | "nextTab" | "previousTab" | "nextProject" | "previousProject" | "nextPdfPage" | "previousPdfPage" | "promptEdit" | "toggleChatbot", string>>>>
  setShortcutMessage: React.Dispatch<React.SetStateAction<string>>
  setRecordingShortcutAction: React.Dispatch<React.SetStateAction<"run" | "save" | "saveAll" | "newFile" | "newProject" | "closeFile" | "renameFile" | "nextTab" | "previousTab" | "nextProject" | "previousProject" | "nextPdfPage" | "previousPdfPage" | "promptEdit" | "toggleChatbot" | null>>
  codeShortcuts: import("../lib/code-shortcuts.ts").CodeShortcutMap
  changeCodeShortcut: (action: CodeShortcutAction, shortcut: string) => boolean
  resetCodeShortcut: (action: CodeShortcutAction) => void
  editorFontSize: number
  updateEditorFontSize: (nextValue: number) => void
  sidebarListFontSize: number
  adjustSidebarListFontSize: (direction: number) => void
  aiReviewFontSize: number
  adjustAiReviewFontSize: (direction: number) => void
  adjustSettingsContentFontSize: (direction: number) => void
  settingLanguage: string
  setSettingLanguage: React.Dispatch<React.SetStateAction<string>>
  customLanguageProfiles: LanguageProfile[]
  customTemplateText: string
  setCustomTemplateText: React.Dispatch<React.SetStateAction<string>>
  saveCustomTemplate: () => void
  templateSaveOk: boolean
  applyCustomLanguageProfiles: (profiles: LanguageProfile[]) => void
}

export function CodeSettingsPanel({
  consoleEncoding,
  changeConsoleEncoding,
  folderMode = false,
  applyTemplate,
  settingsTab,
  setSettingsTab,
  setIsSettingTemplate,
  handleSettingsContentWheel,
  settingsContentRef,
  settingsContentFontSize,
  keymapProfile,
  changeKeymapProfile,
  resetAllCodeShortcuts,
  shortcutMessage,
  recordingShortcutAction,
  shortcutOverridesByProfile,
  setShortcutMessage,
  setRecordingShortcutAction,
  codeShortcuts,
  changeCodeShortcut,
  resetCodeShortcut,
  editorFontSize,
  updateEditorFontSize,
  sidebarListFontSize,
  adjustSidebarListFontSize,
  aiReviewFontSize,
  adjustAiReviewFontSize,
  adjustSettingsContentFontSize,
  settingLanguage,
  setSettingLanguage,
  customLanguageProfiles,
  customTemplateText,
  setCustomTemplateText,
  saveCustomTemplate,
  templateSaveOk,
  applyCustomLanguageProfiles,
}: CodeSettingsPanelProps) {
  const consoleEncodingId = React.useId()
  return (
    <div
      aria-label={t("코드 편집기 설정")}
      aria-modal="true"
      className="ails-code-layout-border fixed left-1/2 top-1/2 z-[120] flex h-[min(760px,calc(100vh-48px))] w-[min(1100px,calc(100vw-48px))] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-xl border bg-[var(--panel)] text-[var(--foreground)] shadow-2xl"
      role="dialog"
    >
      <aside className="flex w-52 shrink-0 flex-col border-r border-white/10 bg-black/20 p-3">
        <div className="px-2 pb-2 pt-1 text-[10px] font-semibold uppercase text-white/35">Code Settings</div>
        {([
          ["editor", Settings, t("편집기")],
          ["templates", Type, t("템플릿")],
          /* @ails-feature:developer_tools:start */
          ["toolchains", Terminal, t("도구 체인")],
          ["languages", Layers, t("사용자 언어")],
          /* @ails-feature:developer_tools:end */
        ] as const).filter(([tab]) => !folderMode || tab !== "toolchains").map(([tab, Icon, label]) => (
          <button
            className={`mb-1 flex h-9 items-center gap-2 rounded-md px-2 text-left text-[10px] font-semibold ${settingsTab === tab ? "bg-[var(--brand)] text-white" : "text-white/50 hover:bg-white/5 hover:text-white"}`}
            key={tab}
            onClick={() => setSettingsTab(tab)}
            type="button"
          >
            <Icon className="shrink-0" size={13} /> <span className="whitespace-nowrap">{label}</span>
          </button>
        ))}
        <div className="mt-auto border-t border-white/10 pt-2">
          <button className="flex h-9 w-full items-center gap-2 rounded-md px-2 text-[10px] font-semibold text-white/50 hover:bg-white/5 hover:text-white" onClick={() => setIsSettingTemplate(false)} type="button">
            <ArrowLeft className="shrink-0" size={12} /> <span className="whitespace-nowrap">{t("설정 창 닫기")}</span>
          </button>
        </div>
      </aside>

      <main
        className="ails-code-settings-content min-w-0 flex-1 overflow-y-auto p-4"
        onWheel={handleSettingsContentWheel}
        ref={settingsContentRef}
        style={{
          "--ails-code-settings-font-size": `${settingsContentFontSize}px`,
          "--ails-code-settings-font-delta": `${settingsContentFontSize - 10}px`,
        } as React.CSSProperties}
      >
        {settingsTab === "editor" && (
          <div className="mx-auto max-w-3xl space-y-4">
            <section className="rounded-lg border border-white/10 bg-white/[0.025] p-4">
              <label className="mb-3 flex items-center gap-2 text-xs font-semibold text-[var(--foreground)]" htmlFor={consoleEncodingId}>
                <Terminal size={14} className="text-[var(--brand)]" /> {t("콘솔 입출력 인코딩")}
              </label>
              <select id={consoleEncodingId} data-ails-console-encoding value={consoleEncoding}
                onChange={(event) => changeConsoleEncoding(event.target.value)}
                className="h-9 w-full rounded-md border border-white/10 bg-[var(--panel)] px-3 text-[10px] text-[var(--foreground)]">
                <option value="auto">{t("자동")}</option>
                <option value="utf-8">UTF-8</option>
                <option value="cp949">CP949</option>
              </select>
            </section>
            <section className="rounded-lg border border-white/10 bg-white/[0.025] p-4">
              <div className="mb-3 flex items-center gap-2 text-xs font-semibold text-white/80">
                <Keyboard size={14} className="text-[var(--brand)]" /> {t("키맵 프로필")}</div>
              <div className="grid gap-2 sm:grid-cols-3">
                {["vscode", "visualstudio", "jetbrains"].map((profile) => (
                  <button
                    key={profile}
                    className={`h-9 rounded-md border px-3 text-[10px] font-semibold ${keymapProfile === profile ? "border-[var(--brand)] bg-[var(--brand)] text-white" : "border-white/10 bg-black/20 text-white/50 hover:bg-white/5 hover:text-white"}`}
                    onClick={() => changeKeymapProfile(profile)}
                    type="button"
                  >
                    {profile === "vscode" ? "VS Code" : profile === "visualstudio" ? "Visual Studio" : "JetBrains"}
                  </button>
                ))}
              </div>
            </section>
            <section className="rounded-lg border border-white/10 bg-white/[0.025] p-4">
              <div className="mb-1 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-xs font-semibold text-white/80">
                  <Keyboard size={14} className="text-[var(--brand)]" /> {t("사용자 단축키")}</div>
                <button
                  className="flex h-8 items-center gap-1.5 rounded-md border border-white/10 bg-black/20 px-2.5 text-[9px] font-semibold text-white/55 hover:bg-white/5 hover:text-white"
                  onClick={resetAllCodeShortcuts}
                  type="button"
                >
                  <RefreshCw size={11} /> {t("프로필 기본값 복원")}</button>
              </div>
              <p className="mb-3 text-[9px] leading-4 text-white/35">
                {t("변경할 항목을 누른 뒤 원하는 키 조합을 입력하세요. Esc는 취소, Backspace/Delete는 해당 단축키를 끕니다.")}</p>
              {shortcutMessage && (
                <div className="mb-3 rounded-md border border-red-400/25 bg-red-400/10 px-3 py-2 text-[10px] text-red-200">
                  {shortcutMessage}
                </div>
              )}
              <div className="grid gap-2 lg:grid-cols-2">
                {CODE_SHORTCUT_DEFINITIONS.filter((definition) => !folderMode || definition.group !== "학습 및 AI").map((definition) => {
                  const isRecording = recordingShortcutAction === definition.action
                  const isCustomized = Object.prototype.hasOwnProperty.call(
                    shortcutOverridesByProfile[keymapProfile] || {},
                    definition.action,
                  )
                  return (
                    <div
                      className="grid min-h-14 grid-cols-[minmax(0,1fr)_minmax(118px,auto)_28px_28px] items-center gap-1.5 rounded-md border border-white/10 bg-black/20 px-2.5 py-2"
                      key={definition.action}
                    >
                      <div className="min-w-0">
                        <div className="break-words text-[10px] font-semibold leading-4 text-white/70">{folderMode ? t(definition.label.replace("프로젝트", "작업 폴더")) : t(definition.label)}</div>
                        <div className="mt-0.5 break-words text-[8px] leading-3 text-white/30">
                          {definition.group}{isCustomized ? t(" · 사용자 지정") : ""}
                        </div>
                      </div>
                      <button
                        className={`h-8 min-w-0 rounded-md border px-2 font-mono text-[9px] font-semibold ${isRecording ? "border-[var(--brand)] bg-[var(--brand)] text-white" : "border-white/10 bg-white/5 text-amber-300 hover:border-white/20 hover:bg-white/10"}`}
                        onClick={() => {
                          setShortcutMessage("")
                          setRecordingShortcutAction(definition.action)
                        }}
                        title={t("{p0} 단축키 변경", { p0: definition.label })}
                        type="button"
                      >
                        <span className="block truncate">
                          {isRecording ? t("키를 누르세요...") : formatCodeShortcut(codeShortcuts[definition.action])}
                        </span>
                      </button>
                      <button
                        aria-label={t("{p0} 단축키 끄기", { p0: definition.label })}
                        className="flex h-7 w-7 items-center justify-center rounded-md text-white/35 hover:bg-white/5 hover:text-white"
                        onClick={() => changeCodeShortcut(definition.action, "")}
                        title={t("단축키 끄기")}
                        type="button"
                      >
                        <X size={12} />
                      </button>
                      <button
                        aria-label={t("{p0} 단축키 기본값 복원", { p0: definition.label })}
                        className="flex h-7 w-7 items-center justify-center rounded-md text-white/35 hover:bg-white/5 hover:text-white disabled:opacity-25"
                        disabled={!isCustomized}
                        onClick={() => resetCodeShortcut(definition.action)}
                        title={t("기본값 복원")}
                        type="button"
                      >
                        <RefreshCw size={11} />
                      </button>
                    </div>
                  )
                })}
              </div>
            </section>
            <section className="rounded-lg border border-white/10 bg-white/[0.025] p-4">
              <div className="mb-3 flex items-center gap-2 text-xs font-semibold text-white/80">
                <Type size={14} className="text-[var(--brand)]" /> {t("글꼴 크기")}</div>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                {[
                  [t("에디터"), editorFontSize, () => updateEditorFontSize(editorFontSize - 1), () => updateEditorFontSize(editorFontSize + 1)],
                  [t("파일 목록"), sidebarListFontSize, () => adjustSidebarListFontSize(-1), () => adjustSidebarListFontSize(1)],
                  [t("AI 진단"), aiReviewFontSize, () => adjustAiReviewFontSize(-1), () => adjustAiReviewFontSize(1)],
                  [t("설정 내용"), settingsContentFontSize, () => adjustSettingsContentFontSize(-1), () => adjustSettingsContentFontSize(1)],
                ].map(([label, value, decrease, increase]) => (
                  <div className="rounded-md border border-white/10 bg-black/20 p-3" key={String(label)}>
                    <div className="mb-2 text-[10px] text-white/45">{String(label)}</div>
                    <div className="grid grid-cols-[32px_1fr_32px] items-center gap-2">
                      <button className="h-8 rounded-md border border-white/10 bg-white/5 text-sm text-white/65" onClick={decrease as () => void} type="button">-</button>
                      <div className="text-center font-mono text-xs font-semibold text-white/80">{String(value)} px</div>
                      <button className="h-8 rounded-md border border-white/10 bg-white/5 text-sm text-white/65" onClick={increase as () => void} type="button">+</button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </div>
        )}

        {settingsTab === "templates" && (
          <div className="mx-auto flex h-full min-h-[360px] max-w-4xl flex-col">
            <div className="mb-3 flex flex-wrap gap-1.5">
              {[...new Set(["python", "cpp", "c", "csharp", "rust", "java", "lua", "go", "javascript", "typescript", ...customLanguageProfiles.map((profile) => profile.id)])].map((lang) => (
                <button
                  key={lang}
                  className={`rounded-md border px-3 py-1.5 text-[10px] font-semibold ${settingLanguage === lang ? "border-[var(--brand)] bg-[var(--brand)] text-white" : "border-white/10 bg-white/5 text-white/55 hover:bg-white/10 hover:text-white"}`}
                  onClick={() => setSettingLanguage(lang)}
                  type="button"
                >
                  {getLanguageLabel(lang, customLanguageProfiles)}
                </button>
              ))}
            </div>
            <textarea
              aria-label="파일 템플릿"
              className="mb-3 min-h-0 flex-1 resize-none rounded-lg border border-white/10 bg-zinc-900 p-3 font-mono text-xs text-white focus:outline-none focus:ring-1 focus:ring-[var(--brand)]"
              value={customTemplateText}
              onChange={(event) => setCustomTemplateText(event.target.value)}
              spellCheck={false}
            />
            <div className="flex justify-between gap-2">
              {applyTemplate && <button className="code-sandbox-button" onClick={applyTemplate} type="button">현재 파일에 적용</button>}
              <button className="code-sandbox-button" onClick={() => setCustomTemplateText(customLanguageProfiles.find((profile) => profile.id === settingLanguage)?.template || fallbackTemplate(settingLanguage))} type="button">{t("기본값 복원")}</button>
              <button className="code-sandbox-button bg-[var(--brand)] text-white" onClick={saveCustomTemplate} type="button">{templateSaveOk ? t("저장됨") : t("템플릿 저장")}</button>
            </div>
          </div>
        )}

        {/* @ails-feature:developer_tools:start */}
        {settingsTab === "toolchains" && (
          <div className="mx-auto max-w-5xl">
            <DeveloperToolsPanel dark />
          </div>
        )}
        {/* @ails-feature:developer_tools:end */}

        {/* @ails-feature:developer_tools:start */}
        {settingsTab === "languages" && (
          <div className="mx-auto h-full min-h-[440px] max-w-5xl">
            <LanguageProfilesPanel onProfilesChange={applyCustomLanguageProfiles} allowInstallation={!folderMode} />
          </div>
        )}
        {/* @ails-feature:developer_tools:end */}
      </main>
    </div>
  )
}
