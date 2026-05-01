from __future__ import annotations

from dataclasses import dataclass
from enum import Enum


WHITE_PCS = {0, 2, 4, 5, 7, 9, 11}  # C D E F G A B


class ChordMode(Enum):
    """和弦处理模式"""
    OFF = "off"                    # 关闭 - 不做和弦处理
    PREFER = "prefer"              # 优先和弦 - 尽量保持和弦完整
    MELODY = "melody"              # 保留旋律 - 保持最高音（旋律线）
    SMART = "smart"                # 智能分配 - 根据音符密度动态调整


@dataclass(frozen=True)
class HotkeyConfig:
    play_pause: str = "ctrl+shift+c"
    stop: str = "f9"


@dataclass(frozen=True)
class MappingConfig:
    instrument: str = "piano"  # piano | drums | microphone
    input_mode: str = "sendinput"  # sendinput | message
    midi_channel_filter: int | None = None  # e.g. drums default to channel 9 (Channel 10)
    note_range_low: int = 48
    note_range_high: int = 83
    prefer_nearest_white: bool = True
    transpose_semitones: int = 0
    speed: float = 1.0
    max_polyphony: int = 10
    chord_mode: str = "prefer"     # 和弦模式：off, prefer, melody, smart
    keep_melody_top_note: bool = True
    chord_cluster_window_ms: int = 40
    auto_transpose: bool = False
    link_latency_ms: int = 0
    hotkeys: HotkeyConfig = HotkeyConfig()
    custom_key_map: dict[int, str] | None = None  # 自定义键位映射 {note: key}
    
    @property
    def chord_prefer(self) -> bool:
        """向后兼容"""
        return self.chord_mode != "off"
    
    @property
    def is_microphone_mode(self) -> bool:
        """判断是否为麦克风模式"""
        return self.instrument == "microphone"


def apply_transpose(note: int, semitones: int) -> int:
    return note + semitones


def fold_to_range(note: int, low: int = 48, high: int = 83) -> int:
    n = note
    while n < low:
        n += 12
    while n > high:
        n -= 12
    return n


def nearest_white(note: int, low: int = 48, high: int = 83) -> int:
    pc = note % 12
    if pc in WHITE_PCS:
        return note

    down = note - 1
    up = note + 1

    candidates: list[int] = []
    if down >= low and (down % 12) in WHITE_PCS:
        candidates.append(down)
    if up <= high and (up % 12) in WHITE_PCS:
        candidates.append(up)

    if not candidates:
        return max(low, min(high, note))

    if len(candidates) == 1:
        return candidates[0]

    if abs(candidates[0] - note) == abs(candidates[1] - note):
        return min(candidates)

    return min(candidates, key=lambda x: abs(x - note))


def calculate_white_key_ratio(notes: list[int], transpose: int = 0) -> float:
    """
    计算给定移调后的白键比例
    
    参数:
        notes: MIDI音符列表
        transpose: 移调半音数
    
    返回:
        白键比例 (0.0 - 1.0)
    """
    if not notes:
        return 0.0
    
    white_count = 0
    for note in notes:
        transposed = note + transpose
        pc = transposed % 12
        if pc in WHITE_PCS:
            white_count += 1
    
    return white_count / len(notes)


def calculate_range_fit_ratio(
    notes: list[int],
    low: int,
    high: int,
    transpose: int = 0,
) -> float:
    if not notes:
        return 0.0

    in_range = 0
    for note in notes:
        transposed = note + transpose
        if low <= transposed <= high:
            in_range += 1

    return in_range / len(notes)


def find_optimal_transpose(notes: list[int], range_limit: int = 12) -> int:
    """
    找到使白键率最高的移调值
    
    参数:
        notes: MIDI音符列表
        range_limit: 移调范围限制（默认±12半音）
    
    返回:
        最优移调半音数
    """
    if not notes:
        return 0
    
    best_transpose = 0
    best_ratio = calculate_white_key_ratio(notes, 0)
    
    for t in range(-range_limit, range_limit + 1):
        ratio = calculate_white_key_ratio(notes, t)
        if ratio > best_ratio:
            best_ratio = ratio
            best_transpose = t
    
    return best_transpose


