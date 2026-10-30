from __future__ import annotations

import os
import re
import subprocess
import time
import wave

from common import CREATE_NO_WINDOW, FFMPEG_EXE, FFPROBE_EXE


class TaskCancelledError(Exception):
    pass


def safe_remove(file_path):
    if not file_path:
        return
    try:
        if os.path.exists(file_path):
            os.remove(file_path)
    except Exception:
        pass


def sleep_with_cancel(seconds, cancel_check=None, interval=0.2):
    if seconds <= 0:
        return
    elapsed = 0.0
    while elapsed < seconds:
        if cancel_check and cancel_check():
            raise TaskCancelledError("사용자 요청으로 작업이 취소되었습니다.")
        step = min(interval, seconds - elapsed)
        time.sleep(step)
        elapsed += step


def run_subprocess_with_cancel(
    cmd,
    cancel_event=None,
    cancel_check=None,
    poll_interval=0.2,
    **kwargs,
):
    check = kwargs.pop("check", False)
    capture_output = kwargs.pop("capture_output", False)
    if capture_output:
        if kwargs.get("stdout") is not None or kwargs.get("stderr") is not None:
            raise ValueError("stdout and stderr arguments may not be used with capture_output")
        kwargs["stdout"] = subprocess.PIPE
        kwargs["stderr"] = subprocess.PIPE
    creationflags = kwargs.get("creationflags", 0)
    if os.name == "nt":
        creationflags |= CREATE_NO_WINDOW
    kwargs["creationflags"] = creationflags
    process = subprocess.Popen(cmd, **kwargs)
    try:
        while True:
            if cancel_event is not None and cancel_event.is_set():
                raise TaskCancelledError("사용자 요청으로 작업이 취소되었습니다.")
            if cancel_check is not None and cancel_check():
                raise TaskCancelledError("사용자 요청으로 작업이 취소되었습니다.")
            try:
                stdout, stderr = process.communicate(timeout=poll_interval)
                break
            except subprocess.TimeoutExpired:
                continue
        if check and process.returncode != 0:
            raise subprocess.CalledProcessError(process.returncode, cmd, output=stdout, stderr=stderr)
        return subprocess.CompletedProcess(cmd, process.returncode, stdout, stderr)
    finally:
        if process.poll() is None:
            process.kill()
            process.communicate()


def build_audio_cleanup_filter(silence_threshold_db=-50.0):
    if silence_threshold_db is None:
        return None
    threshold = float(silence_threshold_db)
    return (
        "silenceremove="
        "start_periods=1:"
        "start_duration=5:"
        f"start_threshold={threshold:.0f}dB:"
        "start_silence=1:"
        "stop_periods=-1:"
        "stop_duration=5:"
        f"stop_threshold={threshold:.0f}dB:"
        "stop_silence=1:"
        "detection=rms"
    )



def get_media_duration_seconds(path):
    try:
        with wave.open(str(path), "rb") as source:
            frame_rate = source.getframerate()
            if frame_rate > 0:
                return source.getnframes() / frame_rate
    except (OSError, EOFError, wave.Error):
        pass

    try:
        probe = subprocess.run(
            [
                FFPROBE_EXE,
                "-v", "error",
                "-show_entries", "format=duration",
                "-of", "default=noprint_wrappers=1:nokey=1",
                path,
            ],
            check=True,
            capture_output=True,
            encoding="utf-8",
            errors="replace",
            creationflags=CREATE_NO_WINDOW,
        )
        value = float(str(probe.stdout or "").strip())
        if value > 0:
            return value
    except Exception:
        pass

    try:
        probe = subprocess.run(
            [FFMPEG_EXE, "-i", path],
            capture_output=True,
            encoding="utf-8",
            errors="replace",
            creationflags=CREATE_NO_WINDOW,
        )
        stderr = str(probe.stderr or "")
        match = re.search(r"Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)", stderr)
        if match:
            hours = int(match.group(1))
            minutes = int(match.group(2))
            seconds = float(match.group(3))
            return hours * 3600 + minutes * 60 + seconds
    except Exception:
        pass
    return 0.0



