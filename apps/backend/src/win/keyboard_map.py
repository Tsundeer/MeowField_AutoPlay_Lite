from __future__ import annotations

from dataclasses import dataclass

# 统一维护物理扫描码与虚拟键码，避免不同发送方案各自维护一套键表。
SCAN_CODE_MAP: dict[str, int] = {
    "1": 0x02,
    "2": 0x03,
    "3": 0x04,
    "4": 0x05,
    "5": 0x06,
    "6": 0x07,
    "7": 0x08,
    "8": 0x09,
    "9": 0x0A,
    "0": 0x0B,
    "-": 0x0C,
    "=": 0x0D,
    "Q": 0x10,
    "W": 0x11,
    "E": 0x12,
    "R": 0x13,
    "T": 0x14,
    "Y": 0x15,
    "U": 0x16,
    "I": 0x17,
    "O": 0x18,
    "P": 0x19,
    "[": 0x1A,
    "]": 0x1B,
    "A": 0x1E,
    "S": 0x1F,
    "D": 0x20,
    "F": 0x21,
    "G": 0x22,
    "H": 0x23,
    "J": 0x24,
    "K": 0x25,
    "L": 0x26,
    ";": 0x27,
    "'": 0x28,
    "`": 0x29,
    "\\": 0x2B,
    "Z": 0x2C,
    "X": 0x2D,
    "C": 0x2E,
    "V": 0x2F,
    "B": 0x30,
    "N": 0x31,
    "M": 0x32,
    ",": 0x33,
    ".": 0x34,
    "/": 0x35,
}


VK_CODE_MAP: dict[str, int] = {
    "0": 0x30,
    "1": 0x31,
    "2": 0x32,
    "3": 0x33,
    "4": 0x34,
    "5": 0x35,
    "6": 0x36,
    "7": 0x37,
    "8": 0x38,
    "9": 0x39,
    "A": 0x41,
    "B": 0x42,
    "C": 0x43,
    "D": 0x44,
    "E": 0x45,
    "F": 0x46,
    "G": 0x47,
    "H": 0x48,
    "I": 0x49,
    "J": 0x4A,
    "K": 0x4B,
    "L": 0x4C,
    "M": 0x4D,
    "N": 0x4E,
    "O": 0x4F,
    "P": 0x50,
    "Q": 0x51,
    "R": 0x52,
    "S": 0x53,
    "T": 0x54,
    "U": 0x55,
    "V": 0x56,
    "W": 0x57,
    "X": 0x58,
    "Y": 0x59,
    "Z": 0x5A,
    ";": 0xBA,
    "=": 0xBB,
    ",": 0xBC,
    "-": 0xBD,
    ".": 0xBE,
    "/": 0xBF,
    "`": 0xC0,
    "[": 0xDB,
    "\\": 0xDC,
    "]": 0xDD,
    "'": 0xDE,
}

MODIFIER_SCAN_CODE_MAP: dict[str, int] = {
    "SHIFT": 0x2A,
    "CTRL": 0x1D,
    "ALT": 0x38,
}

MODIFIER_VK_CODE_MAP: dict[str, int] = {
    "SHIFT": 0x10,
    "CTRL": 0x11,
    "ALT": 0x12,
}

MODIFIER_ALIASES: dict[str, str] = {
    "SHIFT": "SHIFT",
    "CTRL": "CTRL",
    "CONTROL": "CTRL",
    "ALT": "ALT",
}


@dataclass(frozen=True)
class ParsedKeyStroke:
    modifiers: tuple[str, ...]
    primary: str


def normalize_key(key: str) -> str:
    return key.strip().upper()


def normalize_modifier(key: str) -> str | None:
    return MODIFIER_ALIASES.get(normalize_key(key))


def parse_key_stroke(key: str) -> ParsedKeyStroke | None:
    normalized = normalize_key(key)
    if not normalized:
        return None

    parts = [part.strip() for part in normalized.split("+") if part.strip()]
    if not parts:
        return None

    modifiers: list[str] = []
    primary: str | None = None

    for part in parts:
        modifier = normalize_modifier(part)
        if modifier is not None:
            if modifier not in modifiers:
                modifiers.append(modifier)
            continue

        if primary is not None:
            return None
        primary = part

    if primary is None:
        return None

    if primary not in SCAN_CODE_MAP:
        return None

    return ParsedKeyStroke(modifiers=tuple(modifiers), primary=primary)