def find_optimal_transpose_for_config(notes: list[int], cfg: MappingConfig, range_limit: int = 12) -> int:
    if not notes:
        return 0

    if cfg.prefer_nearest_white:
        return find_optimal_transpose(notes, range_limit=range_limit)

    best_transpose = 0
    best_ratio = calculate_range_fit_ratio(notes, cfg.note_range_low, cfg.note_range_high, 0)

    for t in range(-range_limit, range_limit + 1):
        ratio = calculate_range_fit_ratio(notes, cfg.note_range_low, cfg.note_range_high, t)
        if ratio > best_ratio:
            best_ratio = ratio
            best_transpose = t

    return best_transpose


NOTE_TO_KEY: dict[int, str] = {
    48: "A",
    50: "S",
    52: "D",
    53: "F",
    55: "G",
    57: "H",
    59: "J",
    60: "Q",
    62: "W",
    64: "E",
    65: "R",
    67: "T",
    69: "Y",
    71: "U",
    72: "1",
    74: "2",
    76: "3",
    77: "4",
    79: "5",
    81: "6",
    83: "7",
}


# 麦克风 15 键位映射（从低音到高音，右上角是最高音）
# 布局：
#   第一排（右上角，最高音）：1  2  3  4  5  -> MIDI 70-74 (A#4-D5)
#   第二排（中间，中音）：    Q  W  E  R  T  -> MIDI 65-69 (F4-A4)
#   第三排（左下角，低音）：A  S  D  F  G  -> MIDI 60-64 (C4-E4)
MICROPHONE_KEY_MAP = {
    # 第三排：A-G (MIDI 60-64, C4-E4) - 最低音区
    60: "A",   # C4
    61: "S",   # C#4
    62: "D",   # D4
    63: "F",   # D#4
    64: "G",   # E4
    
    # 第二排：Q-T (MIDI 65-69, F4-A4) - 中音区
    65: "Q",   # F4
    66: "W",   # F#4
    67: "E",   # G4
    68: "R",   # G#4
    69: "T",   # A4
    
    # 第一排：数字键 1-5 (MIDI 70-74, A#4-D5) - 最高音区
    70: "1",   # A#4
    71: "2",   # B4
    72: "3",   # C5
    73: "4",   # C#5
    74: "5",   # D5
}

MICROPHONE_MIN_MIDI = 60  # C4
MICROPHONE_MAX_MIDI = 74  # D5
MICROPHONE_KEY_COUNT = 15
MICROPHONE_KEYS_LOW_TO_HIGH = ["A", "S", "D", "F", "G", "Q", "W", "E", "R", "T", "1", "2", "3", "4", "5"]


def map_note_to_key(note: int, custom_key_map: dict[int, str] | None = None) -> str | None:
    """
    将 MIDI 音符映射到游戏键位
    
    参数:
        note: MIDI 音符编号
        custom_key_map: 自定义键位映射 {note: key}，如果为 None 则使用默认映射
    
    返回:
        游戏键位字符串，如果不在映射范围内返回 None
    """
    if custom_key_map is not None:
        return custom_key_map.get(note)
    return NOTE_TO_KEY.get(note)


def map_note_to_microphone_key(
    note: int,
    transpose: int = 0,
    custom_key_map: dict[int, str] | None = None,
    low: int = MICROPHONE_MIN_MIDI,
    high: int = MICROPHONE_MAX_MIDI,
) -> str | None:
    """
    麦克风模式专用：将 MIDI 音符映射到 15 个键位
    
    映射逻辑：
    1. 应用移调
    2. 如果在 60-74 范围内，直接映射
    3. 如果超出范围，折叠到范围内（八度折叠）
    
    参数:
        note: MIDI 音符编号
        transpose: 移调半音数（可选，默认 0）
    
    返回:
        键位字符串 (A,S,D,F,G,Q,W,E,R,T,1,2,3,4,5)，超出范围返回 None
    """
    # 应用移调
    transposed = note + transpose
    
    # 八度折叠到目标音域
    folded = fold_to_range(transposed, low, high)

    # 映射到键位
    if custom_key_map is not None:
        return custom_key_map.get(folded)

    if high - low + 1 != MICROPHONE_KEY_COUNT:
        return None

    offset = folded - low
    if 0 <= offset < MICROPHONE_KEY_COUNT:
        return MICROPHONE_KEYS_LOW_TO_HIGH[offset]
    return None
