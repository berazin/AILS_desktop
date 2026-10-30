from __future__ import annotations

import json
import logging
import ntpath
import os
import random
import re
import threading
import urllib.parse
from http.cookiejar import Cookie, CookieJar
from html import unescape
from urllib.parse import unquote, urljoin, urlparse

try:
    import winreg
except ImportError:
    winreg = None


from common import (
    BASE_EXE_DIR,
    FFMPEG_EXE,
    append_status_log,
)
from pipeline_utils import (
    TaskCancelledError,
    normalize_compact_text,
    safe_remove,
)

_logger = logging.getLogger(__name__)

LMS_BROWSER_PROFILE_ROOT = os.path.join(BASE_EXE_DIR, "browser_profiles", "eclass")
LMS_BROWSER_CDP_PORT = 39221
LMS_MEDIA_DISCOVERY_LOCK = threading.Lock()


def get_stealth_user_agent():
    import random
    chrome_versions = ["120.0.0.0", "121.0.0.0", "122.0.0.0", "123.0.0.0"]
    selected_version = random.choice(chrome_versions)
    return (
        f"Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        f"AppleWebKit/537.36 (KHTML, like Gecko) "
        f"Chrome/{selected_version} Safari/537.36"
    )


def get_stealth_headers(referer=None):
    headers = {
        "User-Agent": get_stealth_user_agent(),
        "Accept": "*/*",
        "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
        "Accept-Encoding": "identity;q=1, *;q=0",
        "Connection": "keep-alive",
        "Sec-Ch-Ua": '"Not A(Break;Brand";v="99", "Google Chrome";v="121", "Chromium";v="121"',
        "Sec-Ch-Ua-Mobile": "?0",
        "Sec-Ch-Ua-Platform": '"Windows"',
        "Sec-Fetch-Dest": "empty",
        "Sec-Fetch-Mode": "cors",
        "Sec-Fetch-Site": "same-origin",
    }
    if referer:
        headers["Referer"] = referer
    return headers



def _extract_browser_executable_from_command(command):
    value = os.path.expandvars(str(command or "").strip())
    if not value:
        return ""
    if value.startswith('"'):
        end = value.find('"', 1)
        return value[1:end] if end > 1 else ""
    match = re.match(r"(.+?\.exe)(?:\s|$)", value, re.IGNORECASE)
    return match.group(1).strip() if match else ""


def _classify_browser_executable(executable):
    path = os.path.abspath(str(executable or "").strip().strip('"'))
    filename = ntpath.basename(path).lower()
    lowered = path.lower()
    if "browseros" in lowered and filename == "chrome.exe":
        return {
            "id": "browseros",
            "name": "BrowserOS",
            "executable": path,
            "engine": "chromium",
            "supports_cdp": True,
        }
    definitions = (
        ("chrome", "Google Chrome", ("chrome.exe",)),
        ("edge", "Microsoft Edge", ("msedge.exe",)),
        ("brave", "Brave", ("brave.exe",)),
        ("comet", "Comet", ("comet.exe", "perplexity.exe")),
        ("firefox", "Mozilla Firefox", ("firefox.exe",)),
        ("vivaldi", "Vivaldi", ("vivaldi.exe",)),
        ("opera", "Opera", ("opera.exe", "launcher.exe")),
    )
    for browser_id, name, executables in definitions:
        if filename in executables:
            if browser_id == "opera" and "opera" not in lowered:
                continue
            return {
                "id": browser_id,
                "name": name,
                "executable": path,
                "engine": "firefox" if browser_id == "firefox" else "chromium",
                "supports_cdp": browser_id != "firefox",
            }
    return {
        "id": "default",
        "name": ntpath.splitext(ntpath.basename(path))[0] or "기본 브라우저",
        "executable": path,
        "engine": "unknown",
        "supports_cdp": False,
    }


def _read_windows_default_https_command():
    if os.name != "nt":
        return ""
    try:
        import winreg

        user_choice = (
            r"Software\Microsoft\Windows\Shell\Associations"
            r"\UrlAssociations\https\UserChoice"
        )
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, user_choice) as key:
            prog_id = str(winreg.QueryValueEx(key, "ProgId")[0] or "").strip()
        if not prog_id:
            return ""
        with winreg.OpenKey(
            winreg.HKEY_CLASSES_ROOT,
            rf"{prog_id}\shell\open\command",
        ) as key:
            return str(winreg.QueryValueEx(key, "")[0] or "")
    except OSError:
        return ""


