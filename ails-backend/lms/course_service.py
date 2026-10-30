"""LmsCourseService: feature operations and owned state."""
from __future__ import annotations
from lms.course_support import (
    Any,
    Callable,
    LOCAL_WHISPER_CPP_VULKAN_ENGINE,
    _lms_report_title_key,
    dataclass,
    download_lms_resource,
    edition_manifest,
    existing_lms_reports,
    get_lms_browser_cdp_ws_url,
    lms_scan_academic_period,
    os,
    re,
    require_feature,
    require_local_stt_provider,
    safe_float,
    save_config,
    settings,
    urljoin,
    urlparse,
    validate_whisper_cpp_vulkan_runtime,
)
from lms.course_support import __name__ as _support_name
from importlib import import_module as _import_module

def __getattr__(name):
    if name.startswith("__"):
        raise AttributeError(name)
    return getattr(_import_module(_support_name), name)

@dataclass(frozen=True)
class LmsCourseServicePorts:
    """Only the collaborators required by this feature; no API state object."""
    _lms_page_kind: Callable[..., Any]
    append_idle_log: Callable[..., Any]
    get_config: Callable[[], Any]
    replace_config: Callable[[dict], None]
    get_engine: Callable[[], Any]
    ensure_lms_login_for_eclass: Callable[..., Any]
    inject_lms_hidden_elements_viewer: Callable[..., Any]
    mark_result_as_running: Callable[..., Any]
    retry_candidates: Callable[..., Any]
    video_task_config: Callable[..., Any]

