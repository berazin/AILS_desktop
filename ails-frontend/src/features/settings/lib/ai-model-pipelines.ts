export const MODEL_PIPELINES = {
  summary: {
    title: "정리본 생성 파이프라인",
    description: "음성을 STT로 옮기고 영상은 화면·발화를 함께 분석합니다. 오디오에 첨부한 PDF는 이미지를 설명한 뒤 정리본을 작성합니다.",
    workflows: ["video_stt_cleanup", "video_visual", "image_analysis", "video_summary"],
  },
  problem: {
    title: "문제풀이 파이프라인",
    description: "PDF 문제 검수부터 연습문제 생성, 채점과 코드 평가까지 설정합니다.",
    workflows: ["problem_review", "practice_generation", "grading", "code_assist"],
  },
  insight: {
    title: "Insight Book 파이프라인",
    description: "생각의 검증부터 교재 통합과 오개념 복습까지 사용할 모델을 선택합니다.",
    workflows: ["insight_book"],
  },
  document: {
    title: "문서 처리 파이프라인",
    description: "PDF 문자인식과 문서 번역에 사용할 모델을 선택합니다.",
    workflows: ["pdf_translation"],
  },
  conversation: {
    title: "대화·보이스 파이프라인",
    description: "챗봇과 보이스 에이전트의 응답 모델을 선택합니다.",
    workflows: ["chatbot", "voice_agent"],
  },
} as const

export type ModelPipelineId = keyof typeof MODEL_PIPELINES

export const MODEL_PIPELINE_STAGES = {
  summary: {
    inputs: ["summary_stt", "video_stt_cleanup", "video_visual", "image_analysis"],
    outputs: ["video_summary"],
  },
  problem: ["problem_review", "practice_generation", "grading", "code_assist"],
  insight: ["insight_book"],
  document: ["pdf_ocr", "pdf_translation"],
  conversation: ["chatbot", "voice_agent"],
} as const

export type ModelPipelineStageId =
  | keyof typeof MODEL_WORKFLOW_LABELS
  | "summary_stt"
  | "pdf_ocr"

// 표시 단계는 MODEL_PIPELINES가 결정한다. 기존 저장 설정과 소비자의 메타데이터는 유지한다.
export const MODEL_WORKFLOW_LABELS = {
  video_stt_cleanup: "STT 정제 모델",
  video_visual: "영상 장면·발화 통합 분석 모델",
  image_analysis: "첨부 PDF 이미지 설명 모델",
  video_summary: "정리본 작성·검증 모델",
  video_verification: "원문 근거 검증 모델",
  problem_review: "클라우드 PDF 문제 검수 모델",
  practice_generation: "연습문제 생성 모델",
  grading: "채점 모델",
  insight_book: "Insight Book 모델",
  code_assist: "코드 평가·편집 모델",
  pdf_translation: "문서 번역 모델",
  chatbot: "챗봇 모델",
  voice_agent: "보이스 에이전트 모델",
} as const

export const MODEL_WORKFLOW_DESCRIPTIONS = {
  video_stt_cleanup: "STT 원본을 보존하면서 반복과 명백한 맞춤법 오류를 정제합니다.",
  video_visual: "영상 프레임과 같은 시점의 STT를 함께 분석해 장면별 의미를 추출합니다.",
  image_analysis: "오디오 작업에 첨부한 PDF 페이지 이미지를 설명합니다. 영상 장면 분석에는 사용하지 않습니다.",
  video_summary: "정제 STT와 영상 장면 분석 결과를 바탕으로 정리본 작성과 근거 검증을 같은 모델로 수행합니다.",
  video_verification: "정제 STT·장면 분석과 정리본 전체를 대조합니다. 개념 검토 설정은 기술 개념 판정을 조절합니다.",
  problem_review: "PDF에서 추출한 문제를 이미지와 함께 검수합니다.",
  practice_generation: "학습자료로 연습문제와 해설을 생성합니다.",
  grading: "작성한 답안을 채점하고 피드백합니다.",
  insight_book: "Insight 주장 검증, 교재 통합·결과 검증, 구조 점검과 오개념 복습에 사용합니다.",
  code_assist: "코드 실행 결과를 평가하고 편집을 돕습니다.",
  pdf_translation: "원문 PDF를 번역합니다.",
  chatbot: "학습 대화와 질의응답에 사용합니다.",
  voice_agent: "클라우드 보이스 모드의 명령과 응답에 사용합니다.",
} as const

export const MODEL_PIPELINE_STAGE_LABELS: Record<"summary_stt" | "pdf_ocr", string> = {
  summary_stt: "강의 음성 인식(STT)",
  pdf_ocr: "PDF 문자 인식(OCR)",
}