def get_default_browser_info():
    executable = _extract_browser_executable_from_command(
        _read_windows_default_https_command()
    )
    if executable and os.path.isfile(executable):
        return _classify_browser_executable(executable)
    raise RuntimeError(
        "Windows 기본 브라우저 실행 파일을 찾을 수 없습니다. "
        "설정 > 앱 > 기본 앱에서 HTTP/HTTPS 기본 브라우저를 지정해 주세요."
    )


def get_lms_browser_info():
    candidates = [
        os.path.join(os.environ.get("ProgramFiles(x86)", ""), "Microsoft", "Edge", "Application", "msedge.exe"),
        os.path.join(os.environ.get("ProgramFiles", ""), "Microsoft", "Edge", "Application", "msedge.exe"),
        os.path.join(os.environ.get("LOCALAPPDATA", ""), "Microsoft", "Edge", "Application", "msedge.exe"),
    ]
    for executable in candidates:
        if executable and os.path.isfile(executable):
            return _classify_browser_executable(executable)
    raise RuntimeError("Microsoft Edge 실행 파일을 찾을 수 없습니다. Edge를 다시 설치하거나 복구해 주세요.")


def get_lms_browser_profile_dir(browser_id="default"):
    safe_id = re.sub(r"[^a-z0-9_-]+", "-", str(browser_id or "default").lower()).strip("-") or "default"
    profile_dir = os.path.join(LMS_BROWSER_PROFILE_ROOT, safe_id)
    os.makedirs(profile_dir, exist_ok=True)
    return profile_dir


def get_lms_browser_cdp_url():
    return f"http://127.0.0.1:{LMS_BROWSER_CDP_PORT}"


def get_lms_browser_cdp_ws_url(timeout=1.5):
    with urllib.request.urlopen(
        f"{get_lms_browser_cdp_url()}/json/version",
        timeout=max(float(timeout), 0.1),
    ) as response:
        payload = json.loads(response.read().decode("utf-8"))
    endpoint = str(payload.get("webSocketDebuggerUrl") or "").strip()
    parsed = urlparse(endpoint)
    if (
        parsed.scheme not in {"ws", "wss"}
        or parsed.hostname not in {"127.0.0.1", "localhost", "::1"}
        or parsed.port != LMS_BROWSER_CDP_PORT
    ):
        raise RuntimeError("LMS 브라우저가 유효한 로컬 CDP WebSocket 주소를 반환하지 않았습니다.")
    return endpoint





def extract_youtube_sources(url):
    try:
        import yt_dlp
    except ImportError as error:
        raise RuntimeError("yt-dlp가 설치되어 있지 않습니다. requirements.txt를 설치한 뒤 다시 시도하세요.") from error

    options = {
        "quiet": True,
        "no_warnings": True,
        "skip_download": True,
        "extract_flat": "in_playlist",
    }
    with yt_dlp.YoutubeDL(options) as downloader:
        info = downloader.extract_info(url, download=False)

    entries = []
    raw_entries = (info or {}).get("entries")
    if raw_entries:
        for index, entry in enumerate(raw_entries, start=1):
            if not isinstance(entry, dict):
                continue
            entry_url = str(entry.get("webpage_url") or entry.get("url") or "").strip()
            if entry_url and not re.match(r"^https?://", entry_url, re.IGNORECASE):
                entry_url = f"https://www.youtube.com/watch?v={entry_url}"
            entry_title = normalize_compact_text(entry.get("title", "")) or f"video-{index:02d}"
            if entry_url:
                entries.append({"url": entry_url, "title": entry_title, "index": index})
        if not entries:
            raise RuntimeError("YouTube 재생목록에서 처리 가능한 영상을 찾을 수 없습니다.")
        return {
            "is_playlist": True,
            "playlist_title": normalize_compact_text((info or {}).get("title", "")),
            "entries": entries,
        }

    video_url = str((info or {}).get("webpage_url") or url or "").strip()
    video_title = normalize_compact_text((info or {}).get("title", "")) or "YouTube"
    return {
        "is_playlist": False,
        "playlist_title": "",
        "entries": [{"url": video_url, "title": video_title, "index": 1}],
    }