class LmsCourseService:
    def __init__(self, ports: LmsCourseServicePorts):
        self._ports = ports
        self._lms_page_kind = ports._lms_page_kind
        self.append_idle_log = ports.append_idle_log
        self.ensure_lms_login_for_eclass = ports.ensure_lms_login_for_eclass
        self.inject_lms_hidden_elements_viewer = ports.inject_lms_hidden_elements_viewer
        self.mark_result_as_running = ports.mark_result_as_running
        self.retry_candidates = ports.retry_candidates
        self.video_task_config = ports.video_task_config

    @property
    def config(self):
        return self._ports.get_config()

    @config.setter
    def config(self, value):
        self._ports.replace_config(value)

    @property
    def engine(self):
        return self._ports.get_engine()

    def queue_eclass_vod_task(self, payload: dict, *, ensure_login: bool = True,
                              academic_period: tuple[int, int] | None = None) -> int:
        require_feature("summary.web_inputs")
        vod_url = str(payload.get("vod_url") or payload.get("url") or "").strip()
        title = str(payload.get("title", "") or "").strip()
        if not vod_url:
            raise ValueError("e-class VOD URL is required.")
        if not re.match(r"^https?://", vod_url, re.IGNORECASE):
            raise ValueError("e-class VOD URL must be an http or https URL.")
        parsed = urlparse(vod_url)
        if not parsed.hostname or parsed.username or parsed.password:
            raise ValueError("올바른 LMS VOD URL을 입력해 주세요.")
        if not title:
            raise ValueError("정리본 제목이 필요합니다. 예: 자료구조_10주차1")

        from summary_generation.lms_media_cache import find_lms_video
        if ensure_login and not find_lms_video(vod_url):
            self.ensure_lms_login_for_eclass(vod_url)

        self.config = save_config(self.config)
        detail_mode = str(payload.get("detail_mode", "summary")).strip()
        if detail_mode not in {"detailed", "summary"}:
            detail_mode = "summary"
        local_stt = payload.get("local_stt", False)
        if not isinstance(local_stt, bool):
            raise ValueError("로컬 STT 선택값이 올바르지 않습니다.")
        local_stt_model = ""
        if local_stt:
            require_local_stt_provider(LOCAL_WHISPER_CPP_VULKAN_ENGINE)
            models = edition_manifest.whisper_cpp_model_options()
            if not models:
                raise ValueError("이 배포판에는 사용할 수 있는 로컬 STT 모델이 없습니다.")
            requested_model = str(payload.get("local_stt_model") or self.config.get("stt_model_name") or "").strip()
            local_stt_model = requested_model if requested_model in models else settings.model_support.select_video_whisper_cpp_model(models=models)
            validate_whisper_cpp_vulkan_runtime(local_stt_model)
        mode_label = "상세정리본" if detail_mode == "detailed" else "요약정리본"
        task_title = f"{title} {mode_label}"
        task = {
            "type": "eclass_vod",
            "vod_url": vod_url,
            "title": task_title,
            "base_title": title,
            "skip_images": bool(payload.get("skip_images", False)) or bool(payload.get("stt_only", False)) or bool(payload.get("mp3_only", False)),
            "interval": 3.0,
            "mse_threshold": safe_float(payload.get("mse_threshold", 500), 500.0),
            "prompt_template": self.config["prompt_template"],
            "stt_only": bool(payload.get("stt_only", False)),
            "mp3_only": bool(payload.get("mp3_only", False)),
            "detail_mode": detail_mode,
            "local_stt": local_stt,
            "local_stt_model": local_stt_model,
        }
        if academic_period is not None:
            grade, semester = academic_period
            task.update(lms_batch=True, grade=grade, semester=semester)
        task_config = self.video_task_config(task)
        task_config["_lms_ensure_authenticated"] = self.ensure_lms_login_for_eclass
        task_id = self.engine.add_task(task, task_config)
        if task_id != -1:
            self.mark_result_as_running(task_title)
            self.append_idle_log(f"e-class VOD task added: {task_title}")
        return task_id


    def scan_lms_course_and_enqueue(self, payload: dict) -> dict:
        require_feature("summary.web_inputs")
        return self._scan_lms_course_and_enqueue_internal(payload)


    def _lms_scheduled_titles(self) -> set[str]:
        with self.engine.lock:
            entries = [*self.engine.pending_tasks, *self.engine.active_tasks.values()]
            return {_lms_report_title_key(entry.get("task", {}).get("title"))
                    for entry in entries if entry.get("task", {}).get("title")}


    def _enqueue_lms_vod_tasks(self, pending_vod_tasks, course_details, *,
                               grade, semester, scheduled_titles):
        total_added_tasks = 0
        failures = []
        scheduled_titles = {_lms_report_title_key(title) for title in scheduled_titles}
        for pending_vod_task in pending_vod_tasks:
            task_payload = pending_vod_task["payload"]
            detail_index = pending_vod_task["detail_index"]
            mode_label = "상세정리본" if task_payload.get("detail_mode") == "detailed" else "요약정리본"
            title = f"{task_payload['title']} {mode_label}"
            # A task may finish while the browser scans. Its original queue
            # membership still excludes it from this scan's registrations.
            if title in scheduled_titles:
                continue
            try:
                task_id = self.queue_eclass_vod_task(
                    task_payload, ensure_login=False, academic_period=(grade, semester),
                )
            except Exception as error:
                message = f"LMS task registration failed: {title}: {error}"
                failures.append(message)
                self.append_idle_log(message)
                continue
            scheduled_titles.add(title)
            if task_id != -1:
                total_added_tasks += 1
                if 0 <= detail_index < len(course_details):
                    course_details[detail_index]["added_tasks"] += 1
        return total_added_tasks, failures


    def _scan_lms_course_and_enqueue_internal(self, payload: dict) -> dict:
        course_url = str(payload.get("course_url") or payload.get("url") or "").strip()
        skip_images = bool(payload.get("skip_images", False)) or bool(payload.get("stt_only", False)) or bool(payload.get("mp3_only", False))
        stt_only = bool(payload.get("stt_only", False))
        mp3_only = bool(payload.get("mp3_only", False))
        skip_vods = bool(payload.get("skip_vods", False))
        skip_files = bool(payload.get("skip_files", False))
        detail_mode = str(payload.get("detail_mode", "summary")).strip()
        if detail_mode not in {"detailed", "summary"}:
            detail_mode = "summary"
        local_stt = bool(payload.get("local_stt", False))
        grade, semester = lms_scan_academic_period(payload, self.config)

        start_week = 1
        try:
            start_week = int(payload.get("start_week", 1))
        except Exception:
            start_week = 1

        self.config["start_week"] = start_week
        self.config["last_lms_url"] = course_url
        self.config["current_grade"] = grade
        self.config["current_semester"] = semester
        self.config = save_config(self.config)

        if not course_url:
            raise ValueError("LMS 과목 홈 또는 대시보드 URL이 필요합니다.")
        parsed_course = urlparse(course_url)
        if parsed_course.scheme.lower() not in {"http", "https"} or not parsed_course.hostname or parsed_course.username or parsed_course.password:
            raise ValueError("올바른 http 또는 https LMS 주소를 입력해 주세요.")

        scheduled_titles = self._lms_scheduled_titles()

        self.append_idle_log(
            f"LMS 일괄 스마트 분석을 시작합니다: {grade}학년 {semester}학기, {start_week}주차부터"
        )

        # LMS 로그인 여부 보장
        self.ensure_lms_login_for_eclass(course_url)

        import asyncio
        try:
            asyncio.set_event_loop(None)
        except Exception:
            pass
        from playwright.sync_api import sync_playwright

        # 대시보드 홈 링크 판별
        is_dashboard = "/course/view.php?id=" not in course_url

        def clean_name(name_str: str) -> str:
            cleaned = re.sub(r"\s*\(.+?\)\s*", "", name_str)
            cleaned = re.sub(r"\s*\[.+?\]\s*", "", cleaned)
            cleaned = re.sub(r"-\s*\d+학년도.+", "", cleaned)
            cleaned = re.sub(r"[^\w\s]", "", cleaned)
            cleaned = re.sub(r"\s+", "", cleaned)
            return cleaned.lower()

        def clean_name_preserve_brackets(name_str: str) -> str:
            cleaned = re.sub(r"\s*\(.+?\)\s*", "", name_str)
            cleaned = re.sub(r"-\s*\d+학년도.+", "", cleaned)
            cleaned = re.sub(r"[^\w\s\[\]]", "", cleaned)
            cleaned = re.sub(r"\s+", "", cleaned)
            return cleaned.lower()

        def sanitize_dir_name(name_str: str) -> str:
            cleaned = re.sub(r"\s*\(.+?\)\s*", "", name_str)
            cleaned = re.sub(r"\s*\[.+?\]\s*", "", cleaned)
            cleaned = re.sub(r"-\s*\d+학년도.+", "", cleaned)
            cleaned = re.sub(r"[\\/*?:\"<>|]", "_", cleaned).strip()
            return cleaned

        def sanitize_dir_name_preserve_brackets(name_str: str) -> str:
            cleaned = re.sub(r"\s*\(.+?\)\s*", "", name_str)
            cleaned = re.sub(r"-\s*\d+학년도.+", "", cleaned)
            cleaned = re.sub(r"[\\/*?:\"<>|]", "_", cleaned).strip()
            return cleaned

        resource_selector = ", ".join([
            "a[href*='/mod/resource/view.php']",
            "a[href*='/mod/folder/view.php']",
            "a[href*='/pluginfile.php']",
            "a[href*='ubfile']",
        ])

        scanned_courses = []

        with sync_playwright() as playwright:
            browser = playwright.chromium.connect_over_cdp(get_lms_browser_cdp_ws_url(), timeout=10000)
            context = browser.contexts[0]
            self.inject_lms_hidden_elements_viewer(context)
            # 임시 페이지를 띄워 스캔 진행
            page = context.new_page()

            if is_dashboard:
                sep = "&" if "?" in course_url else "?"
                def collect_dashboard_courses() -> list[str]:
                    try:
                        page.wait_for_selector(
                            "a[href*='/course/view.php?id='], a[href*='course/view.php?id=']",
                            state="attached",
                            timeout=30000,
                        )
                    except Exception:
                        self.append_idle_log("LMS 과목 링크가 바로 보이지 않아 현재 DOM에서 가능한 범위로 계속 확인합니다.")
                    try:
                        page.wait_for_load_state("networkidle", timeout=10000)
                    except Exception:
                        pass
                    links = page.locator("a[href*='/course/view.php?id='], a[href*='course/view.php?id=']")
                    course_map = {}
                    for link_index in range(links.count()):
                        try:
                            lnk = links.nth(link_index)
                            href = lnk.get_attribute("href") or ""
                            txt = (lnk.text_content(timeout=1000) or lnk.get_attribute("title") or "").strip()
                            m_id = re.search(r"id=(\d+)", href)
                            if m_id and href:
                                cid = m_id.group(1)
                                cleaned_txt = re.sub(r"\s+", " ", txt).strip()
                                absolute_href = urljoin(page.url, href)
                                if cid not in course_map:
                                    course_map[cid] = {"url": absolute_href, "title": cleaned_txt or f"LMS_Course_{cid}"}
                                elif cleaned_txt and len(cleaned_txt) > len(course_map[cid]["title"]):
                                    course_map[cid]["title"] = cleaned_txt
                        except Exception:
                            continue
                    return [
                        cinfo["url"] for cinfo in course_map.values()
                        if not (cinfo["title"] and any(
                            x in cinfo["title"] for x in
                            ["공지사항", "도움말", "Q&A", "상담", "커뮤니티", "비교과", "비학위", "학습커뮤니티", "community"]
                        ))
                    ]

                for auth_retry in range(2):
                    page.goto(f"{course_url}{sep}lang=ko", wait_until="load", timeout=25000)
                    page_kind = self._lms_page_kind(page)
                    if page_kind not in {"login", "mfa"}:
                        scanned_courses = collect_dashboard_courses()
                        if scanned_courses:
                            break
                        page_kind = self._lms_page_kind(page)
                    if page_kind in {"login", "mfa"} and auth_retry == 0:
                        self.ensure_lms_login_for_eclass(course_url)
                        continue
                    break
                if not scanned_courses:
                    self.append_idle_log(f"LMS 과목 링크를 찾지 못했습니다. 현재 페이지: {page.title()} | {page.url}")
                    if self._lms_page_kind(page) in {"login", "mfa"}:
                        raise RuntimeError("LMS 인증 후에도 과목 목록에 접근하지 못했습니다.")
                    raise RuntimeError("LMS 첫 화면에서 과목 링크를 찾지 못했습니다. LMS 창에서 과목 목록이 보이는 상태인지 확인한 뒤 다시 실행해 주세요.")
            else:
                # 단일 과목 홈 모드
                scanned_courses.append(course_url)

            # 로컬 디스크 상의 기존 정리본 마크다운 파일 목록 스캔
            base_dir = str(self.config.get("md_save_path", "") or "").strip()
            if base_dir:
                base_dir = os.path.join(base_dir, f"{grade}학년 {semester}학기")
                os.makedirs(base_dir, exist_ok=True)
            incomplete_titles = [item["title"] for item in self.retry_candidates(scan_disk=True)]
            existing_reports = {
                (clean_name(course), week, sequence)
                for course, week, sequence in existing_lms_reports(
                    base_dir, detail_mode, incomplete_titles
                )
            }

            total_scanned_vods = 0
            total_added_tasks = 0
            total_downloaded_materials = 0
            downloaded_materials = []
            course_details = []
            all_missing_vods = []
            pending_vod_tasks = []
            scan_failures = []
            first_course_nice_title = ""

            for idx, c_url in enumerate(scanned_courses):
                course_pending_start = len(pending_vod_tasks)
                try:
                    sep = "&" if "?" in c_url else "?"
                    page.goto(f"{c_url}{sep}lang=ko", wait_until="load", timeout=25000)
                    try:
                        page.wait_for_selector(".course-content, #region-main, .coursename", state="attached", timeout=15000)
                    except Exception:
                        self.append_idle_log(f"LMS 과목 본문 로드 대기 시간 초과, 현재 DOM 기준으로 계속 스캔합니다: {c_url}")
                    try:
                        # LMS 과목 본문은 load 이후 지연 렌더링되므로 제목이나 섹션 링크가 실제로 채워질 때까지 기다린다.
                        page.wait_for_function(
                            "() => (document.querySelector('.page-header-headings h1, .coursename, .page-title')?.textContent || '').trim().length > 0"
                            " || document.querySelectorAll('.course-content .section a[href], #region-main .section a[href]').length > 0",
                            timeout=8000,
                        )
                    except Exception:
                        self.append_idle_log(f"LMS 과목 본문 렌더링 대기 시간 초과, 현재 DOM 기준으로 계속 스캔합니다: {c_url}")

                    # 과목 타이틀 추출
                    c_title = ""
                    for sel in [".page-header-headings h1", ".coursename", ".page-title"]:
                        try:
                            el = page.locator(sel).first
                            if el.is_visible():
                                c_title = el.text_content() or ""
                                break
                        except Exception:
                            continue
                    if not c_title:
                        c_title = page.title() or f"LMS_Course_{idx}"

                    c_title = str(c_title).strip()
                    if c_title and any(x in c_title for x in ["커뮤니티", "비교과", "비학위", "학습커뮤니티", "community"]):
                        self.append_idle_log(f"커뮤니티/비교과 강좌 스킵: {c_title}")
                        continue

                    nice_c_name = sanitize_dir_name(c_title)

                    # 띄어쓰기 및 특수문자 무시 스마트 폴더 대조 (clean_name 사용)
                    if base_dir and os.path.isdir(base_dir):
                        try:
                            c_clean = clean_name(nice_c_name)
                            for existing_dir in os.listdir(base_dir):
                                existing_dir_path = os.path.join(base_dir, existing_dir)
                                if os.path.isdir(existing_dir_path):
                                    if clean_name(existing_dir) == c_clean:
                                        nice_c_name = existing_dir
                                        break
                        except Exception:
                            pass

                    if not first_course_nice_title:
                        first_course_nice_title = nice_c_name

                    clean_course = clean_name(nice_c_name)

                    # 해당 과목 전용 "교재" 폴더 안의 파일들만 정확히 중복 검증하도록 수집
                    existing_textbook_files = set()
                    existing_textbook_titles = set()  # 순수 제목 중복 체크용
                    target_dir = os.path.join(base_dir, nice_c_name, "교재")
                    if os.path.isdir(target_dir):
                        try:
                            for f in os.listdir(target_dir):
                                if os.path.isfile(os.path.join(target_dir, f)):
                                    name_no_ext = os.path.splitext(f)[0]
                                    m_intro = re.match(r"^\[(?:개요|오리엔테이션|intro|Intro)\]\s*(.*)$", name_no_ext, re.IGNORECASE)
                                    m_res = re.match(r"^\[(\d+)(?:\uc8fc\ucc28|\uc8fc|week|Week)\]\s*(.*)$", name_no_ext, re.IGNORECASE)

                                    # 1. 파일명 그대로 (대괄호 및 확장자 유지)
                                    existing_textbook_files.add(clean_name_preserve_brackets(f))
                                    existing_textbook_files.add(clean_name_preserve_brackets(name_no_ext))

                                    # 시스템 대괄호를 깎아낸 pure_title(확장자 포함) 추출 및 캐시 등록
                                    m_intro_f = re.match(r"^\[(?:개요|오리엔테이션|intro|Intro)\]\s*(.*)$", f, re.IGNORECASE)
                                    m_res_f = re.match(r"^\[(\d+)(?:\uc8fc\ucc28|\uc8fc|week|Week)\]\s*(.*)$", f, re.IGNORECASE)
                                    if m_intro_f:
                                        pure_title_f = m_intro_f.group(1).strip()
                                        existing_textbook_files.add((0, clean_name_preserve_brackets(pure_title_f)))
                                        existing_textbook_titles.add(clean_name_preserve_brackets(pure_title_f))
                                    elif m_res_f:
                                        pure_title_f = m_res_f.group(2).strip()
                                        w_val_f = int(m_res_f.group(1))
                                        existing_textbook_files.add((w_val_f, clean_name_preserve_brackets(pure_title_f)))
                                        existing_textbook_titles.add(clean_name_preserve_brackets(pure_title_f))
                                    else:
                                        # [개요]나 [n주차]가 아닌 다른 일반 대괄호(예: [핵심정리])는 파일명 자체(대괄호 및 확장자 포함)를 순수 제목으로 완벽 보존
                                        existing_textbook_titles.add(clean_name_preserve_brackets(f))
                                        existing_textbook_titles.add(clean_name_preserve_brackets(name_no_ext))

                        except Exception as e:
                            self.append_idle_log(f"교재 폴더 스캔 실패 ({nice_c_name}): {e}")

                    raw_sections = page.locator(".course-content .section, .course-content li.section, #region-main .section").all()
                    sections = []
                    seen_section_ids = set()
                    for r_sec in raw_sections:
                        try:
                            s_id = (r_sec.get_attribute("id") or "").strip()
                            if s_id and s_id.startswith("section-"):
                                if s_id in seen_section_ids:
                                    continue
                                seen_section_ids.add(s_id)
                                sections.append(r_sec)
                        except Exception:
                            continue

                    week_idx = 1
                    course_vods = []
                    course_resources = []

                    for sec in sections:
                        sec_name = ""
                        for name_sel in [".sectionname", ".section-title", "h3", "h4"]:
                            try:
                                el = sec.locator(name_sel).first
                                if el.is_visible():
                                    sec_name = el.text_content() or ""
                                    break
                            except Exception:
                                continue

                        week_num = None
                        sec_id = sec.get_attribute("id") or ""

                        # 0. section-0 (강의 개요): VOD 스킵, 일반 자료만 수집
                        is_intro_section = ("section-0" in sec_id or "section-notice" in sec_id)
                        if is_intro_section:
                            res_links_intro = sec.locator(resource_selector)
                            for r_index in range(res_links_intro.count()):
                                try:
                                    r_lnk = res_links_intro.nth(r_index)
                                    r_href = r_lnk.get_attribute("href") or ""
                                    r_title = r_lnk.text_content(timeout=1000) or r_lnk.get_attribute("title") or os.path.basename(urlparse(r_href).path)
                                    r_title = re.sub(r"\s+", " ", r_title).strip()
                                    r_title = re.sub(r"\s*(?:PDF\s*문서|파일|동영상|웹링크)$", "", r_title, flags=re.IGNORECASE).strip()
                                    if r_title and r_href:
                                        course_resources.append({"week": 0, "title": r_title, "url": urljoin(page.url, r_href)})
                                except Exception:
                                    continue
                            continue  # VOD 등 나머지 처리는 스킵

                        # 1. 섹션 타이틀명 텍스트 파싱 시도 (예: "4주차 - 데이터 분석")
                        if sec_name:
                            sec_name_clean = sec_name.strip()
                            m = re.search(r"(\d+)\s*(?:주차|주|week|Week)", sec_name_clean, re.IGNORECASE)
                            if m:
                                week_num = int(m.group(1))

                        # 2. HTML ID 속성 번호 기반 파싱 시도 (예: id="section-4")
                        if week_num is None and sec_id:
                            m_id_num = re.search(r"section-(\d+)", sec_id)
                            if m_id_num:
                                week_num = int(m_id_num.group(1))

                        # 3. 최후의 보루 (순차 카운트)
                        if week_num is None:
                            week_num = week_idx
                            week_idx += 1

                        # VOD 리소스 파싱 (1-based index 차시 부여, 중복 VOD ID 제거 필수)
                        links = sec.locator("a[href*='/mod/vod/view.php']").all()
                        seq = 1
                        seen_vods = set()
                        for lnk in links:
                            try:
                                if not lnk.is_visible():
                                    continue
                                href = lnk.get_attribute("href") or ""
                                if href:
                                    # VOD ID를 추출하여 동일 주차 내 중복 제거 (아이콘, 텍스트 링크 중복 방지)
                                    m_vod_id = re.search(r"id=(\d+)", href)
                                    vod_key = m_vod_id.group(1) if m_vod_id else href

                                    if vod_key in seen_vods:
                                        continue
                                    seen_vods.add(vod_key)

                                    vod_title = lnk.text_content() or ""
                                    vod_title = re.sub(r"\s+", " ", vod_title).strip()
                                    if not vod_title:
                                        continue
                                    course_vods.append({
                                        "week": week_num,
                                        "sequence": seq,
                                        "title": vod_title,
                                        "url": urljoin(page.url, href)
                                    })
                                    seq += 1
                            except Exception:
                                continue

                        # 일반 학습 자료 리소스 파싱 (resource/view.php)
                        res_links = sec.locator(resource_selector)
                        for r_index in range(res_links.count()):
                            try:
                                r_lnk = res_links.nth(r_index)
                                r_href = r_lnk.get_attribute("href") or ""
                                r_title = r_lnk.text_content(timeout=1000) or r_lnk.get_attribute("title") or os.path.basename(urlparse(r_href).path)
                                r_title = re.sub(r"\s+", " ", r_title).strip()
                                r_title = re.sub(r"\s*(?:PDF\s*문서|파일|동영상|웹링크)$", "", r_title, flags=re.IGNORECASE).strip()
                                if not r_title:
                                    continue
                                if r_href:
                                    course_resources.append({
                                        "week": week_num,
                                        "title": r_title,
                                        "url": urljoin(page.url, r_href)
                                    })
                            except Exception:
                                continue

                    # 1) 누락 VOD 등록 처리
                    missing_vods = []
                    for vod in course_vods:
                        w = vod["week"]
                        if w < start_week:
                            continue
                        s = vod["sequence"]
                        if (clean_course, w, s) not in existing_reports:
                            missing_vods.append(vod)
                            all_missing_vods.append({
                                "course": nice_c_name,
                                "week": w,
                                "sequence": s,
                                "title": vod["title"],
                                "url": vod["url"]
                            })

                    if skip_vods:
                        missing_vods = []
                    detail_index = len(course_details)
                    for missing in missing_vods:
                        report_title = f"{nice_c_name}_{missing['week']}주차{missing['sequence']}"
                        task_payload = {
                            "vod_url": missing["url"],
                            "title": report_title,
                            "skip_images": skip_images,
                            "stt_only": stt_only,
                            "mp3_only": mp3_only,
                            "detail_mode": detail_mode,
                            "local_stt": local_stt,
                        }
                        pending_vod_tasks.append({
                            "detail_index": detail_index,
                            "payload": task_payload,
                        })

                    # 2) 미보유 일반 강의 자료 다운로드 처리
                    downloaded_count = 0
                    if base_dir and os.path.isdir(base_dir) and not skip_files:
                        for res in course_resources:
                            w = res["week"]
                            if w > 0 and w < start_week:
                                continue
                            r_title = res["title"]
                            r_url = res["url"]

                            clean_res = clean_name_preserve_brackets(r_title)
                            safe_res_title = sanitize_dir_name_preserve_brackets(r_title)
                            target_dir = os.path.join(base_dir, nice_c_name, "교재")
                            res_filename = f"[개요] {safe_res_title}" if w == 0 else f"[{w}주차] {safe_res_title}"

                            is_exists = False
                            if (w, clean_res) in existing_textbook_files:
                                is_exists = True
                            elif clean_name_preserve_brackets(res_filename) in existing_textbook_files:
                                is_exists = True
                            elif clean_res in existing_textbook_titles:
                                is_exists = True

                            if is_exists:
                                continue

                            saved_path = download_lms_resource(context, res, target_dir, res_filename, log=self.append_idle_log)
                            if saved_path:
                                downloaded_count += 1
                                total_downloaded_materials += 1
                                downloaded_materials.append({
                                    "course": nice_c_name,
                                    "week": w,
                                    "title": r_title,
                                    "path": saved_path,
                                })

                                # 실제 저장된 파일명을 기준으로 정확하게 캐시 갱신
                                final_f = os.path.basename(saved_path)
                                final_f_no_ext = os.path.splitext(final_f)[0]

                                m_intro_f = re.match(r"^\[(?:개요|오리엔테이션|intro|Intro)\]\s*(.*)$", final_f, re.IGNORECASE)
                                m_res_f = re.match(r"^\[(\d+)(?:\uc8fc\ucc28|\uc8fc|week|Week)\]\s*(.*)$", final_f, re.IGNORECASE)

                                existing_textbook_files.add(clean_name_preserve_brackets(final_f))
                                existing_textbook_files.add(clean_name_preserve_brackets(final_f_no_ext))
                                existing_textbook_files.add((w, clean_res))
                                existing_textbook_files.add(clean_name_preserve_brackets(res_filename))
                                existing_textbook_titles.add(clean_res)

                                if m_intro_f:
                                    pure_t = m_intro_f.group(1).strip()
                                    pure_t_no_ext = os.path.splitext(pure_t)[0]
                                    existing_textbook_files.add((0, clean_name_preserve_brackets(pure_t)))
                                    existing_textbook_files.add((0, clean_name_preserve_brackets(pure_t_no_ext)))
                                    existing_textbook_titles.add(clean_name_preserve_brackets(pure_t))
                                    existing_textbook_titles.add(clean_name_preserve_brackets(pure_t_no_ext))
                                elif m_res_f:
                                    pure_t = m_res_f.group(2).strip()
                                    pure_t_no_ext = os.path.splitext(pure_t)[0]
                                    w_val = int(m_res_f.group(1))
                                    existing_textbook_files.add((w_val, clean_name_preserve_brackets(pure_t)))
                                    existing_textbook_files.add((w_val, clean_name_preserve_brackets(pure_t_no_ext)))
                                    existing_textbook_titles.add(clean_name_preserve_brackets(pure_t))
                                    existing_textbook_titles.add(clean_name_preserve_brackets(pure_t_no_ext))
                                else:
                                    existing_textbook_titles.add(clean_name_preserve_brackets(final_f))
                                    existing_textbook_titles.add(clean_name_preserve_brackets(final_f_no_ext))
                            else:
                                self.append_idle_log(f"일반자료 다운로드 실패: {nice_c_name} / {r_title}")
                            continue

                    total_scanned_vods += len(course_vods)
                    course_details.append({
                        "course": nice_c_name,
                        "scanned_vods": len(course_vods),
                        "scanned_resources": len(course_resources),
                        "added_tasks": 0,
                        "downloaded_files": downloaded_count
                    })
                except Exception as ex:
                    del pending_vod_tasks[course_pending_start:]
                    failure_message = f"LMS scan failed for course url {c_url}: {str(ex)}"
                    scan_failures.append(failure_message)
                    self.append_idle_log(failure_message)
                    continue

            page.close()

        total_added_tasks, registration_failures = self._enqueue_lms_vod_tasks(
            pending_vod_tasks, course_details, grade=grade, semester=semester,
            scheduled_titles=scheduled_titles,
        )
        scan_failures.extend(registration_failures)

        if scan_failures:
            shown = " / ".join(scan_failures[:3])
            if len(scan_failures) > 3:
                shown += f" / ... ({len(scan_failures)} total failures)"
            raise RuntimeError(
                f"LMS scan/registration incomplete. {total_added_tasks} tasks were added; "
                "already accepted tasks remain queued. "
                f"{shown}"
            )

        scanned_title = "LMS 전체 대시보드" if is_dashboard else first_course_nice_title
        self.append_idle_log(f"LMS dashboard/course scanning complete: {scanned_title} (scanned {len(scanned_courses)} courses, added {total_added_tasks} VOD tasks, downloaded {total_downloaded_materials} files)")

        return {
            "course_title": scanned_title,
            "grade": grade,
            "semester": semester,
            "scanned_vods_count": total_scanned_vods,
            "missing_vods": all_missing_vods,
            "added_tasks_count": total_added_tasks,
            "downloaded_materials_count": total_downloaded_materials,
            "downloaded_materials": downloaded_materials,
            "details": course_details
        }
