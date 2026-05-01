from __future__ import annotations

import ctypes
from ctypes import wintypes
import logging
import os

logger = logging.getLogger(__name__)

user32 = ctypes.WinDLL("user32", use_last_error=True)
psapi = ctypes.WinDLL("psapi", use_last_error=True)
kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)

GetForegroundWindow = user32.GetForegroundWindow
GetWindowThreadProcessId = user32.GetWindowThreadProcessId
EnumWindows = user32.EnumWindows
GetWindowTextW = user32.GetWindowTextW
IsWindowVisible = user32.IsWindowVisible
GetAncestor = user32.GetAncestor
SetFocus = user32.SetFocus
GetFocus = user32.GetFocus
AttachThreadInput = user32.AttachThreadInput
SetWindowTextW = user32.SetWindowTextW

OpenProcess = kernel32.OpenProcess
CloseHandle = kernel32.CloseHandle

GetModuleBaseNameW = psapi.GetModuleBaseNameW
QueryFullProcessImageNameW = kernel32.QueryFullProcessImageNameW
GetCurrentThreadId = kernel32.GetCurrentThreadId

PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
PROCESS_VM_READ = 0x0010
PROCESS_NAME_NATIVE = 0x00000001
GA_ROOT = 2


# 进程名降级前缀（当无法获取进程名时使用窗口标题替代）
_FALLBACK_PREFIX = "[窗口]"
_UNKNOWN_PREFIX = "[未知进程 PID:"


def _strip_fallback_prefix(target: str) -> str:
    """去掉降级前缀，提取真实匹配关键词"""
    t = target.strip()
    if t.startswith(_FALLBACK_PREFIX):
        return t[len(_FALLBACK_PREFIX):]
    if t.startswith(_UNKNOWN_PREFIX):
        # [未知进程 PID:12345] -> 保留原样，无法匹配
        return t
    return t


def _get_foreground_pid() -> int | None:
    hwnd = GetForegroundWindow()
    if not hwnd:
        return None

    pid = wintypes.DWORD()
    GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
    if pid.value == 0:
        return None
    return int(pid.value)


def _get_process_name(pid: int) -> str | None:
    """获取进程名，优先使用最低权限方式，反作弊游戏也能读到"""
    # 方式1：仅需 PROCESS_QUERY_LIMITED_INFORMATION，反作弊游戏通常不拦截
    handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, False, pid)
    if handle:
        try:
            buf = ctypes.create_unicode_buffer(260)
            size = wintypes.DWORD(260)
            if QueryFullProcessImageNameW(handle, PROCESS_NAME_NATIVE, buf, ctypes.byref(size)):
                full_path = buf.value
                if full_path:
                    return os.path.basename(full_path)
        except Exception:
            pass
        finally:
            CloseHandle(handle)

    # 方式2：回退到 GetModuleBaseNameW（需要 PROCESS_VM_READ）
    handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_VM_READ, False, pid)
    if not handle:
        return None

    try:
        buf = ctypes.create_unicode_buffer(260)
        n = GetModuleBaseNameW(handle, None, buf, 260)
        if n == 0:
            return None
        return buf.value
    finally:
        CloseHandle(handle)


def _resolve_window(hwnd: int) -> int:
    root = GetAncestor(hwnd, GA_ROOT)
    return int(root or hwnd)


def _get_foreground_window_title() -> str | None:
    """获取前台窗口标题"""
    hwnd = GetForegroundWindow()
    if not hwnd:
        return None
    buf = ctypes.create_unicode_buffer(512)
    GetWindowTextW(hwnd, buf, 512)
    return buf.value or None


