import os
import re
import shutil
from system_storage import canonical_system_name, visible_data_folder

INVALID_FILE_CHARS = r'[\\/*?:"<>|]'


def _infer_subject_title(full_title: str) -> str:
    normalized = str(full_title or "").strip()
    if not normalized:
        return ""
    # "정리본" 문자열이 뒤에 붙어있으면 모두 제거 (예: 객체지향언어1_12주차1정리본 -> 객체지향언어1_12주차1)
    while normalized.endswith("정리본"):
        normalized = normalized[:-len("정리본")].strip()
    youtube_match = re.match(r"^(.*?)_(?:YT|유튜브)_.+$", normalized, re.IGNORECASE)
    if youtube_match:
        return youtube_match.group(1).strip()
    match = re.match(r"^(.*?)_?\d+주차\d*$", normalized)
    if match:
        return match.group(1).strip()
    return normalized


def _sanitize_title(title: str) -> str:
    sanitized = re.sub(INVALID_FILE_CHARS, "_", str(title or "")).strip()
    return sanitized or "untitled"


def _build_image_dir_names(full_title: str):
    names = []
    for title in (full_title, _sanitize_title(full_title)):
        for folder_name in (f".{title}.images", f"{title}_images"):
            if folder_name not in names:
                names.append(folder_name)
    return names


def _iter_report_markdown_paths(target_dir: str):
    ignored_dirs = {".images", "_resume", "_trash", "__pycache__"}
    for root, dirs, files in os.walk(target_dir):
        dirs[:] = [name for name in dirs if visible_data_folder(os.path.join(root, name))]
        for filename in sorted(files):
            path = os.path.join(root, filename)
            if os.path.isfile(path) and filename.endswith("정리본.md"):
                yield path


LECTURE_REPORT_RE = re.compile(r"^(?P<prefix>.+)_(?P<week>\d+)주차(?P<sequence>\d+)(?:[\s_]*(?:상세(?:\s*정리)?|요약(?:\s*정리)?))?(?:정리본)*\.md$", re.IGNORECASE)
MARKDOWN_IMAGE_RE = re.compile(r"(!\[[^\]]*\]\()(<)?(?:\.\.[/\\])?(_images[/\\].*?)(>?\))", re.IGNORECASE)


def organize_reports(base_dir: str, semester_folder: str = ""):
    from documents.system_storage_migration import migrate_system_storage
    target_dir = os.path.abspath(str(base_dir or "").strip())
    if not target_dir:
        raise RuntimeError("정리할 기준 폴더가 비어 있습니다.")
    if not os.path.isdir(target_dir):
        raise RuntimeError(f"정리할 기준 폴더를 찾을 수 없습니다: {target_dir}")
    migrate_system_storage(target_dir)

    semester_title = _sanitize_title(semester_folder) if str(semester_folder or "").strip() else ""
    organize_root = os.path.join(target_dir, semester_title) if semester_title else target_dir
    os.makedirs(organize_root, exist_ok=True)

    moved_markdowns = 0
    moved_image_dirs = 0
    skipped_files = []
    messages = []

    for src_md in _iter_report_markdown_paths(target_dir):
        filename = os.path.basename(src_md)
        if not (filename.endswith("정리본.md") or LECTURE_REPORT_RE.match(filename)):
            continue

        full_title = filename[:-len("정리본.md")] if filename.endswith("정리본.md") else os.path.splitext(filename)[0]
        subject_title = _infer_subject_title(full_title)
        if not subject_title:
            skipped_files.append(filename)
            continue

        subject_dir = os.path.join(organize_root, subject_title)
        os.makedirs(subject_dir, exist_ok=True)

        match = LECTURE_REPORT_RE.match(filename)
        if match:
            # 주차가 들어있는 일반 강의 정리본인 경우
            week = match.group("week")
            sequence = match.group("sequence")
            week_dir = os.path.join(subject_dir, f"{week}주차")
            os.makedirs(week_dir, exist_ok=True)
            dst_md = os.path.join(week_dir, f"{week}주차{sequence}.md")
        else:
            # 주차가 없는 유튜브 정리본 등의 경우
            dst_md = os.path.join(subject_dir, filename)

        if os.path.abspath(src_md) != os.path.abspath(dst_md):
            if os.path.exists(dst_md):
                os.remove(dst_md)
            shutil.move(src_md, dst_md)
            moved_markdowns += 1
            messages.append(f"마크다운 이동: {filename} -> {os.path.relpath(dst_md, organize_root)}")

            # 주차 폴더 밑으로 들어간 경우, 이미지 경로를 ../_images/ 로 보정
            if match:
                try:
                    with open(dst_md, "r", encoding="utf-8", errors="replace") as handle:
                        content = handle.read()
                    
                    def replace_img_path(m):
                        prefix = m.group(1)
                        bracket = m.group(2) or ""
                        path_part = m.group(3)
                        suffix = m.group(4)
                        return f"{prefix}{bracket}{path_part}{suffix}"
                    
                    new_content = MARKDOWN_IMAGE_RE.sub(replace_img_path, content)
                    if new_content != content:
                        with open(dst_md, "w", encoding="utf-8", errors="replace") as handle:
                            handle.write(new_content)
                except Exception as e:
                    messages.append(f"이미지 경로 치환 실패 ({filename}): {e}")

        src_img_folder = None
        image_folder_name = ""
        image_parent_candidates = [
            os.path.join(os.path.dirname(src_md), ".images"),
            os.path.join(target_dir, ".images"),
        ]
        if semester_title:
            image_parent_candidates.append(os.path.join(organize_root, ".images"))
        for candidate_name in _build_image_dir_names(full_title):
            for image_parent in image_parent_candidates:
                candidate_path = os.path.join(image_parent, candidate_name)
                if os.path.isdir(candidate_path):
                    src_img_folder = candidate_path
                    image_folder_name = candidate_name
                    break
            if src_img_folder:
                break
        if src_img_folder and os.path.isdir(src_img_folder):
            dst_img_parent = os.path.join(week_dir if match else subject_dir, ".images")
            os.makedirs(dst_img_parent, exist_ok=True)
            dst_img_folder = os.path.join(dst_img_parent, canonical_system_name(image_folder_name))
            if os.path.abspath(src_img_folder) != os.path.abspath(dst_img_folder) and os.path.exists(dst_img_folder):
                shutil.rmtree(dst_img_folder, ignore_errors=True)
            if os.path.abspath(src_img_folder) != os.path.abspath(dst_img_folder):
                shutil.move(src_img_folder, dst_img_folder)
                moved_image_dirs += 1
                messages.append(f"이미지 폴더 이동: {image_folder_name} -> {os.path.join(semester_title, subject_title, '.images') if semester_title else os.path.join(subject_title, '.images')}")

    return {
        "base_dir": target_dir,
        "semester_folder": semester_title,
        "moved_markdowns": moved_markdowns,
        "moved_image_dirs": moved_image_dirs,
        "skipped_files": skipped_files,
        "messages": messages,
    }