def download_youtube_media(url, target_dir, title, cancel_event=None, log_list=None):
    try:
        import yt_dlp
    except ImportError as error:
        raise RuntimeError("yt-dlp가 설치되어 있지 않습니다. requirements.txt를 설치한 뒤 다시 시도하세요.") from error

    os.makedirs(target_dir, exist_ok=True)

    safe_name = re.sub(r'[\\/*?:"<>|]', "_", str(title or "youtube").strip()) or "youtube"
    output_template = os.path.join(target_dir, f"{safe_name}.%(ext)s")
    options = {
        "format": "bv*[height<=720]+ba/b[height<=720]/best",
        "outtmpl": output_template,
        "merge_output_format": "mp4",
        "ffmpeg_location": FFMPEG_EXE,
        "noplaylist": True,
        "quiet": True,
        "no_warnings": True,
        "windowsfilenames": True,
        "continuedl": True,
    }
    append_status_log(log_list, "YouTube 미디어 다운로드 시작")
    with yt_dlp.YoutubeDL(options) as downloader:
        info = downloader.extract_info(url, download=True)
    if cancel_event is not None and cancel_event.is_set():
        raise TaskCancelledError("사용자 요청으로 현재 작업이 취소되었습니다.")
    requested_downloads = (info or {}).get("requested_downloads") or []
    candidate_paths = [output_template.replace('%(ext)s', 'mp4')]
    for item in requested_downloads:
        if isinstance(item, dict):
            for key in ("filepath", "_filename", "filename"):
                value = item.get(key)
                if value:
                    candidate_paths.append(value)
    for key in ("filepath", "_filename", "filename"):
        value = (info or {}).get(key)
        if value:
            candidate_paths.append(value)
    candidate_paths.extend(
        os.path.join(target_dir, name)
        for name in os.listdir(target_dir)
        if os.path.isfile(os.path.join(target_dir, name))
    )
    for candidate in candidate_paths:
        if _is_completed_media(candidate, target_dir):
            append_status_log(log_list, f"YouTube 미디어 다운로드 완료: {os.path.basename(candidate)}")
            return os.path.abspath(candidate), normalize_compact_text((info or {}).get("title", ""))
    raise RuntimeError("YouTube 미디어 다운로드 결과 파일을 찾을 수 없습니다.")


def _playwright_cookie_jar(cookies):
    jar = CookieJar()
    for item in cookies:
        domain = str(item.get("domain") or "")
        if not item.get("name") or not domain:
            continue
        expires = item.get("expires", -1)
        expires = int(expires) if isinstance(expires, (int, float)) and expires > 0 else None
        jar.set_cookie(Cookie(
            version=0, name=item["name"], value=item.get("value", ""),
            port=None, port_specified=False, domain=domain,
            domain_specified=domain.startswith("."), domain_initial_dot=domain.startswith("."),
            path=item.get("path") or "/", path_specified=True,
            secure=bool(item.get("secure")), expires=expires, discard=expires is None,
            comment=None, comment_url=None, rest={}, rfc2109=False,
        ))
    return jar