def foreground_matches(target: str | None) -> bool:
    if not target:
        logger.info("未设置进程绑定，允许发送按键")
        return True

    pid = _get_foreground_pid()
    if pid is None:
        logger.warning("无法获取前台窗口 PID，禁止发送按键")
        return False

    name = _get_process_name(pid)
    target_lower = target.lower()

    if name:
        is_match = target_lower in name.lower()
        if is_match:
            logger.info(f"进程匹配检查：target={target}, foreground={name}, match={is_match}")
        else:
            logger.warning(f"进程不匹配：target={target}, foreground={name}, match={is_match}，请确保游戏窗口在前台")
        return is_match

    # 进程名获取失败（反作弊保护），回退到窗口标题匹配
    title = _get_foreground_window_title()
    if title:
        # 去掉降级前缀后匹配
        clean_target = _strip_fallback_prefix(target)
        is_match = clean_target.lower() in title.lower()
        if is_match:
            logger.info(f"标题匹配（回退模式）：target={target}(clean={clean_target}), foreground_title={title}, match={is_match}")
        else:
            logger.warning(f"标题不匹配（回退模式）：target={target}(clean={clean_target}), foreground_title={title}, match={is_match}")
        return is_match

    logger.warning(f"无法获取进程 {pid} 的名称和窗口标题，禁止发送按键")
    return False


def foreground_info() -> dict[str, str | int | None]:
    pid = _get_foreground_pid()
    name = None
    if pid is not None:
        try:
            name = _get_process_name(pid)
        except Exception:
            name = None
    return {"pid": pid, "name": name}


def list_visible_windows() -> list[dict[str, str | int]]:
    result = []
    seen_pids = set()

    def callback(hwnd, _):
        if IsWindowVisible(hwnd):
            pid = wintypes.DWORD()
            GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
            if pid.value and pid.value not in seen_pids:
                title_buf = ctypes.create_unicode_buffer(512)
                GetWindowTextW(hwnd, title_buf, 512)
                title = title_buf.value

                name = _get_process_name(pid.value)
                if not name and title:
                    # 进程名获取失败（反作弊保护），降级为窗口标题
                    name = f"{_FALLBACK_PREFIX}{title}"
                elif not name:
                    name = f"{_UNKNOWN_PREFIX}{pid.value}]"

                if name:
                    resolved_hwnd = _resolve_window(hwnd)
                    result.append({
                        'pid': pid.value,
                        'name': name,
                        'title': title,
                        'hwnd': resolved_hwnd,
                    })
                    seen_pids.add(pid.value)
        return True

    WNDENUMPROC = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
    EnumWindows(WNDENUMPROC(callback), 0)
    
    return sorted(result, key=lambda x: x['name'].lower())


def find_window_for_process(target: str | None) -> int | None:
    """按绑定进程名找到一个可见顶层窗口句柄。支持进程名和窗口标题两种匹配。"""
    if not target:
        return None

    matched_hwnd: int | None = None
    matched_title_len = -1
    target_lower = target.lower()
    # 提前提取降级前缀（如果有的话）用于标题回退匹配
    clean_target_lower = _strip_fallback_prefix(target).lower()

    def callback(hwnd, _):
        nonlocal matched_hwnd, matched_title_len
        if not IsWindowVisible(hwnd):
            return True

        pid = wintypes.DWORD()
        GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
        if not pid.value:
            return True

        title_buf = ctypes.create_unicode_buffer(512)
        GetWindowTextW(hwnd, title_buf, 512)
        title = title_buf.value

        name = _get_process_name(pid.value)

        # 优先匹配进程名，其次匹配窗口标题
        matched = False
        if name and target_lower in name.lower():
            matched = True
        elif title and clean_target_lower in title.lower():
            matched = True

        if matched and len(title) > matched_title_len:
            matched_hwnd = _resolve_window(hwnd)
            matched_title_len = len(title)
        return True

    WNDENUMPROC = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
    EnumWindows(WNDENUMPROC(callback), 0)
    return matched_hwnd


IsWindow = user32.IsWindow


def is_window_alive(hwnd: int) -> bool:
    """检查窗口句柄是否仍然有效（非阻塞，不枚举）"""
    if not hwnd:
        return False
    return bool(IsWindow(hwnd))


