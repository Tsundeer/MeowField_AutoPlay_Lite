import asyncio
import json
import logging
import os
import sys
import pathlib
import time
from typing import Any

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
import uvicorn

from src.games.manager import GameProfileManager
from src.hotkeys.manager import HotkeyManager
from src.mapping.notes import (
    MappingConfig,
    find_optimal_transpose_for_config,
    calculate_white_key_ratio,
    calculate_range_fit_ratio,
)
from src.midi.parser import parse_midi_file
from src.player.engine import Engine
from src.win.focus import foreground_matches, foreground_info, list_visible_windows, is_admin, find_window_for_process, is_window_alive, BackgroundInputSession
from src.win.message_sender import post_key
from src.win.sendinput import send_key
from src.win.ntp_sync import sync_with_ntp
from src.win.network_latency import measure_network_latency
from src.converter.audio_to_midi import get_converter, convert_audio_to_midi, set_piano_trans_path
from src.library.manager import LibraryManager
from src.runtime.paths import get_backend_log_path


def _resolve_log_dir() -> str:
    env_dir = str(os.environ.get("MEOWFIELD_AUTOPLAYER_LOG_DIR") or "").strip()
    if env_dir:
        return env_dir

    # PyInstaller/frozen 时：先尝试输出到 exe 同目录（便于便携版用户直接找到）。
    if getattr(sys, "frozen", False):
        try:
            exe_dir = str(pathlib.Path(sys.executable).resolve().parent)
            return exe_dir
        except Exception:
            pass

    # 开发环境：仍输出到当前工作目录
    return os.getcwd()


def _configure_logging() -> str:
    def _ensure_dir(p: str) -> str | None:
        try:
            os.makedirs(p, exist_ok=True)
            test_path = os.path.join(p, ".__write_test")
            with open(test_path, "w", encoding="utf-8") as f:
                f.write("ok")
            try:
                os.remove(test_path)
            except Exception:
                pass
            return p
        except Exception:
            return None

    log_dir = _ensure_dir(str(get_backend_log_path().parent))

    # 安装版（通常在 Program Files）可能无法写入 exe 同目录，回退到 LOCALAPPDATA
    if log_dir is None and getattr(sys, "frozen", False):
        base = str(os.environ.get("LOCALAPPDATA") or "").strip()
        if base:
            log_dir = _ensure_dir(os.path.join(base, "MeowField_Autoplayer_Lite", "logs"))

    if log_dir is None:
        log_dir = _ensure_dir(os.getcwd()) or os.getcwd()

    log_path = os.path.join(log_dir, "backend.log")

    # 配置日志（保证无论在何处启动，都能落地到可写的本地文件）
    debug_enabled = str(os.environ.get("MEOWFIELD_AUTOPLAYER_DEBUG") or "").strip().lower() in (
        "1",
        "true",
        "yes",
        "on",
    )

    logging.basicConfig(
        level=(logging.DEBUG if debug_enabled else logging.INFO),
        format="%(asctime)s - %(levelname)s - %(message)s",
        handlers=[
            logging.FileHandler(log_path, encoding="utf-8"),
            logging.StreamHandler(),
        ],
    )

    return log_path


_BACKEND_LOG_PATH = _configure_logging()

logger = logging.getLogger(__name__)
logger.info(f"backend logging initialized: path={_BACKEND_LOG_PATH}, cwd={os.getcwd()}, exe={getattr(sys, 'executable', '')}")

app = FastAPI()


def _send(ws: WebSocket | None, payload: dict[str, Any]) -> None:
    """发送 WebSocket 消息（异步任务方式，忽略错误）"""
    if not ws:
        return
    async def _do_send():
        try:
            await ws.send_text(json.dumps(payload))
        except Exception:
            pass  # 忽略发送失败

    # 热键回调可能在非 asyncio 线程中触发，此时没有 running loop。
    # 优先使用当前线程 running loop；否则回退到主事件循环线程安全投递。
    try:
        loop = asyncio.get_running_loop()
        loop.create_task(_do_send())
    except RuntimeError:
        loop = getattr(STATE, "loop", None)
        if loop:
            loop.call_soon_threadsafe(lambda: loop.create_task(_do_send()))


def _load_midi_with_auto_transpose(midi_path: str) -> dict:
    """
    统一的 MIDI 加载函数，包含自动移调处理
    
    返回包含加载结果的字典
    """
    parsed = parse_midi_file(midi_path)
    
    # 提取音符并保存
    note_values = [n.note for n in parsed.notes] if parsed.notes else []
    STATE.midi_notes = note_values

    # 鼓模式下白键率/自动移调无意义，直接跳过
    if STATE.config.instrument == "drums":
        original_ratio = 0.0
        auto_transpose_result = None
        final_ratio = 0.0
        logger.info(f"加载 MIDI(鼓模式): channel_filter={STATE.config.midi_channel_filter}, notes={len(note_values)}")
        STATE.midi_path = midi_path
        STATE.engine.load(parsed, STATE.config)
        return {
            "parsed": parsed,
            "note_values": note_values,
            "original_ratio": original_ratio,
            "final_ratio": final_ratio,
            "auto_transpose_result": auto_transpose_result,
        }

    # 计算原始白键率
    if STATE.config.prefer_nearest_white:
        original_ratio = calculate_white_key_ratio(note_values, 0) if note_values else 0.0
    else:
        original_ratio = (
            calculate_range_fit_ratio(note_values, STATE.config.note_range_low, STATE.config.note_range_high, 0)
            if note_values else 0.0
        )
    
    # 自动移调处理
    auto_transpose_result = None
    final_ratio = original_ratio
    logger.info(f"加载 MIDI: auto_transpose={STATE.config.auto_transpose}, notes={len(note_values)}")
    
    if STATE.config.auto_transpose and note_values:
        optimal = find_optimal_transpose_for_config(note_values, STATE.config)
        logger.info(f"自动移调计算: optimal={optimal}")
        # 使用统一的配置更新函数
        STATE.config = _update_config(
            transpose_semitones=optimal,
            auto_transpose=True,
        )
        auto_transpose_result = optimal
        if STATE.config.prefer_nearest_white:
            final_ratio = calculate_white_key_ratio(note_values, optimal)
        else:
            final_ratio = calculate_range_fit_ratio(
                note_values,
                STATE.config.note_range_low,
                STATE.config.note_range_high,
                optimal,
            )
        if optimal != 0:
            logger.info(f"自动移调: {optimal} 半音, 白键率: {original_ratio:.1%} -> {final_ratio:.1%}")
        else:
            logger.info(f"自动移调: 当前移调已是最优，白键率: {final_ratio:.1%}")
    else:
        logger.info(f"跳过自动移调: auto_transpose={STATE.config.auto_transpose}, notes={len(note_values)}")
    
    STATE.midi_path = midi_path
    STATE.engine.load(parsed, STATE.config)
    
    result = {
        "parsed": parsed,
        "note_values": note_values,
        "original_ratio": original_ratio,
        "final_ratio": final_ratio,
        "auto_transpose_result": auto_transpose_result,
    }
    
    return result