def _collect_media_from_playwright_context(context, url, source_label="VOD", cancel_event=None, log_list=None):
    media_urls = []
    page_urls = []
    page = context.new_page()

    def capture_response(response):
        response_url = response.url
        clean_url = response_url.split("?")[0].lower()
        if clean_url.endswith(".ts"):
            return
        if any(marker in clean_url for marker in (".m3u8", ".mp4", ".webm", ".m4v", ".mpd")):
            if response_url not in media_urls:
                media_urls.append(response_url)

    page.on("response", capture_response)
    page.goto(url, wait_until="domcontentloaded", timeout=30000)
    if "login" in page.url.lower():
        raise RuntimeError("AILS LMS browser is not logged in. Open LMS login in AILS and keep that browser window open.")
    for _ in range(10):
        if cancel_event is not None and cancel_event.is_set():
            raise TaskCancelledError("사용자 요청으로 작업이 취소되었습니다.")
        page.wait_for_timeout(1000)
        html_text = page.content()
        found_media, found_pages = _extract_media_and_page_urls(html_text, page.url)
        for media_url in found_media:
            if media_url not in media_urls:
                media_urls.append(media_url)
        for page_url in found_pages:
            if page_url not in page_urls:
                page_urls.append(page_url)
        if media_urls:
            break

    visited = {page.url}
    for next_page_url in page_urls[:10]:
        if media_urls:
            break
        if next_page_url in visited:
            continue
        visited.add(next_page_url)
        next_page = context.new_page()
        next_page.on("response", capture_response)
        try:
            next_page.goto(next_page_url, wait_until="domcontentloaded", timeout=30000)
            if "login" in next_page.url.lower():
                continue
            next_page.wait_for_timeout(2500)
            found_media, _ = _extract_media_and_page_urls(next_page.content(), next_page.url)
            for media_url in found_media:
                if media_url not in media_urls:
                    media_urls.append(media_url)
        finally:
            next_page.close()

    cookie_jar = _playwright_cookie_jar(context.cookies())
    final_url = page.url
    page.close()

    def _media_priority(u):
        clean = u.lower().split("?")[0]
        if clean.endswith(".m3u8") or clean.endswith(".mpd"):
            return 0
        if any(clean.endswith(ext) for ext in (".mp4", ".webm", ".m4v")):
            return 1
        return 2

    media_urls.sort(key=_media_priority)
    return media_urls, cookie_jar, final_url


def _discover_media_with_lms_browser(url, source_label="VOD", cancel_event=None, log_list=None):
    with LMS_MEDIA_DISCOVERY_LOCK:
        return _discover_media_with_lms_browser_unlocked(url, source_label, cancel_event, log_list)


def _discover_media_with_lms_browser_unlocked(url, source_label="VOD", cancel_event=None, log_list=None):
    try:
        from playwright.sync_api import sync_playwright
    except ImportError as error:
        raise RuntimeError("Playwright가 설치되어 있지 않습니다. requirements.txt를 설치한 뒤 다시 시도하세요.") from error

    append_status_log(log_list, f"{source_label} AILS LMS 브라우저에서 미디어를 확인합니다.")
    with sync_playwright() as playwright:
        try:
            browser = playwright.chromium.connect_over_cdp(get_lms_browser_cdp_ws_url(), timeout=5000)
        except Exception as error:
            raise RuntimeError(
                "AILS LMS 브라우저가 실행 중이 아닙니다. e-class VOD 작업을 다시 추가해 AILS가 브라우저를 열고 로그인하도록 해주세요."
            ) from error
        try:
            contexts = browser.contexts
            if not contexts:
                raise RuntimeError("AILS LMS 브라우저에 활성 컨텍스트가 없습니다. AILS에서 LMS 로그인을 다시 열어주세요.")
            return _collect_media_from_playwright_context(contexts[0], url, source_label, cancel_event, log_list)
        finally:
            # Keep the AILS-managed browser session alive after CDP probing.
            pass



def _cookie_header_from_jar(cookie_jar):
    return "; ".join(f"{cookie.name}={cookie.value}" for cookie in cookie_jar)


def _comet_user_data_dir():
    local_appdata = os.environ.get("LOCALAPPDATA", "")
    if not local_appdata:
        return ""
    candidate = os.path.join(local_appdata, "Perplexity", "Comet", "User Data")
    return candidate if os.path.isdir(candidate) else ""


def _comet_cookie_paths():
    user_data = _comet_user_data_dir()
    if not user_data:
        return "", ""
    cookie_file = os.path.join(user_data, "Default", "Network", "Cookies")
    key_file = os.path.join(user_data, "Local State")
    return (cookie_file if os.path.exists(cookie_file) else "", key_file if os.path.exists(key_file) else "")


