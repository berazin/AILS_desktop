import { X } from "lucide-react"

import { t } from "../../../lib/i18n.ts"
import { Button } from "../../../shared/ui/button.tsx"

export function HelpDialog({
  localAiSettingsEnabled,
  onClose,
  open,
  summarySttEnabled,
}: {
  localAiSettingsEnabled: boolean
  onClose: () => void
  open: boolean
  summarySttEnabled: boolean
}) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4">
      <section className="flex max-h-[calc(100vh-32px)] w-[min(720px,calc(100vw-32px))] flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--panel)] shadow-2xl">
        <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-4">
          <div>
            <h2 className="text-base font-semibold">{t("AILS 사용 방법")}</h2>
            <p className="text-sm text-[var(--muted-foreground)]">{t("문서를 읽고 수정하거나 코드를 작성하는 방법을 안내합니다.")}</p>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X size={18} />
          </Button>
        </div>
        <div className="min-h-0 space-y-4 overflow-y-auto p-5 text-sm leading-6">
          <section className="rounded-xl border border-[var(--border)] bg-[var(--background)] p-4">
            <h3 className="mb-2 text-sm font-bold text-[var(--brand)]">{t("문서 읽기와 수정")}</h3>
            <ul className="space-y-1.5 text-xs text-[var(--muted-foreground)]">
              <li><strong>{t("문단 수정하기")}</strong>{t(": 화면에 보이는 문단을 빠르게 두 번 클릭하면 바로 글을 고칠 수 있습니다. 수정을 마쳐도 보고 있던 위치는 그대로 유지됩니다.")}</li>
              <li><strong>{t("방금 한 작업 되돌리기")}</strong>: <code>Ctrl + Z</code>{t("를 누르면 이전 상태로 돌아갑니다. 다시 적용하려면 ")}<code>Ctrl + Y</code> {t("또는 ")}<code>Ctrl + Shift + Z</code>{t("를 누르세요. 수정한 내용은 자동으로 저장됩니다.")}</li>
              <li><strong>{t("이미지 삭제하기")}</strong>{t(": 문서 안의 이미지를 빠르게 두 번 클릭하면 문서에서 삭제됩니다.")}</li>
              <li><strong>{t("화면 위쪽 이미지 빠르게 삭제하기")}</strong>: <code>X</code> {t("키를 빠르게 두 번 누르면 현재 화면에서 가장 위에 보이는 이미지가 삭제됩니다.")}</li>
            </ul>
          </section>
          <section className="rounded-xl border border-[var(--border)] bg-[var(--background)] p-4">
            <h3 className="mb-2 text-sm font-bold text-[var(--brand)]">{t("코드 작성하기")}</h3>
            <ul className="space-y-1.5 text-xs text-[var(--muted-foreground)]">
              <li><strong>{t("문제풀이 열기")}</strong>{t(": 키보드에서 ")}<code>Alt + C</code>{t("를 누르세요.")}</li>
              <li><strong>{t("PDF와 나란히 보기")}</strong>{t(": PDF를 열어둔 상태에서 문제풀이를 열면 문제 화면과 PDF가 나란히 배치됩니다. 문제풀이를 닫으면 PDF는 원래 위치와 크기로 돌아갑니다.")}</li>
              <li><strong>{t("코드 파일 관리하기")}</strong>{t(": 여러 코드 파일을 만들고 탭을 눌러 오갈 수 있습니다. 프로젝트별로 저장하거나 파일 이름을 바꾸고 삭제할 수도 있습니다.")}</li>
              <li><strong>{t("단축키 바꾸기")}</strong>{t(": 직접 코딩 답안에서 ")}<strong>{t("Settings → 편집기 → 사용자 단축키")}</strong>{t("로 이동하세요. 코드 실행, 저장, 파일 이동 등에 사용할 키를 직접 정할 수 있습니다. 이미 다른 기능에서 쓰는 키는 중복으로 지정할 수 없습니다.")}</li>
              <li><strong>{t("필요한 언어 설치하기")}</strong>: <strong>{t("Settings → 도구 체인")}</strong>{t("에서 Python이나 C/C++처럼 코드를 실행하는 데 필요한 프로그램을 골라 설치할 수 있습니다. 설치가 얼마나 진행됐는지도 이 화면에 표시됩니다.")}</li>
              <li><strong>{t("새로운 언어 추가하기")}</strong>: <strong>{t("Settings → 사용자 언어")}</strong>{t("에서 파일 종류와 실행 방법을 등록하면 기본 목록에 없는 언어도 사용할 수 있습니다.")}</li>
              <li><strong>{t("AI에게 코드 검사 맡기기")}</strong>{t(": 직접 코딩 답안 위쪽의 ")}<strong>AI</strong> {t("버튼을 누르세요. 연습 화면에서 Shift 키를 빠르게 두 번 눌러도 실행됩니다.")}</li>
            </ul>
          </section>
          <section className="rounded-xl border border-[var(--border)] bg-[var(--background)] p-4">
            <h3 className="mb-2 text-sm font-bold text-[var(--brand)]">{t("AI 연결, 업데이트와 의견 보내기")}</h3>
            <ul className="space-y-1.5 text-xs text-[var(--muted-foreground)]">
              {localAiSettingsEnabled ? (
                <li><strong>{t("사용할 AI 고르기")}</strong>: <strong>{t("설정 → AI 모델")}</strong>{t("에서 ")}{summarySttEnabled ? t("요약, 이미지 읽기, 음성을 글로 바꾸기, 퀴즈와 챗봇") : t("이미지 읽기, 문제 생성, 채점과 챗봇")}{t("에 사용할 AI를 각각 선택할 수 있습니다.")}</li>
              ) : (
                <li><strong>{t("관리형 AI")}</strong>{t(": 모델과 API 연결은 AILS 관리자가 설정합니다. 사용자는 상단의 ")}<strong>{t("로그인")}</strong>{t("에서 계정만 연결하면 됩니다.")}</li>
              )}
              <li><strong>{t("외부 AI로 보내는 정보 확인하기")}</strong>: <strong>{t("설정 → 개인정보·AI")}</strong>{t("에서 전송될 수 있는 ")}{summarySttEnabled ? t("오디오, PDF, 답안과 코드") : t("PDF, 답안과 코드")}{t(", 외부 공급자, 해외 처리 여부를 확인할 수 있습니다.")}</li>
              <li><strong>{t("동의 철회와 AI 출력 신고")}</strong>{t(": 같은 화면에서 외부 AI 전송 동의를 철회하거나 부적절한 AI 답변과 채점 결과를 신고할 수 있습니다.")}</li>
              <li><strong>{t("새 버전 확인하기")}</strong>: <strong>{t("설정 → 업데이트")}</strong>{t("에서 새 버전이 있는지 확인할 수 있습니다. 비공개 배포판은 사용이 허용된 GitHub 계정으로 로그인해야 합니다.")}</li>
              <li><strong>{t("의견이나 오류 보내기")}</strong>{t(": 로그인한 뒤 화면 위쪽의 ")}<strong>{t("피드백")}</strong> {t("버튼에서 내용을 작성하면 개발자 메일로 바로 전송됩니다.")}</li>
            </ul>
          </section>
          <section className="rounded-xl border border-[var(--border)] bg-[var(--background)] p-4">
            <h3 className="mb-2 text-sm font-bold text-[var(--brand)]">{t("문서 이동과 찾기")}</h3>
            <ul className="space-y-1.5 text-xs text-[var(--muted-foreground)]">
              <li><strong>{t("이전·다음 자료 보기")}</strong>{t(": 키보드의 화살표 키나 마우스의 이전·다음 버튼을 사용하세요.")}</li>
              <li><strong>{t("글자 크기 바꾸기")}</strong>: <code>Ctrl</code>{t("을 누른 채 마우스 휠을 돌리세요.")}</li>
              <li><strong>{t("왼쪽 목차 너비 바꾸기")}</strong>: <code>Alt</code>{t("를 누른 채 마우스 휠을 돌리세요.")}</li>
              <li><strong>{t("글 복사하거나 AI에게 질문하기")}</strong>{t(": 원하는 글을 마우스로 선택한 뒤 오른쪽 버튼을 누르세요.")}</li>
              <li><strong>{t("단어 찾기")}</strong>: <code>Ctrl + F</code>{t("를 누르세요. 찾은 글을 다른 글로 바꾸려면 ")}<code>Ctrl + H</code>{t("를 누르세요.")}</li>
              <li><strong>{t("강의 분석 오류 확인하기")}</strong>{t(": 분석에 실패한 항목을 누르면 실패한 이유를 확인할 수 있습니다.")}</li>
            </ul>
          </section>
        </div>
      </section>
    </div>
  )
}