def _update_config(**kwargs) -> MappingConfig:
    """统一的配置更新函数"""
    current = STATE.config
    return MappingConfig(
        instrument=kwargs.get('instrument', current.instrument),
        input_mode=kwargs.get('input_mode', getattr(current, 'input_mode', 'sendinput')),
        midi_channel_filter=kwargs.get('midi_channel_filter', current.midi_channel_filter),
        note_range_low=kwargs.get('note_range_low', current.note_range_low),
        note_range_high=kwargs.get('note_range_high', current.note_range_high),
        prefer_nearest_white=kwargs.get('prefer_nearest_white', current.prefer_nearest_white),
        transpose_semitones=kwargs.get('transpose_semitones', current.transpose_semitones),
        speed=kwargs.get('speed', current.speed),
        max_polyphony=kwargs.get('max_polyphony', current.max_polyphony),
        chord_mode=kwargs.get('chord_mode', current.chord_mode),
        keep_melody_top_note=kwargs.get('keep_melody_top_note', current.keep_melody_top_note),
        chord_cluster_window_ms=kwargs.get('chord_cluster_window_ms', current.chord_cluster_window_ms),
        auto_transpose=kwargs.get('auto_transpose', current.auto_transpose),
        link_latency_ms=kwargs.get('link_latency_ms', current.link_latency_ms),
        hotkeys=kwargs.get('hotkeys', current.hotkeys),
        custom_key_map=kwargs.get('custom_key_map', current.custom_key_map),
    )


def _calculate_config_fit_ratio(notes: list[int], cfg: MappingConfig, transpose: int | None = None) -> float:
    """按当前游戏配置计算适配率。白键游戏返回白键率，全音阶游戏返回音域命中率。"""
    if not notes:
        return 0.0

    actual_transpose = cfg.transpose_semitones if transpose is None else transpose
    if cfg.prefer_nearest_white:
        return calculate_white_key_ratio(notes, actual_transpose)

    return calculate_range_fit_ratio(
        notes,
        cfg.note_range_low,
        cfg.note_range_high,
        actual_transpose,
    )


def _setup_background_input() -> bool:
    """为后台演奏设置 AttachThreadInput + SetFocus，使 SendInput 分发到游戏。"""
    hwnd = _resolve_target_hwnd()
    if not hwnd:
        logger.warning("后台输入设置失败：未找到目标窗口")
        return False

    session = BackgroundInputSession(hwnd)
    if not session.attach():
        return False

    STATE.bg_session = session
    logger.info(f"后台输入已就绪, hwnd=0x{hwnd:x}")
    return True


def _teardown_background_input() -> None:
    """拆卸后台输入会话，恢复焦点。"""
    if STATE.bg_session is None:
        return
    STATE.bg_session.detach()
    STATE.bg_session = None
    logger.info("后台输入已拆卸")


def _resolve_target_hwnd() -> int | None:
    """获取目标窗口句柄，优先用缓存，失效时重新查找。用于后台演奏模式。"""
    if STATE.target_hwnd is not None and is_window_alive(STATE.target_hwnd):
        return STATE.target_hwnd

    hwnd = find_window_for_process(STATE.target_process)
    STATE.target_hwnd = hwnd
    if hwnd:
        logger.info(f"后台演奏窗口已定位: hwnd=0x{hwnd:x}, target={STATE.target_process}")
    else:
        logger.warning(f"后台演奏窗口未找到: target={STATE.target_process}")
    return hwnd


def _create_play_callbacks(ws: WebSocket | None = None, with_logging: bool = False):
    """创建播放回调函数（统一入口）。

    前台模式 (sendinput): SendInput，检查前台窗口匹配
    后台模式 (message):   SendInput + AttachThreadInput + 焦点验证，不检查前台
    """
    # 后台模式焦点保护：每 N ms 验证一次焦点
    _last_focus_check: float = 0.0
    _focus_check_interval: float = 0.5  # 500ms 检查一次

    def _emit(e: Any) -> None:
        nonlocal _last_focus_check
        key = str(getattr(e, "key", ""))
        event_type = getattr(e, "type", None)
        latency = STATE.config.link_latency_ms
        input_mode = getattr(STATE.config, "input_mode", "sendinput")

        if input_mode == "sendinput":
            if not foreground_matches(STATE.target_process):
                if with_logging:
                    fg = foreground_info()
                    logger.debug(
                        f"前台进程不匹配: target={STATE.target_process}, foreground_pid={fg.get('pid')}, foreground_name={fg.get('name')}"
                    )
                return
            result = send_key(key, event_type == "down", latency)
        else:
            # 后台模式：线程已附加 + 焦点已设置，直接用 SendInput
            if STATE.bg_session is None:
                if with_logging:
                    logger.warning("后台输入会话未建立，无法发送按键")
                return

            # 按键按下前验证焦点（防止焦点漂移到其他窗口导致全局发送）
            if event_type == "down":
                now = time.perf_counter()
                if now - _last_focus_check >= _focus_check_interval:
                    if not STATE.bg_session.ensure_focus():
                        if with_logging:
                            logger.warning("后台输入焦点丢失且无法恢复，停止发送按键")
                        return
                    _last_focus_check = now

            result = send_key(key, event_type == "down", latency)

        if event_type == "down":
            if with_logging:
                logger.debug(f"发送按键: {key} down, 模式: {input_mode}, 延迟: {latency}ms")
            if not result and with_logging:
                logger.warning(f"按键发送失败: {key}")
        elif event_type == "up":
            if with_logging:
                logger.debug(f"发送按键: {key} up, 模式: {input_mode}, 延迟: {latency}ms")
            if not result and with_logging:
                logger.warning(f"按键发送失败: {key}")

    def _progress(cursor_ms: int, percent: float) -> None:
        target_ws = ws or STATE.ws
        if target_ws:
            _send(target_ws, {"type": "progress", "cursor_ms": cursor_ms, "percent": percent})

    def _active_keys(keys: set[str]) -> None:
        target_ws = ws or STATE.ws
        if target_ws:
            _send(target_ws, {"type": "active_keys", "keys": list(keys)})

    return _emit, _progress, _active_keys