def _load_browser_cookie_attempts(url):
    from urllib.parse import urlparse

    host = urlparse(url).hostname or ""
    attempts = []
    try:
        import browser_cookie3
    except ImportError as error:
        return [], [f"browser-cookie3 import failed: {error}"]

    errors = []
    try:
        default_id = get_default_browser_info()["id"]
    except Exception:
        default_id = ""

    comet_cookie_file, comet_key_file = _comet_cookie_paths()
    if default_id == "comet" and comet_cookie_file and comet_key_file:
        try:
            jar = browser_cookie3.chrome(cookie_file=comet_cookie_file, key_file=comet_key_file, domain_name=host)
            cookie_header = _cookie_header_from_jar(jar)
            if cookie_header:
                attempts.append(("Comet cookies", jar, cookie_header))
            else:
                errors.append(f"Comet cookies: no cookies for {host}")
        except Exception as error:
            errors.append(f"Comet cookies: {error}")

    loader_specs = [
        ("chrome", "Chrome cookies", browser_cookie3.chrome),
        ("edge", "Edge cookies", browser_cookie3.edge),
        ("firefox", "Firefox cookies", browser_cookie3.firefox),
        ("brave", "Brave cookies", getattr(browser_cookie3, "brave", None)),
        ("vivaldi", "Vivaldi cookies", getattr(browser_cookie3, "vivaldi", None)),
        ("opera", "Opera cookies", getattr(browser_cookie3, "opera", None)),
    ]
    try:
        loader_specs.sort(key=lambda item: item[0] != default_id)
    except Exception:
        pass
    for _browser_id, label, loader in loader_specs:
        if loader is None:
            continue
        try:
            jar = loader(domain_name=host)
            cookie_header = _cookie_header_from_jar(jar)
            if cookie_header:
                attempts.append((label, jar, cookie_header))
            else:
                errors.append(f"{label}: no cookies for {host}")
        except Exception as error:
            errors.append(f"{label}: {error}")
    return attempts, errors


def browser_cookie_session_available(url):
    attempts, _errors = _load_browser_cookie_attempts(url)
    return bool(attempts)


def _extract_media_and_page_urls(html_text, base_url):
    from html import unescape
    from urllib.parse import urljoin, unquote

    decoded = unescape(str(html_text or ""))
    decoded = decoded.replace("\\/", "/")
    decoded = unquote(decoded)
    urls = []
    for pattern in (
        r"https?://[^\s'\"<>]+",
        r"(?:src|href|file|url)\s*[:=]\s*['\"]([^'\"]+)['\"]",
    ):
        for match in re.finditer(pattern, decoded, re.IGNORECASE):
            value = match.group(1) if match.lastindex else match.group(0)
            value = value.strip().rstrip(");,]")
            if not value or value.startswith(("javascript:", "data:")):
                continue
            urls.append(urljoin(base_url, value))

    media_urls = []
    page_urls = []
    for candidate in urls:
        lowered = candidate.lower()
        clean = lowered.split("?")[0]
        if clean.endswith(".ts"):
            continue
        if any(marker in clean for marker in (".m3u8", ".mp4", ".webm", ".m4v", ".mpd")):
            if candidate not in media_urls:
                media_urls.append(candidate)
            continue
        if any(marker in lowered for marker in ("/mod/vod/", "vod", "viewer", "player", "media", "ubplayer")):
            if candidate not in page_urls:
                page_urls.append(candidate)
    return media_urls, page_urls


def _is_completed_media(path, target_dir):
    if not path:
        return False
    absolute = os.path.abspath(path)
    return (os.path.dirname(absolute) == os.path.abspath(target_dir)
            and os.path.splitext(absolute)[1].lower() in {'.mp4', '.mkv', '.webm', '.mov', '.m4v', '.flv', '.ts'}
            and os.path.isfile(absolute) and os.path.getsize(absolute) > 0)


def _download_with_ytdlp_options(yt_dlp, url, target_dir, output_template, options, source_label, log_list, cookie_jar=None):
    with yt_dlp.YoutubeDL(options) as downloader:
        for cookie in cookie_jar or []:
            downloader.cookiejar.set_cookie(cookie)
        info = downloader.extract_info(url, download=True)

    candidate_paths = [output_template.replace('%(ext)s', 'mp4')]
    for item in (info or {}).get("requested_downloads") or []:
        if isinstance(item, dict):
            for key in ("filepath", "_filename", "filename"):
                value = item.get(key)
                if value:
                    candidate_paths.append(value)
    for key in ("filepath", "_filename", "filename"):
        value = (info or {}).get(key)
        if value:
            candidate_paths.append(value)
    candidate_paths.extend(
        os.path.join(target_dir, name)
        for name in os.listdir(target_dir)
        if os.path.isfile(os.path.join(target_dir, name))
    )
    for candidate in candidate_paths:
        if _is_completed_media(candidate, target_dir):
            append_status_log(log_list, f"{source_label} 다운로드 완료: {os.path.basename(candidate)}")
            return os.path.abspath(candidate), normalize_compact_text((info or {}).get("title", ""))
    raise RuntimeError(f"{source_label} 다운로드가 끝났지만 출력 파일을 찾지 못했습니다.")


