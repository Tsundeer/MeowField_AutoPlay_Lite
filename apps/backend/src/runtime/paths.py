from __future__ import annotations

import os
import sys
from pathlib import Path

APP_DIR_NAME = "MeowField_Autoplayer_Lite"


def get_runtime_root() -> Path:
    """获取当前后端运行根目录。"""
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent
    return Path(__file__).resolve().parents[2]


def get_bundle_root() -> Path:
    """获取 PyInstaller 解包目录或源码运行目录。"""
    bundle_dir = getattr(sys, "_MEIPASS", None)
    if bundle_dir:
        return Path(bundle_dir).resolve()
    return get_runtime_root()


def get_user_data_dir() -> Path:
    """获取可写的用户数据目录。"""
    local_appdata = str(os.environ.get("LOCALAPPDATA") or "").strip()
    if local_appdata:
        return Path(local_appdata) / APP_DIR_NAME
    return get_runtime_root()


def ensure_dir(path: str | Path) -> Path:
    """确保目录存在。"""
    resolved = Path(path).resolve()
    resolved.mkdir(parents=True, exist_ok=True)
    return resolved


def get_logs_dir() -> Path:
    """获取日志目录。"""
    override_dir = str(os.environ.get("MEOWFIELD_AUTOPLAYER_LOG_DIR") or "").strip()
    if override_dir:
        return ensure_dir(override_dir)

    if getattr(sys, "frozen", False):
        return ensure_dir(get_user_data_dir() / "logs")

    return ensure_dir(Path.cwd())


def get_backend_log_path() -> Path:
    """获取后端日志文件路径。"""
    return get_logs_dir() / "backend.log"


def get_game_profiles_dir() -> Path:
    """获取游戏配置目录。"""
    candidates = [
        get_bundle_root() / "game_configs",
        get_runtime_root() / "game_configs",
    ]
    for candidate in candidates:
        if candidate.exists():
            return candidate
    return candidates[0]


def get_library_data_dir() -> Path:
    """获取曲库等运行时数据目录。"""
    if getattr(sys, "frozen", False):
        return ensure_dir(get_user_data_dir() / "data")
    return ensure_dir(get_runtime_root())
