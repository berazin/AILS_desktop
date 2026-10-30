"""LMS browser automation, course scanning, and e-class task queueing.

Extracted from api_server.py to isolate Playwright LMS interactions and
course material extraction into a dedicated mixin.
"""

from __future__ import annotations

import ctypes
import logging
import os
import re
import subprocess
import threading
import time
import urllib.parse
import uuid
from typing import Callable, Any
from urllib.parse import urlparse

from edition_manifest import require_feature
from pipeline_utils import TaskCancelledError
from server_config import save_config
from web_media_downloader import (
    LMS_BROWSER_CDP_PORT,
    get_lms_browser_cdp_url,
    get_lms_browser_cdp_ws_url,
    get_lms_browser_info,
    get_lms_browser_profile_dir,
)

import pipeline_utils


from lms.course_support import existing_lms_reports, lms_scan_academic_period


_logger = logging.getLogger(__name__)


from dataclasses import dataclass
from collections.abc import Callable
from typing import Any
import threading



# api_server에서 이동: LMS 학기 범위 계산
LMS_KEYRING_SERVICE = "AILS Hansung LMS"
LMS_KEYRING_USERNAME = "hansung_lms"
