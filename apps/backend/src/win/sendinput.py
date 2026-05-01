from __future__ import annotations

import ctypes
import logging
import sys
import time
from ctypes import wintypes

from src.win.keyboard_map import MODIFIER_SCAN_CODE_MAP, parse_key_stroke

logger = logging.getLogger(__name__)

if sys.maxsize > 2**32:
    ULONG_PTR = ctypes.c_uint64
else:
    ULONG_PTR = ctypes.c_uint32


user32 = ctypes.WinDLL("user32", use_last_error=True)

INPUT_KEYBOARD = 1
KEYEVENTF_KEYUP = 0x0002
KEYEVENTF_SCANCODE = 0x0008


class KEYBDINPUT(ctypes.Structure):
    _fields_ = [
        ("wVk", wintypes.WORD),
        ("wScan", wintypes.WORD),
        ("dwFlags", wintypes.DWORD),
        ("time", wintypes.DWORD),
        ("dwExtraInfo", ULONG_PTR),
    ]


class MOUSEINPUT(ctypes.Structure):
    _fields_ = [
        ("dx", wintypes.LONG),
        ("dy", wintypes.LONG),
        ("mouseData", wintypes.DWORD),
        ("dwFlags", wintypes.DWORD),
        ("time", wintypes.DWORD),
        ("dwExtraInfo", ULONG_PTR),
    ]


class HARDWAREINPUT(ctypes.Structure):
    _fields_ = [
        ("uMsg", wintypes.DWORD),
        ("wParamL", wintypes.WORD),
        ("wParamH", wintypes.WORD),
    ]


class _INPUTUNION(ctypes.Union):
    _fields_ = [
        ("ki", KEYBDINPUT),
        ("mi", MOUSEINPUT),
        ("hi", HARDWAREINPUT),
    ]


class INPUT(ctypes.Structure):
    _anonymous_ = ("u",)
    _fields_ = [("type", wintypes.DWORD), ("u", _INPUTUNION)]


SendInput = user32.SendInput
SendInput.argtypes = (wintypes.UINT, ctypes.POINTER(INPUT), ctypes.c_int)
SendInput.restype = wintypes.UINT


def _send_scan_code(scan_code: int, is_down: bool) -> bool:
    flags = KEYEVENTF_SCANCODE
    if not is_down:
        flags |= KEYEVENTF_KEYUP

    inp = INPUT()
    inp.type = INPUT_KEYBOARD
    inp.ki.wVk = 0
    inp.ki.wScan = scan_code
    inp.ki.dwFlags = flags
    inp.ki.time = 0
    inp.ki.dwExtraInfo = 0

    n = SendInput(1, ctypes.byref(inp), ctypes.sizeof(INPUT))
    err = ctypes.get_last_error()
    if n != 1:
        logger.error(f"SendInput failed: scan={scan_code}, is_down={is_down}, n={n}, error={err}")
        return False
    return True


def send_key(key: str, is_down: bool, latency_ms: int = 0) -> bool:
    """使用 SendInput 发送按键，支持 SHIFT/CTRL/ALT 组合键。"""
    parsed = parse_key_stroke(key)
    if parsed is None:
        logger.warning(f"未知的按键: {key}")
        return False

    if latency_ms > 0:
        time.sleep(latency_ms / 1000.0)

    modifier_scans = [MODIFIER_SCAN_CODE_MAP[modifier] for modifier in parsed.modifiers]
    primary_scan = MODIFIER_SCAN_CODE_MAP.get(parsed.primary)
    if primary_scan is None:
        from src.win.keyboard_map import SCAN_CODE_MAP
        primary_scan = SCAN_CODE_MAP.get(parsed.primary)

    if primary_scan is None:
        logger.warning(f"未知的按键: {key}")
        return False

    success = True
    if is_down:
        for scan_code in modifier_scans:
            success = _send_scan_code(scan_code, True) and success
        success = _send_scan_code(primary_scan, True) and success
    else:
        success = _send_scan_code(primary_scan, False) and success
        for scan_code in reversed(modifier_scans):
            success = _send_scan_code(scan_code, False) and success

    if not success:
        logger.warning(f"按键发送失败: {key}")
    return success
