from __future__ import annotations

import ctypes
import logging
import time
from ctypes import wintypes

from src.win.keyboard_map import (
    MODIFIER_SCAN_CODE_MAP,
    MODIFIER_VK_CODE_MAP,
    SCAN_CODE_MAP,
    VK_CODE_MAP,
    parse_key_stroke,
)

logger = logging.getLogger(__name__)

user32 = ctypes.WinDLL("user32", use_last_error=True)

PostMessageW = user32.PostMessageW
PostMessageW.argtypes = (wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM)
PostMessageW.restype = wintypes.BOOL

WM_KEYDOWN = 0x0100
WM_KEYUP = 0x0101


def _build_lparam(scan_code: int, is_down: bool) -> int:
    repeat_count = 1
    lparam = repeat_count | (scan_code << 16)
    if not is_down:
        lparam |= 1 << 30
        lparam |= 1 << 31
    return lparam


def _post_single(hwnd: int, vk_code: int, scan_code: int, is_down: bool) -> bool:
    msg = WM_KEYDOWN if is_down else WM_KEYUP
    lparam = _build_lparam(scan_code, is_down)
    ok = bool(PostMessageW(hwnd, msg, vk_code, lparam))
    if not ok:
        logger.error(
            f"PostMessage failed: hwnd=0x{int(hwnd):x}, vk={vk_code}, scan={scan_code}, is_down={is_down}, error={ctypes.get_last_error()}"
        )
    return ok


def post_key(hwnd: int | None, key: str, is_down: bool, latency_ms: int = 0) -> bool:
    """向指定窗口投递键盘消息，支持 SHIFT/CTRL/ALT 组合键。"""
    if not hwnd:
        logger.warning("窗口消息发送失败：目标窗口句柄为空")
        return False

    parsed = parse_key_stroke(key)
    if parsed is None:
        logger.warning(f"窗口消息模式不支持按键: {key}")
        return False

    if latency_ms > 0:
        time.sleep(latency_ms / 1000.0)

    modifier_pairs = [(MODIFIER_VK_CODE_MAP[item], MODIFIER_SCAN_CODE_MAP[item]) for item in parsed.modifiers]
    primary_vk = VK_CODE_MAP.get(parsed.primary)
    primary_scan = SCAN_CODE_MAP.get(parsed.primary)
    if primary_vk is None or primary_scan is None:
        logger.warning(f"窗口消息模式不支持按键: {key}")
        return False

    success = True
    if is_down:
        for modifier_vk, modifier_scan in modifier_pairs:
            success = _post_single(hwnd, modifier_vk, modifier_scan, True) and success
        success = _post_single(hwnd, primary_vk, primary_scan, True) and success
    else:
        success = _post_single(hwnd, primary_vk, primary_scan, False) and success
        for modifier_vk, modifier_scan in reversed(modifier_pairs):
            success = _post_single(hwnd, modifier_vk, modifier_scan, False) and success

    if not success:
        logger.warning(f"按键发送失败: {key}")
    return success
