"""Authenticated LMS file responses and resource-page download resolution."""

import mimetypes
import os
import re
from urllib.parse import parse_qs, quote, unquote, urljoin, urlparse

download_source_selector = ", ".join([
    "#resourceobject",
    "iframe",
    "embed",
    "a[href*='/pluginfile.php']",
    "a[href*='/local/ubdoc/download.php']",
    "a[href*='ubfile']",
    "a[href*='/mod/folder/download_folder.php']",
    "a[href*='forcedownload=1']",
    "a[href*='download=1']",
])
download_url_markers = ("pluginfile.php", "local/ubdoc/download.php", "download_folder.php", "forcedownload=1", "download=1")

def response_filename(response) -> str:
    headers = {str(k).lower(): str(v) for k, v in (getattr(response, "headers", {}) or {}).items()}
    disposition = headers.get("content-disposition", "")
    match = re.search(r"filename\*=UTF-8''([^;]+)", disposition, re.IGNORECASE)
    if match:
        return unquote(match.group(1)).strip('"')
    match = re.search(r'filename="?([^";]+)"?', disposition, re.IGNORECASE)
    if match:
        return unquote(match.group(1)).strip('"')
    return unquote(os.path.basename(urlparse(getattr(response, "url", "") or "").path or ""))

def response_extension(response, fallback_url: str) -> str:
    filename = response_filename(response)
    ext = os.path.splitext(filename)[1]
    if ext:
        return ext[:16]
    headers = {str(k).lower(): str(v) for k, v in (getattr(response, "headers", {}) or {}).items()}
    content_type = headers.get("content-type", "").split(";", 1)[0].strip().lower()
    guessed = mimetypes.guess_extension(content_type or "")
    if guessed:
        return guessed
    parsed_ext = os.path.splitext(urlparse(fallback_url or getattr(response, "url", "") or "").path)[1]
    return parsed_ext[:16] if parsed_ext else ".bin"

def is_file_response(response) -> bool:
    if not response or not getattr(response, "ok", False):
        return False
    headers = {str(k).lower(): str(v) for k, v in (getattr(response, "headers", {}) or {}).items()}
    content_type = headers.get("content-type", "").lower()
    disposition = headers.get("content-disposition", "").lower()
    filename = response_filename(response)
    if "attachment" in disposition:
        return True
    if any(marker in content_type for marker in ("text/html", "application/xhtml", "text/plain")):
        return False
    if filename:
        return True
    return bool(content_type)

def save_file_response(response, target_dir: str, filename_stem: str, source_url: str) -> str:
    if not is_file_response(response):
        return ""
    body = response.body()
    if not body:
        return ""
    ext = response_extension(response, source_url)
    os.makedirs(target_dir, exist_ok=True)
    initial = os.path.join(target_dir, f"{filename_stem}{ext}")
    stem, suffix = os.path.splitext(initial)
    for index in range(1, 1000):
        candidate = initial if index == 1 else f"{stem}_{index}{suffix}"
        try:
            # Exclusive creation handles both existing files and concurrent
            # downloads; a separate exists() check cannot preserve originals.
            handle = open(candidate, "xb")
        except FileExistsError:
            continue
        with handle:
            handle.write(body)
        return candidate
    raise FileExistsError(f"LMS download filename candidates exhausted: {initial}")

def describe_response(response) -> str:
    if not response:
        return "응답 없음"
    headers = {str(k).lower(): str(v) for k, v in (getattr(response, "headers", {}) or {}).items()}
    status = getattr(response, "status", "")
    content_type = headers.get("content-type", "")
    disposition = headers.get("content-disposition", "")
    final_url = getattr(response, "url", "")
    return f"status={status}, content-type={content_type or '-'}, disposition={disposition or '-'}, url={final_url}"

def candidate_urls_from_page(resource_page) -> list[str]:
    candidates = []
    try:
        locator = resource_page.locator(download_source_selector)
        for index in range(min(locator.count(), 50)):
            item = locator.nth(index)
            href = (
                item.get_attribute("data")
                or item.get_attribute("src")
                or item.get_attribute("href")
                or ""
            ).strip()
            if href:
                candidates.append(urljoin(resource_page.url, href))
    except Exception:
        pass
    deduped = []
    seen = set()
    for candidate in candidates:
        if candidate in seen:
            continue
        seen.add(candidate)
        deduped.append(candidate)
    return deduped

def ubfile_download_url(source_url: str) -> str:
    parsed = urlparse(source_url)
    if "/mod/ubfile/view.php" not in parsed.path:
        return ""
    query = parse_qs(parsed.query)
    ubfile_id = (query.get("id") or [""])[0]
    if not ubfile_id:
        return ""
    return urljoin(source_url, f"/local/ubdoc/download.php?id={quote(ubfile_id)}&tp=m&pg=ubfile")

def download_lms_resource(context, resource: dict, target_dir: str, filename_stem: str, *, log) -> str:
    source_url = str(resource.get("url") or "")
    resource_title = str(resource.get("title") or "")
    failure_notes = []
    try:
        response = context.request.get(source_url, timeout=20000)
        saved_path = save_file_response(response, target_dir, filename_stem, source_url)
        if saved_path:
            return saved_path
        failure_notes.append(f"직접 요청이 파일이 아님({describe_response(response)})")
    except Exception as error:
        failure_notes.append(f"직접 요청 오류({error})")

    resource_page = context.new_page()
    try:
        response = resource_page.goto(source_url, wait_until="domcontentloaded", timeout=20000)
        saved_path = save_file_response(response, target_dir, filename_stem, source_url)
        if saved_path:
            return saved_path
        failure_notes.append(f"자료 페이지가 파일이 아님({describe_response(response)})")

        candidates = []
        direct_ubfile_download = ubfile_download_url(resource_page.url or source_url)
        if direct_ubfile_download:
            candidates.append(direct_ubfile_download)
        candidates.extend(candidate_urls_from_page(resource_page))
        if not candidates:
            failure_notes.append(f"자료 페이지 후보 링크 없음(current={resource_page.url})")
        for candidate in candidates:
            if urlparse(candidate).hostname != urlparse(source_url).hostname:
                failure_notes.append(f"외부 후보 링크 제외({candidate})")
                continue
            if not any(marker in candidate for marker in download_url_markers):
                failure_notes.append(f"파일 후보가 아닌 링크 제외({candidate})")
                continue
            try:
                response = context.request.get(candidate, timeout=20000)
                saved_path = save_file_response(response, target_dir, filename_stem, candidate)
                if saved_path:
                    return saved_path
                failure_notes.append(f"후보 요청이 파일이 아님({describe_response(response)})")
            except Exception as error:
                failure_notes.append(f"후보 요청 오류({candidate}: {error})")
    finally:
        resource_page.close()
    short_reason = " / ".join(failure_notes[:4]) if failure_notes else "알 수 없는 이유"
    log(f"일반자료 다운로드 실패 원인: {resource_title} - {short_reason}")
    return ""