def download_authenticated_web_media(url, target_dir, title, *, source_label="VOD", cancel_event=None, log_list=None):
    import requests
    try:
        import yt_dlp
    except ImportError as error:
        raise RuntimeError("yt-dlp가 설치되어 있지 않습니다. requirements.txt를 설치한 뒤 다시 시도하세요.") from error

    os.makedirs(target_dir, exist_ok=True)

    safe_name = re.sub(r'[\\/*?:"<>|]', "_", str(title or source_label or "vod").strip()) or "vod"
    output_template = os.path.join(target_dir, f"{safe_name}.%(ext)s")
    base_headers = get_stealth_headers(referer=url)
    base_options = {
        "format": "bv*[height<=720]+ba/b[height<=720]/best",
        "outtmpl": output_template,
        "merge_output_format": "mp4",
        "ffmpeg_location": FFMPEG_EXE,
        "noplaylist": True,
        "quiet": True,
        "no_warnings": True,
        "windowsfilenames": True,
        "continuedl": True,
        "http_headers": dict(base_headers),
    }

    errors = []

    try:
        media_candidates, lms_cookie_jar, final_page_url = _discover_media_with_lms_browser(
            url,
            source_label=source_label,
            cancel_event=cancel_event,
            log_list=log_list,
        )
    except Exception as error:
        errors.append(f"[phase:lms_media_discovery] AILS LMS session probe: {error}")
        media_candidates = []
        lms_cookie_jar = None
        final_page_url = url
    for media_url in media_candidates:
        if cancel_event is not None and cancel_event.is_set():
            raise TaskCancelledError("사용자 요청으로 작업이 취소되었습니다.")
        append_status_log(log_list, f"{source_label} 미디어 URL을 AILS LMS 세션에서 찾았습니다.")
        options = dict(base_options)
        headers = dict(base_headers)
        headers["Referer"] = final_page_url or url
        options["http_headers"] = headers
        try:
            return _download_with_ytdlp_options(yt_dlp, media_url, target_dir, output_template, options, source_label, log_list, cookie_jar=lms_cookie_jar)
        except Exception as error:
            errors.append(f"[phase:media_download] AILS LMS media download {media_url}: {error}")

    cookie_attempts, cookie_errors = _load_browser_cookie_attempts(url)
    errors.extend(cookie_errors)

    # First, open the LMS page with browser cookies and discover the real media URL.
    for label, cookie_jar, cookie_header in cookie_attempts:
        if cancel_event is not None and cancel_event.is_set():
            raise TaskCancelledError("사용자 요청으로 작업이 취소되었습니다.")
        append_status_log(log_list, f"{source_label} 페이지 확인 중: {label}")
        session = requests.Session()
        session.cookies.update(cookie_jar)
        session.headers.update(base_headers)
        try:
            response = session.get(url, timeout=20, allow_redirects=True)
            response.raise_for_status()
        except Exception as error:
            errors.append(f"{label} page probe: {error}")
            continue
        final_url = str(response.url or "")
        if "login" in final_url.lower():
            errors.append(f"{label} page probe: redirected to login ({final_url})")
            continue

        queue = [(final_url, response.text)]
        seen_pages = {final_url}
        media_candidates = []
        for page_url, html_text in queue:
            found_media, found_pages = _extract_media_and_page_urls(html_text, page_url)
            for media_url in found_media:
                if media_url not in media_candidates:
                    media_candidates.append(media_url)
            for next_page_url in found_pages:
                if len(seen_pages) >= 10 or next_page_url in seen_pages:
                    continue
                seen_pages.add(next_page_url)
                try:
                    next_response = session.get(next_page_url, timeout=20, allow_redirects=True)
                    next_response.raise_for_status()
                except Exception as error:
                    errors.append(f"{label} linked page {next_page_url}: {error}")
                    continue
                if "login" in str(next_response.url or "").lower():
                    continue
                queue.append((str(next_response.url or next_page_url), next_response.text))

        for media_url in media_candidates:
            if cancel_event is not None and cancel_event.is_set():
                raise TaskCancelledError("사용자 요청으로 작업이 취소되었습니다.")
            append_status_log(log_list, f"{source_label} 미디어 URL을 찾았습니다. {label}로 다운로드합니다.")
            options = dict(base_options)
            headers = dict(base_headers)
            headers["Referer"] = final_url or url
            options["http_headers"] = headers
            try:
                return _download_with_ytdlp_options(yt_dlp, media_url, target_dir, output_template, options, source_label, log_list, cookie_jar=cookie_jar)
            except Exception as error:
                errors.append(f"{label} media download {media_url}: {error}")

        # Keep the browser cookie domains when trying the authenticated page.
        append_status_log(log_list, f"{source_label} 인증 세션으로 yt-dlp 다운로드 시도: {label}")
        options = dict(base_options)
        headers = dict(base_headers)
        options["http_headers"] = headers
        try:
            return _download_with_ytdlp_options(yt_dlp, url, target_dir, output_template, options, source_label, log_list, cookie_jar=cookie_jar)
        except Exception as error:
            errors.append(f"{label} authenticated yt-dlp: {error}")

    # Last resort: yt-dlp's own browser cookie extraction and no-cookie attempt.
    fallback_attempts = []
    comet_user_data = _comet_user_data_dir()
    if comet_user_data:
        fallback_attempts.append(("yt-dlp Comet cookies", {"cookiesfrombrowser": ("chrome", comet_user_data)}))
    fallback_attempts.extend([
        ("yt-dlp Chrome cookies", {"cookiesfrombrowser": ("chrome",)}),
        ("yt-dlp Edge cookies", {"cookiesfrombrowser": ("edge",)}),
        ("yt-dlp Firefox cookies", {"cookiesfrombrowser": ("firefox",)}),
        ("without cookies", {}),
    ])
    for label, extra_options in fallback_attempts:
        if cancel_event is not None and cancel_event.is_set():
            raise TaskCancelledError("사용자 요청으로 작업이 취소되었습니다.")
        append_status_log(log_list, f"{source_label} 다운로드 시도: {label}")
        options = dict(base_options)
        options.update(extra_options)
        try:
            return _download_with_ytdlp_options(yt_dlp, url, target_dir, output_template, options, source_label, log_list)
        except Exception as error:
            errors.append(f"{label}: {error}")

    detail = "\n".join(errors[-8:])
    raise RuntimeError(
        f"{source_label} 다운로드에 실패했습니다. Windows 기본 브라우저에서 e-class에 로그인한 뒤 다시 시도하세요. "
        f"자료가 제한되었거나 DRM으로 보호되어 있을 수도 있습니다.\n{detail}"
    )