class BackgroundInputSession:
    """后台输入会话：通过 AttachThreadInput 让 SendInput 分发到非前台窗口。

    Unity 游戏用 GetAsyncKeyState 轮询键盘硬件状态，不处理 WM_KEYDOWN。
    PostMessage 发的按键消息游戏感知不到。
    正确做法：附加线程 + 设置键盘焦点 + SendInput。

    用法：
        session = BackgroundInputSession(game_hwnd)
        session.attach()            # 开始后台输入
        send_key(...)               # SendInput 会到达游戏窗口
        session.detach()            # 恢复
    """

    def __init__(self, hwnd: int) -> None:
        self._hwnd = hwnd
        self._attached = False
        self._prev_focus: int | None = None
        self._our_tid = GetCurrentThreadId()

    def attach(self) -> bool:
        if self._attached:
            return True

        if not is_window_alive(self._hwnd):
            logger.warning(f"后台输入: 目标窗口无效 hwnd=0x{self._hwnd:x}")
            return False

        game_tid = GetWindowThreadProcessId(self._hwnd, None)
        if not game_tid:
            logger.warning(f"后台输入: 无法获取目标窗口线程ID")
            return False

        if game_tid == self._our_tid:
            # 同线程，直接设焦点即可
            logger.info("后台输入: 与游戏同线程，直接设置焦点")
        else:
            if not AttachThreadInput(self._our_tid, game_tid, True):
                err = ctypes.get_last_error()
                if err == 5:
                    logger.warning(
                        f"后台输入: AttachThreadInput 被拒绝 (error=5 ACCESS_DENIED)。"
                        f"这可能是因为游戏进程权限高于当前进程。请以管理员身份运行本程序。"
                    )
                else:
                    logger.warning(f"后台输入: AttachThreadInput 失败, error={err}")
                return False
            logger.info(f"后台输入: 线程已附加 our_tid={self._our_tid}, game_tid={game_tid}")

        self._prev_focus = GetFocus() or None
        prev_set = SetFocus(self._hwnd)
        actual_focus = GetFocus()
        focus_ok = (actual_focus == self._hwnd)
        logger.info(
            f"后台输入: 焦点设置 prev=0x{self._prev_focus or 0:x} "
            f"target=0x{self._hwnd:x} prev_set=0x{prev_set or 0:x} actual=0x{actual_focus or 0:x} ok={focus_ok}"
        )
        if not focus_ok:
            logger.warning("后台输入: 设置焦点失败，SendInput 可能发送到错误窗口！")
        self._attached = True
        return True

    def detach(self) -> None:
        if not self._attached:
            return

        game_tid = GetWindowThreadProcessId(self._hwnd, None)
        if game_tid and game_tid != self._our_tid:
            AttachThreadInput(self._our_tid, game_tid, False)
            logger.info(f"后台输入: 线程已分离")

        if self._prev_focus and is_window_alive(self._prev_focus):
            SetFocus(self._prev_focus)
            logger.info(f"后台输入: 焦点已恢复 0x{self._prev_focus:x}")

        self._attached = False
        self._prev_focus = None

    def ensure_focus(self) -> bool:
        """验证并维持焦点。播放期间周期性调用，防止焦点漂移导致按键发到全局。"""
        if not self._attached:
            return False
        if not is_window_alive(self._hwnd):
            self._attached = False
            return False

        current = GetFocus()
        if current == self._hwnd:
            return True

        # 焦点漂移了，重新设置
        logger.warning(
            f"后台输入: 焦点漂移 current=0x{current or 0:x} target=0x{self._hwnd:x}，重新设置"
        )
        SetFocus(self._hwnd)
        return (GetFocus() == self._hwnd)


def is_admin() -> bool:
    try:
        return ctypes.windll.shell32.IsUserAnAdmin()
    except:
        return False