class AppState:
    def __init__(self) -> None:
        logger.info("AppState init: loading game profiles")
        self.game_profiles = GameProfileManager()
        logger.info("AppState init: selecting default game profile")
        default_profile = self.game_profiles.get_default_profile()
        self.active_game_profile_id = default_profile.profile_id
        self.config = default_profile.to_mapping_config()
        logger.info("AppState init: creating engine")
        self.engine = Engine()
        self.midi_path: str | None = None
        self.target_process: str | None = None
        self.target_hwnd: int | None = None  # 缓存的目标窗口句柄（后台演奏用）
        self.bg_session: BackgroundInputSession | None = None  # 后台输入会话
        logger.info("AppState init: creating hotkey manager")
        self.hotkey_manager = HotkeyManager()
        self.ws: WebSocket | None = None
        self.midi_notes: list[int] = []
        self.loop: asyncio.AbstractEventLoop | None = None
        logger.info("AppState init: creating library manager")
        self.library = LibraryManager()
        self.library_scan_task: asyncio.Task | None = None
        self.library_scan_cancel: asyncio.Event = asyncio.Event()
        logger.info("AppState init complete")


STATE = AppState()


def _status_payload() -> dict[str, Any]:
    active_profile = STATE.game_profiles.get_profile(STATE.active_game_profile_id)
    admin = is_admin()
    return {
        "type": "status",
        "status": STATE.engine.status,
        "is_admin": admin,
        "config": {
            "transpose_semitones": STATE.config.transpose_semitones,
            "speed": STATE.config.speed,
            "max_polyphony": STATE.config.max_polyphony,
            "chord_mode": STATE.config.chord_mode,
            "keep_melody_top_note": STATE.config.keep_melody_top_note,
            "chord_cluster_window_ms": STATE.config.chord_cluster_window_ms,
            "instrument": getattr(STATE.config, "instrument", "piano"),
            "input_mode": getattr(STATE.config, "input_mode", "sendinput"),
            "midi_channel_filter": getattr(STATE.config, "midi_channel_filter", None),
            "note_range_low": STATE.config.note_range_low,
            "note_range_high": STATE.config.note_range_high,
            "prefer_nearest_white": STATE.config.prefer_nearest_white,
            "auto_transpose": STATE.config.auto_transpose,
            "link_latency_ms": STATE.config.link_latency_ms,
        },
        "game_profile": active_profile.to_dict(),
    }


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.websocket("/ws")
async def ws_endpoint(ws: WebSocket) -> None:
    await ws.accept()
    STATE.ws = ws
    if STATE.loop is None:
        try:
            STATE.loop = asyncio.get_running_loop()
        except RuntimeError:
            STATE.loop = None

    logger.info("WebSocket connected")

    def _call_in_loop(fn: callable) -> None:
        loop = getattr(STATE, "loop", None)
        if loop and getattr(loop, "is_running", lambda: False)():
            loop.call_soon_threadsafe(fn)
        else:
            fn()

    # 先发送初始状态，不注册热键
    try:
        await ws.send_text(
            json.dumps(
                {
                    "type": "status",
                    "status": "idle",
                    "hotkeys_enabled": False,
                    "is_admin": is_admin(),
                }
            )
        )
    except Exception as e:
        logger.error(f"发送初始状态失败: {e}")
        return

    # 注册热键（可能失败，但不影响连接）
    def _hotkey_play_pause() -> None:
        def _do() -> None:
            if STATE.engine.status == "playing":
                STATE.engine.pause()
                _teardown_background_input()
            elif STATE.engine.status in ("loaded", "paused", "stopped"):
                if getattr(STATE.config, "input_mode", "sendinput") == "message":
                    _setup_background_input()

                _emit, _progress, _active_keys = _create_play_callbacks()

                def _on_play_complete() -> None:
                    _teardown_background_input()
                    if STATE.ws:
                        _send(STATE.ws, {"type": "status", "status": STATE.engine.status})

                STATE.engine.play(send=_emit, on_progress=_progress, on_active_keys=_active_keys, on_stop=_on_play_complete)

            if STATE.ws:
                _send(STATE.ws, {"type": "status", "status": STATE.engine.status})

        _call_in_loop(_do)

    def _hotkey_stop() -> None:
        def _do() -> None:
            STATE.engine.stop()
            _teardown_background_input()
            if STATE.ws:
                _send(STATE.ws, {"type": "status", "status": STATE.engine.status})

        _call_in_loop(_do)

    # 尝试注册热键（在后台线程中，不阻塞 WebSocket）
    hotkey_enabled = False
    try:
        hotkey_enabled = STATE.hotkey_manager.register(
            on_play_pause=_hotkey_play_pause,
            on_stop=_hotkey_stop,
        )
        if hotkey_enabled:
            # 更新热键状态
            await ws.send_text(
                json.dumps(
                    {
                        "type": "status",
                        "status": "idle",
                        "hotkeys_enabled": True,
                    }
                )
            )
    except Exception as e:
        logger.error(f"注册热键失败: {e}")

    try:
        while True:
            msg = await ws.receive_text()
            data: dict[str, Any] = json.loads(msg)
            msg_type = data.get("type")

            logger.info(f"WS message received: type={msg_type}")

            if msg_type == "ping":
                await ws.send_text(json.dumps({"type": "pong"}))
            elif msg_type == "get_game_profiles":
                await ws.send_text(
                    json.dumps(
                        {
                            "type": "game_profiles",
                            "profiles": [profile.to_dict() for profile in STATE.game_profiles.list_profiles()],
                            "active_profile_id": STATE.active_game_profile_id,
                        }
                    )
                )
            elif msg_type == "set_game_profile":
                profile_id = str(data.get("profile_id") or "").strip()
                if not profile_id:
                    await ws.send_text(json.dumps({"type": "error", "message": "缺少游戏配置 ID"}))
                    continue

                try:
                    profile = STATE.game_profiles.get_profile(profile_id)
                except KeyError:
                    await ws.send_text(json.dumps({"type": "error", "message": f"未找到游戏配置: {profile_id}"}))
                    continue

                STATE.active_game_profile_id = profile.profile_id
                STATE.config = profile.to_mapping_config()

                if STATE.midi_path:
                    parsed = parse_midi_file(STATE.midi_path)
                    STATE.engine.load(parsed, STATE.config)

                payload = _status_payload()
                if STATE.midi_notes and getattr(STATE.config, "instrument", "piano") != "drums":
                    final_ratio = _calculate_config_fit_ratio(STATE.midi_notes, STATE.config)
                    payload["midi"] = {"white_key_ratio": round(final_ratio * 100, 1)}

                await ws.send_text(json.dumps(payload))
            elif msg_type == "set_config":
                cfg = data.get("config") or {}
                logger.info(f"收到 set_config: {cfg}")
                old_transpose = STATE.config.transpose_semitones
                old_key_map = STATE.config.custom_key_map
                old_instrument = getattr(STATE.config, "instrument", "piano")
                old_channel_filter = getattr(STATE.config, "midi_channel_filter", None)
                old_note_range_low = STATE.config.note_range_low
                old_note_range_high = STATE.config.note_range_high
                old_prefer_nearest_white = STATE.config.prefer_nearest_white
                
                update_kwargs: dict[str, Any] = {}

                # 注意：仅当字段“显式出现”时才更新，避免前端发送不完整 set_config 导致配置回退
                if "instrument" in cfg:
                    update_kwargs["instrument"] = str(cfg.get("instrument") or "piano")

                if "midi_channel_filter" in cfg:
                    raw = cfg.get("midi_channel_filter", None)
                    if raw is None:
                        update_kwargs["midi_channel_filter"] = None
                    else:
                        s = str(raw).strip()
                        update_kwargs["midi_channel_filter"] = int(s) if s != "" else None

                if "input_mode" in cfg:
                    raw_mode = str(cfg.get("input_mode") or "sendinput").strip().lower()
                    update_kwargs["input_mode"] = raw_mode if raw_mode in ("sendinput", "message") else "sendinput"

                if "note_range_low" in cfg:
                    update_kwargs["note_range_low"] = int(cfg.get("note_range_low") or 48)

                if "note_range_high" in cfg:
                    update_kwargs["note_range_high"] = int(cfg.get("note_range_high") or 83)

                if "prefer_nearest_white" in cfg:
                    update_kwargs["prefer_nearest_white"] = bool(cfg.get("prefer_nearest_white"))

                if "custom_key_map" in cfg:
                    raw_map = cfg.get("custom_key_map")
                    if raw_map is None:
                        # 显式传 null 表示回退到默认映射
                        update_kwargs["custom_key_map"] = None
                    elif raw_map:
                        update_kwargs["custom_key_map"] = {int(k): str(v) for k, v in raw_map.items()}
                    else:
                        # 显式传空对象表示“不映射任何键”（全静音）
                        update_kwargs["custom_key_map"] = {}

                if "transpose_semitones" in cfg:
                    update_kwargs["transpose_semitones"] = int(cfg.get("transpose_semitones") or 0)
                if "speed" in cfg:
                    update_kwargs["speed"] = float(cfg.get("speed") or 1.0)
                if "max_polyphony" in cfg:
                    update_kwargs["max_polyphony"] = int(cfg.get("max_polyphony") or 10)
                if "chord_mode" in cfg:
                    update_kwargs["chord_mode"] = str(cfg.get("chord_mode") or "prefer")
                if "keep_melody_top_note" in cfg:
                    update_kwargs["keep_melody_top_note"] = bool(cfg.get("keep_melody_top_note"))
                if "chord_cluster_window_ms" in cfg:
                    update_kwargs["chord_cluster_window_ms"] = int(cfg.get("chord_cluster_window_ms") or 40)
                if "auto_transpose" in cfg:
                    update_kwargs["auto_transpose"] = bool(cfg.get("auto_transpose"))
                if "link_latency_ms" in cfg:
                    update_kwargs["link_latency_ms"] = int(cfg.get("link_latency_ms") or 0)

                # 使用统一的配置更新函数
                STATE.config = _update_config(**update_kwargs)
                logger.info(f"更新后配置: auto_transpose={STATE.config.auto_transpose}, chord_mode={STATE.config.chord_mode}")
                
                # 如果移调改变或键位映射改变且 MIDI 已加载，重新生成事件
                transpose_changed = STATE.config.transpose_semitones != old_transpose
                if "custom_key_map" in update_kwargs:
                    key_map_changed = STATE.config.custom_key_map != old_key_map
                else:
                    key_map_changed = False
                instrument_changed = getattr(STATE.config, "instrument", "piano") != old_instrument
                channel_changed = getattr(STATE.config, "midi_channel_filter", None) != old_channel_filter
                range_changed = (
                    STATE.config.note_range_low != old_note_range_low
                    or STATE.config.note_range_high != old_note_range_high
                )
                white_rule_changed = STATE.config.prefer_nearest_white != old_prefer_nearest_white
                if (
                    transpose_changed
                    or key_map_changed
                    or instrument_changed
                    or channel_changed
                    or range_changed
                    or white_rule_changed
                ) and STATE.midi_path:
                    try:
                        parsed = parse_midi_file(STATE.midi_path)
                        STATE.engine.load(parsed, STATE.config)
                        logger.info(
                            "配置改变，已重新加载 MIDI "
                            f"(transpose_changed={transpose_changed}, key_map_changed={key_map_changed}, "
                            f"instrument_changed={instrument_changed}, channel_changed={channel_changed}, "
                            f"range_changed={range_changed}, white_rule_changed={white_rule_changed})"
                        )
                    except Exception as e:
                        logger.error(f"重新加载 MIDI 失败: {e}")
                
                response = _status_payload()
                
                # 如果移调改变，返回新的白键率
                if transpose_changed and STATE.midi_notes and getattr(STATE.config, "instrument", "piano") != "drums":
                    final_ratio = _calculate_config_fit_ratio(STATE.midi_notes, STATE.config)
                    response["midi"] = {"white_key_ratio": round(final_ratio * 100, 1)}
                
                await ws.send_text(json.dumps(response))
            elif msg_type == "load_midi":
                try:
                    midi_path = str(data.get("path") or "")
                    if not midi_path:
                        await ws.send_text(
                            json.dumps(
                                {
                                    "type": "error",
                                    "message": "MIDI文件路径不能为空",
                                }
                            )
                        )
                        continue
                    
                    # 使用统一的加载函数
                    load_result = _load_midi_with_auto_transpose(midi_path)
                    parsed = load_result["parsed"]
                    final_ratio = load_result["final_ratio"]
                    auto_transpose_result = load_result["auto_transpose_result"]
                    
                    response = _status_payload()
                    response["midi"] = {
                        "path": midi_path,
                        "duration_ms": parsed.duration_ms,
                        "notes": len(parsed.notes),
                        "events": len(STATE.engine.events),
                        "white_key_ratio": round(final_ratio * 100, 1) if getattr(STATE.config, "instrument", "piano") != "drums" else None,
                    }
                    
                    if auto_transpose_result is not None:
                        response["auto_transpose"] = auto_transpose_result
                        response["original_white_key_ratio"] = round(load_result["original_ratio"] * 100, 1)
                    
                    await ws.send_text(json.dumps(response))
                    _send(
                        ws,
                        {
                            "type": "events_preview",
                            "events": STATE.engine.preview(limit=200),
                        },
                    )
                except Exception as e:
                    logger.error(f"加载MIDI失败: {e}")
                    await ws.send_text(
                        json.dumps(
                            {
                                "type": "error",
                                "message": f"加载MIDI文件失败: {str(e)}",
                            }
                        )
                    )
            elif msg_type == "get_preview":
                limit = int(data.get("limit") or 200)
                _send(
                    ws,
                    {
                        "type": "events_preview",
                        "events": STATE.engine.preview(limit=limit),
                    },
                )
            elif msg_type == "calc_white_key_ratio":
                # 实时计算给定移调后的当前游戏适配率
                try:
                    transpose = int(data.get("transpose") or 0)
                    if STATE.midi_notes:
                        ratio = _calculate_config_fit_ratio(STATE.midi_notes, STATE.config, transpose)
                        await ws.send_text(
                            json.dumps(
                                {
                                    "type": "white_key_ratio",
                                    "transpose": transpose,
                                    "ratio": round(ratio * 100, 1),
                                }
                            )
                        )
                except Exception as e:
                    logger.error(f"计算白键率失败: {e}")
            elif msg_type == "auto_transpose":
                # 手动触发自动移调
                try:
                    if STATE.midi_notes:
                        optimal = find_optimal_transpose_for_config(STATE.midi_notes, STATE.config)
                        
                        # 总是更新配置（即使 optimal 为 0）
                        old_transpose = STATE.config.transpose_semitones
                        STATE.config = _update_config(
                            transpose_semitones=optimal,
                            auto_transpose=True,
                        )
                        
                        # 重新加载 MIDI 应用新移调
                        if STATE.midi_path:
                            parsed = parse_midi_file(STATE.midi_path)
                            STATE.engine.load(parsed, STATE.config)
                        
                        original_ratio = _calculate_config_fit_ratio(STATE.midi_notes, STATE.config, 0)
                        final_ratio = _calculate_config_fit_ratio(STATE.midi_notes, STATE.config, optimal)
                        
                        await ws.send_text(
                            json.dumps(
                                {
                                    "type": "status",
                                    "status": STATE.engine.status,
                                    "config": {
                                        "transpose_semitones": STATE.config.transpose_semitones,
                                        "speed": STATE.config.speed,
                                        "max_polyphony": STATE.config.max_polyphony,
                                        "chord_mode": STATE.config.chord_mode,
                                        "auto_transpose": STATE.config.auto_transpose,
                                        "note_range_low": STATE.config.note_range_low,
                                        "note_range_high": STATE.config.note_range_high,
                                        "prefer_nearest_white": STATE.config.prefer_nearest_white,
                                        "link_latency_ms": STATE.config.link_latency_ms,
                                    },
                                    "auto_transpose": optimal,
                                    "original_white_key_ratio": round(original_ratio * 100, 1),
                                    "midi": {
                                        "white_key_ratio": round(final_ratio * 100, 1),
                                    },
                                    "game_profile": STATE.game_profiles.get_profile(STATE.active_game_profile_id).to_dict(),
                                }
                            )
                        )
                        
                        if optimal != 0:
                            logger.info(f"手动自动移调: {optimal} 半音, 白键率: {original_ratio:.1%} -> {final_ratio:.1%}")
                        else:
                            logger.info(f"手动自动移调: 当前移调已是最优 (0), 白键率: {final_ratio:.1%}")
                except Exception as e:
                    logger.error(f"自动移调失败: {e}")
            elif msg_type == "bind_process":
                STATE.target_process = str(data.get("process") or "") or None
                if STATE.target_process:
                    logger.info(f"绑定进程: {STATE.target_process}")
                    # 立即解析并缓存窗口句柄（后台演奏需要）
                    STATE.target_hwnd = find_window_for_process(STATE.target_process)
                    if STATE.target_hwnd:
                        logger.info(f"后台演奏窗口已缓存: hwnd=0x{STATE.target_hwnd:x}")
                    else:
                        logger.warning(f"后台演奏窗口未找到，播放时将重试: target={STATE.target_process}")
                else:
                    logger.info(f"解除绑定进程")
                    STATE.target_hwnd = None
                    _teardown_background_input()
                await ws.send_text(
                    json.dumps(
                        {
                            "type": "status",
                            "status": STATE.engine.status,
                            "bind": {"process": STATE.target_process},
                        }
                    )
                )
            elif msg_type == "list_windows":
                try:
                    windows = list_visible_windows()
                    await ws.send_text(
                        json.dumps(
                            {
                                "type": "windows_list",
                                "windows": windows,
                            }
                        )
                    )
                except Exception as e:
                    logger.error(f"获取窗口列表失败: {e}")
                    await ws.send_text(
                        json.dumps(
                            {
                                "type": "error",
                                "message": f"获取窗口列表失败: {str(e)}",
                            }
                        )
                    )
            elif msg_type == "check_admin":
                await ws.send_text(
                    json.dumps(
                        {
                            "type": "admin_status",
                            "is_admin": is_admin(),
                        }
                    )
                )
            elif msg_type == "sync_ntp":
                try:
                    result = sync_with_ntp()
                    if result is not None:
                        ntp_time, offset_ms, server = result
                        await ws.send_text(
                            json.dumps(
                                {
                                    "type": "ntp_sync",
                                    "success": True,
                                    "ntp_time": ntp_time,
                                    "offset_ms": round(offset_ms, 2),
                                    "server": server,
                                }
                            )
                        )
                    else:
                        await ws.send_text(
                            json.dumps(
                                {
                                    "type": "ntp_sync",
                                    "success": False,
                                    "message": "NTP 同步失败",
                                }
                            )
                        )
                except Exception as e:
                    logger.error(f"NTP 同步异常: {e}")
                    await ws.send_text(
                        json.dumps(
                            {
                                "type": "ntp_sync",
                                "success": False,
                                "message": str(e),
                            }
                        )
                    )
            elif msg_type == "measure_ntp_latency":
                try:
                    loop = asyncio.get_event_loop()
                    latency_ms, server = await loop.run_in_executor(None, measure_network_latency)
                    logger.info(f"发送延迟测量结果: {latency_ms}ms @ {server}")
                    await ws.send_text(
                        json.dumps(
                            {
                                "type": "ntp_latency",
                                "latency_ms": round(latency_ms, 2),
                                "server": server,
                            }
                        )
                    )
                except Exception as e:
                    logger.error(f"网络延迟测量异常: {e}")
                    await ws.send_text(
                        json.dumps(
                            {
                                "type": "ntp_latency",
                                "latency_ms": 0,
                                "server": "",
                                "error": str(e),
                            }
                        )
                    )
            elif msg_type == "play":
                logger.info(f"开始播放，目标进程: {STATE.target_process}")

                # 后台模式：设置 AttachThreadInput + SetFocus
                if getattr(STATE.config, "input_mode", "sendinput") == "message":
                    if not _setup_background_input():
                        await ws.send_text(json.dumps({
                            "type": "error",
                            "message": (
                                "后台演奏设置失败。请检查：\n"
                                "1. 是否已绑定正确的游戏进程\n"
                                "2. 游戏窗口是否存在\n"
                                "3. 程序是否以管理员权限运行（某些游戏需要）"
                            ),
                        }))
                        continue

                _emit, _progress, _active_keys = _create_play_callbacks(ws, with_logging=True)

                # 播放自然结束时自动拆卸后台输入
                def _on_play_complete() -> None:
                    _teardown_background_input()
                    if STATE.ws:
                        _send(STATE.ws, {"type": "status", "status": STATE.engine.status})

                STATE.engine.play(send=_emit, on_progress=_progress, on_active_keys=_active_keys, on_stop=_on_play_complete)
                await ws.send_text(json.dumps({"type": "status", "status": STATE.engine.status}))
            elif msg_type == "pause":
                STATE.engine.pause()
                _teardown_background_input()
                await ws.send_text(json.dumps({"type": "status", "status": STATE.engine.status}))
            elif msg_type == "stop":
                STATE.engine.stop()
                _teardown_background_input()
                await ws.send_text(json.dumps({"type": "status", "status": STATE.engine.status}))
            
            # 日志导出
            elif msg_type == "export_logs":
                try:
                    output_path = str(data.get("output_path", ""))
                    if not output_path:
                        await ws.send_text(json.dumps({
                            "type": "export_logs_result",
                            "success": False,
                            "message": "未指定输出路径",
                        }))
                        continue
                    
                    # 使用工作目录计算日志文件路径（更可靠）
                    import sys
                    if getattr(sys, 'frozen', False):
                        # 打包后的可执行文件
                        base_dir = os.path.dirname(sys.executable)
                    else:
                        # 开发环境，使用工作目录
                        base_dir = os.getcwd()
                    
                    log_path = os.path.abspath(_BACKEND_LOG_PATH)
                    
                    logger.info(f"[Logs] 尝试导出日志，路径：{log_path}")
                    
                    if not os.path.exists(log_path):
                        logger.warning(f"[Logs] 日志文件不存在：{log_path}")
                        await ws.send_text(json.dumps({
                            "type": "export_logs_result",
                            "success": False,
                            "message": f"日志文件不存在：{log_path}",
                        }))
                        continue
                    
                    # 复制日志文件到指定位置
                    import shutil
                    shutil.copy2(log_path, output_path)
                    
                    logger.info(f"[Logs] 日志已导出到：{output_path}")
                    await ws.send_text(json.dumps({
                        "type": "export_logs_result",
                        "success": True,
                        "message": f"日志已导出到：{output_path}",
                    }))
                except Exception as e:
                    logger.error(f"[Logs] 导出失败：{e}")
                    await ws.send_text(json.dumps({
                        "type": "export_logs_result",
                        "success": False,
                        "message": f"导出失败：{str(e)}",
                    }))
            
            # 曲库管理
            elif msg_type == "library_get_all":
                # 兼容旧前端：只返回第一页，避免一次性返回2万条导致 UI 卡顿
                entries = STATE.library.get_page(offset=0, limit=200)
                total = STATE.library.count()
                await ws.send_text(json.dumps({
                    "type": "library_list_page",
                    "entries": [e.to_dict() for e in entries],
                    "folders": STATE.library.get_folders(),
                    "total": total,
                    "offset": 0,
                    "limit": 200,
                }))

            elif msg_type == "library_get_page":
                try:
                    offset = int(data.get("offset") or 0)
                    limit = int(data.get("limit") or 200)
                    folder = str(data.get("folder") or "").strip() or None
                    query = str(data.get("query") or "").strip() or None

                    entries = STATE.library.get_page(offset=offset, limit=limit, folder=folder, query=query)
                    total = STATE.library.count(folder=folder, query=query)
                    await ws.send_text(json.dumps({
                        "type": "library_list_page",
                        "entries": [e.to_dict() for e in entries],
                        "folders": STATE.library.get_folders(),
                        "total": total,
                        "offset": offset,
                        "limit": limit,
                        "folder": folder or "",
                        "query": query or "",
                    }))
                except Exception as e:
                    logger.error(f"[Library] 分页获取失败: {e}")
                    await ws.send_text(json.dumps({
                        "type": "error",
                        "message": f"曲库分页获取失败: {str(e)}",
                    }))
            
            elif msg_type == "library_get_folders":
                await ws.send_text(json.dumps({
                    "type": "library_folders",
                    "folders": STATE.library.get_folders(),
                }))
            
            elif msg_type == "library_scan_folder":
                folder_path = str(data.get("path", ""))
                logger.info(f"[Library] 收到扫描请求: {folder_path}")

                # 如果已有扫描在进行，先取消
                if STATE.library_scan_task and not STATE.library_scan_task.done():
                    STATE.library_scan_cancel.set()
                    STATE.library_scan_task.cancel()
                    STATE.library_scan_task = None

                STATE.library_scan_cancel = asyncio.Event()

                if not folder_path or not os.path.isdir(folder_path):
                    logger.warning(f"[Library] 文件夹不存在: {folder_path}")
                    await ws.send_text(json.dumps({
                        "type": "library_scan_result",
                        "success": False,
                        "message": "文件夹不存在或路径无效",
                    }))
                    continue
                
                # 发送开始扫描消息
                await ws.send_text(json.dumps({
                    "type": "library_scan_progress",
                    "total": 0,
                    "current": 0,
                    "added_count": 0,
                }))
                
                # 定义进度回调
                def on_progress(current: int, total: int, name: str, added_count: int):
                    if STATE.ws:
                        _send(STATE.ws, {
                            "type": "library_scan_progress",
                            "current": current,
                            "total": total,
                            "name": name,
                            "added_count": added_count,
                        })

                # 后台扫描：避免阻塞 WebSocket 消息循环导致连接不稳定
                async def _do_scan(target_ws: WebSocket | None) -> None:
                    try:
                        added_entries = await STATE.library.scan_folder(folder_path, on_progress, cancel_event=STATE.library_scan_cancel)
                        _send(target_ws, {
                            "type": "library_scan_result",
                            "success": True,
                            "added_count": len(added_entries),
                            "message": f"扫描完成，新增 {len(added_entries)} 个曲目",
                        })
                    except Exception as e:
                        logger.error(f"[Library] 扫描异常: {e}")
                        _send(target_ws, {
                            "type": "library_scan_result",
                            "success": False,
                            "added_count": 0,
                            "entries": [],
                            "message": f"扫描失败: {str(e)}",
                        })

                task = asyncio.create_task(_do_scan(STATE.ws))
                STATE.library_scan_task = task
                continue

            elif msg_type == "library_scan_cancel":
                if STATE.library_scan_task and not STATE.library_scan_task.done():
                    logger.info("[Library] 收到取消扫描请求")
                    STATE.library_scan_cancel.set()
                    STATE.library_scan_task.cancel()
                    STATE.library_scan_task = None
                    await ws.send_text(json.dumps({
                        "type": "library_scan_result",
                        "success": False,
                        "added_count": 0,
                        "message": "已取消扫描",
                    }))
                else:
                    await ws.send_text(json.dumps({
                        "type": "library_scan_result",
                        "success": False,
                        "added_count": 0,
                        "message": "当前没有正在进行的扫描",
                    }))
                continue
            
            elif msg_type == "library_add":
                path = str(data.get("path", ""))
                name = str(data.get("name", os.path.splitext(os.path.basename(path))[0]))
                folder = str(data.get("folder", "默认"))
                
                if not path or not os.path.isfile(path):
                    await ws.send_text(json.dumps({
                        "type": "error",
                        "message": "文件不存在",
                    }))
                    continue
                
                # 解析 MIDI 文件获取信息
                try:
                    parsed = parse_midi_file(path)
                    entry = STATE.library.add(
                        path=path,
                        name=name,
                        folder=folder,
                        duration_ms=parsed.duration_ms,
                        notes=len(parsed.notes),
                    )
                    await ws.send_text(json.dumps({
                        "type": "library_entry_added",
                        "entry": entry.to_dict(),
                    }))
                except Exception as e:
                    await ws.send_text(json.dumps({
                        "type": "error",
                        "message": f"添加失败: {str(e)}",
                    }))
            
            elif msg_type == "library_update":
                entry_id = str(data.get("id", ""))
                if not entry_id:
                    await ws.send_text(json.dumps({
                        "type": "error",
                        "message": "缺少条目 ID",
                    }))
                    continue
                
                updates = {k: v for k, v in data.items() if k not in ["type", "id"]}
                entry = STATE.library.update(entry_id, **updates)
                
                if entry:
                    await ws.send_text(json.dumps({
                        "type": "library_entry_updated",
                        "entry": entry.to_dict(),
                    }))
                else:
                    await ws.send_text(json.dumps({
                        "type": "error",
                        "message": "条目不存在",
                    }))
            
            elif msg_type == "library_delete":
                entry_id = str(data.get("id", ""))
                if not entry_id:
                    await ws.send_text(json.dumps({
                        "type": "error",
                        "message": "缺少条目 ID",
                    }))
                    continue
                
                success = STATE.library.delete(entry_id)
                await ws.send_text(json.dumps({
                    "type": "library_entry_deleted",
                    "id": entry_id,
                    "success": success,
                }))
            
            elif msg_type == "library_delete_folder":
                folder = str(data.get("folder", ""))
                if not folder:
                    await ws.send_text(json.dumps({
                        "type": "error",
                        "message": "缺少文件夹名称",
                    }))
                    continue
                
                count = STATE.library.delete_by_folder(folder)
                await ws.send_text(json.dumps({
                    "type": "library_folder_deleted",
                    "folder": folder,
                    "deleted_count": count,
                }))
            
            elif msg_type == "library_clear":
                count = STATE.library.clear()
                await ws.send_text(json.dumps({
                    "type": "library_cleared",
                    "deleted_count": count,
                }))
            
            elif msg_type == "library_search":
                query = str(data.get("query", ""))
                entries = STATE.library.search(query)
                await ws.send_text(json.dumps({
                    "type": "library_search_result",
                    "query": query,
                    "entries": [e.to_dict() for e in entries],
                }))
            
            elif msg_type == "check_audio_converter":
                converter = get_converter()
                available = converter.is_available()
                current_path = converter.get_piano_trans_path()
                await ws.send_text(json.dumps({
                    "type": "audio_converter_status",
                    "available": available,
                    "current_path": current_path,
                    "supported_formats": converter.get_supported_formats() if available else [],
                    "message": "PianoTrans 可用" if available else "PianoTrans 未找到"
                }))
            elif msg_type == "set_piano_trans_path":
                path = str(data.get("path") or "")
                if not path:
                    await ws.send_text(json.dumps({
                        "type": "error",
                        "message": "请选择 PianoTrans 目录"
                    }))
                    continue
                
                success, message = set_piano_trans_path(path)
                converter = get_converter()
                await ws.send_text(json.dumps({
                    "type": "piano_trans_path_set",
                    "success": success,
                    "message": message,
                    "current_path": converter.get_piano_trans_path(),
                    "available": converter.is_available()
                }))
            elif msg_type == "convert_audio":
                audio_path = str(data.get("path") or "")
                auto_load = bool(data.get("auto_load", True))
                
                if not audio_path:
                    await ws.send_text(json.dumps({
                        "type": "error",
                        "message": "请选择音频文件"
                    }))
                    continue
                
                if not os.path.exists(audio_path):
                    await ws.send_text(json.dumps({
                        "type": "error",
                        "message": f"音频文件不存在: {audio_path}"
                    }))
                    continue
                
                # 定义进度回调函数，保持连接活跃
                def on_progress(progress_msg: str) -> None:
                    if STATE.ws:
                        asyncio.create_task(STATE.ws.send_text(json.dumps({
                            "type": "audio_conversion_status",
                            "status": "converting",
                            "message": progress_msg
                        })))
                
                # 发送转换开始消息
                await ws.send_text(json.dumps({
                    "type": "audio_conversion_status",
                    "status": "converting",
                    "message": "正在启动 PianoTrans..."
                }))
                
                # 执行转换
                success, message, midi_path = await convert_audio_to_midi(audio_path, on_progress=on_progress)
                
                if success and midi_path:
                    # 自动加载转换后的 MIDI
                    if auto_load:
                        try:
                            # 使用统一的加载函数（包含自动移调处理）
                            load_result = _load_midi_with_auto_transpose(midi_path)
                            parsed = load_result["parsed"]
                            
                            response_data = {
                                "type": "audio_conversion_status",
                                "status": "completed",
                                "midi_path": midi_path,
                                "message": message,
                                "auto_loaded": True,
                                "midi_info": {
                                    "duration_ms": parsed.duration_ms,
                                    "notes": len(parsed.notes),
                                    "events": len(STATE.engine.events),
                                    "white_key_ratio": round(load_result["final_ratio"] * 100, 1),
                                },
                                "config": {
                                    "transpose_semitones": STATE.config.transpose_semitones,
                                    "speed": STATE.config.speed,
                                    "max_polyphony": STATE.config.max_polyphony,
                                    "chord_mode": STATE.config.chord_mode,
                                },
                            }
                            
                            if load_result["auto_transpose_result"] is not None:
                                response_data["auto_transpose"] = load_result["auto_transpose_result"]
                                response_data["original_white_key_ratio"] = round(load_result["original_ratio"] * 100, 1)
                            
                            await ws.send_text(json.dumps(response_data))
                            
                            _send(ws, {
                                "type": "events_preview",
                                "events": STATE.engine.preview(limit=200),
                            })
                        except Exception as e:
                            logger.error(f"自动加载 MIDI 失败: {e}")
                            await ws.send_text(json.dumps({
                                "type": "audio_conversion_status",
                                "status": "completed",
                                "midi_path": midi_path,
                                "message": f"{message}（自动加载失败: {str(e)}）",
                                "auto_loaded": False
                            }))
                    else:
                        await ws.send_text(json.dumps({
                            "type": "audio_conversion_status",
                            "status": "completed",
                            "midi_path": midi_path,
                            "message": message,
                            "auto_loaded": False
                        }))
                else:
                    await ws.send_text(json.dumps({
                        "type": "audio_conversion_status",
                        "status": "failed",
                        "message": message
                    }))
            else:
                await ws.send_text(
                    json.dumps(
                        {
                            "type": "log",
                            "level": "info",
                            "message": f"unhandled message type: {msg_type}",
                        }
                    )
                )

            await asyncio.sleep(0)
    except WebSocketDisconnect:
        STATE.ws = None
        STATE.hotkey_manager.unregister()
        return
    except Exception as e:
        logger.error(f"WebSocket handler crashed: {e}")
        STATE.ws = None
        try:
            STATE.hotkey_manager.unregister()
        except Exception:
            pass
        return


def main() -> None:
    logger.info("backend main: starting uvicorn")
    config = uvicorn.Config(
        app=app,
        host="127.0.0.1",
        port=18765,
        log_level="info",
        loop="asyncio",
        log_config=None,
        access_log=False,
        use_colors=False,
    )
    server = uvicorn.Server(config)
    server.run()
    logger.info("backend main: uvicorn stopped")


if __name__ == "__main__":
    main()