def download_file_with_progress(url, target_path, log_list=None, label="file", cancel_check=None):
    import requests
    os.makedirs(os.path.dirname(target_path), exist_ok=True)
    tmp_path = f"{target_path}.download"
    safe_remove(tmp_path)
    downloaded = 0
    last_logged_mb = -1
    append_status_log(log_list, f"{label} 다운로드 시작")
    with requests.get(url, stream=True, timeout=30, headers=get_stealth_headers()) as response:
        response.raise_for_status()
        total = int(response.headers.get("content-length") or 0)
        with open(tmp_path, "wb") as handle:
            for chunk in response.iter_content(chunk_size=1024 * 1024):
                if cancel_check is not None:
                    cancel_check()
                if not chunk:
                    continue
                handle.write(chunk)
                downloaded += len(chunk)
                downloaded_mb = downloaded // (1024 * 1024)
                if downloaded_mb >= last_logged_mb + 100:
                    last_logged_mb = downloaded_mb
                    if total > 0:
                        append_status_log(log_list, f"{label} 다운로드 중: {downloaded_mb}MB / {total // (1024 * 1024)}MB")
                    else:
                        append_status_log(log_list, f"{label} 다운로드 중: {downloaded_mb}MB")
    os.replace(tmp_path, target_path)
    append_status_log(log_list, f"{label} 다운로드 완료: {os.path.basename(target_path)}")
    return target_path