def create_mp3_file(source_path, target_path, cancel_event=None, silence_threshold_db=-50.0):
    safe_remove(target_path)
    cmd = [
        FFMPEG_EXE,
        "-i", source_path,
        "-vn",
    ]
    audio_filter = build_audio_cleanup_filter(silence_threshold_db=silence_threshold_db)
    if audio_filter:
        cmd.extend(["-af", audio_filter])
    cmd.extend([
        "-acodec", "libmp3lame",
        "-q:a", "2",
        target_path,
        "-y",
    ])
    run_subprocess_with_cancel(
        cmd,
        cancel_event=cancel_event,
        check=True,
        capture_output=True,
        creationflags=CREATE_NO_WINDOW
    )
    if not os.path.exists(target_path) or os.path.getsize(target_path) == 0:
        raise RuntimeError("MP3 파일 생성에 실패했습니다.")
    return target_path




def _split_pcm16_mono_wav(source_path, target_dir, prefix, segment_seconds, cancel_event=None):
    try:
        with wave.open(str(source_path), "rb") as source:
            if (source.getnchannels(), source.getsampwidth(), source.getframerate()) != (1, 2, 16000):
                return []
            frames_per_part = max(1, int(float(segment_seconds) * source.getframerate()))
            parts = []
            index = 0
            while True:
                if cancel_event is not None and cancel_event.is_set():
                    raise TaskCancelledError("사용자 요청으로 작업이 취소되었습니다.")
                frames = source.readframes(frames_per_part)
                if not frames:
                    break
                path = os.path.join(target_dir, f"{prefix}_{index:03d}.wav")
                with wave.open(path, "wb") as output:
                    output.setparams((1, 2, 16000, 0, "NONE", "not compressed"))
                    output.writeframes(frames)
                parts.append(path)
                index += 1
            return parts
    except (OSError, EOFError, wave.Error):
        return []


def split_audio_for_groq_stt(source_path, target_dir, segment_seconds=1200, cancel_event=None):
    os.makedirs(target_dir, exist_ok=True)
    for existing in os.listdir(target_dir):
        safe_remove(os.path.join(target_dir, existing))

    wave_parts = _split_pcm16_mono_wav(
        source_path, target_dir, "groq_part", segment_seconds, cancel_event
    )
    if wave_parts:
        return wave_parts

    extension = os.path.splitext(source_path)[1].lower() or ".mp3"
    output_pattern = os.path.join(target_dir, f"groq_part_%03d{extension}")
    run_subprocess_with_cancel(
        [
            FFMPEG_EXE,
            "-i", source_path,
            "-f", "segment",
            "-segment_time", str(segment_seconds),
            "-c", "copy",
            output_pattern,
            "-y",
        ],
        cancel_event=cancel_event,
        check=True,
        capture_output=True,
        creationflags=CREATE_NO_WINDOW,
    )
    parts = sorted(
        os.path.join(target_dir, name)
        for name in os.listdir(target_dir)
        if name.startswith("groq_part_")
    )
    return [path for path in parts if os.path.exists(path) and os.path.getsize(path) > 0]

def split_audio_for_gemini_stt(source_path, target_dir, segment_seconds=900, cancel_event=None):
    os.makedirs(target_dir, exist_ok=True)
    for existing in os.listdir(target_dir):
        safe_remove(os.path.join(target_dir, existing))

    wave_parts = _split_pcm16_mono_wav(
        source_path, target_dir, "gemini_part", segment_seconds, cancel_event
    )
    if wave_parts:
        return wave_parts

    output_pattern = os.path.join(target_dir, "gemini_part_%03d.mp3")
    run_subprocess_with_cancel(
        [
            FFMPEG_EXE,
            "-i", source_path,
            "-vn",
            "-ac", "1",
            "-ar", "16000",
            "-f", "segment",
            "-segment_time", str(segment_seconds),
            "-reset_timestamps", "1",
            "-c:a", "libmp3lame",
            "-q:a", "4",
            output_pattern,
            "-y",
        ],
        cancel_event=cancel_event,
        check=True,
        capture_output=True,
        creationflags=CREATE_NO_WINDOW,
    )
    parts = sorted(
        os.path.join(target_dir, name)
        for name in os.listdir(target_dir)
        if name.startswith("gemini_part_")
    )
    return [path for path in parts if os.path.exists(path) and os.path.getsize(path) > 0]

