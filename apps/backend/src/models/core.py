from __future__ import annotations

from dataclasses import dataclass
from typing import Literal


@dataclass(frozen=True)
class MidiNote:
    start_ms: int
    end_ms: int
    note: int
    velocity: int
    channel: int
    track: int


PlayEventType = Literal["down", "up"]


@dataclass(frozen=True)
class PlayEvent:
    t_ms: int
    type: PlayEventType
    key: str
    source: str
    note: int | None = None
