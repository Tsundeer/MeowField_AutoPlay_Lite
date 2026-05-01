from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass
from typing import Callable

from src.models.core import PlayEvent

from src.mapping.notes import MappingConfig
from src.midi.parser import ParsedMidi
from src.player.events import build_events


@dataclass
class Engine:
    status: str = "idle"
    events: list[PlayEvent] = None  # type: ignore[assignment]
    duration_ms: int = 0
    cursor_ms: int = 0
    _task: asyncio.Task[None] | None = None
    _play_started_at: float | None = None
    _send: Callable[[PlayEvent], None] | None = None
    _on_progress: Callable[[int, float], None] | None = None
    _on_active_keys: Callable[[set[str]], None] | None = None
    _active_keys: set[str] = None  # type: ignore[assignment]
    _on_stop: Callable[[], None] | None = None

    def __post_init__(self) -> None:
        if self.events is None:
            self.events = []
        if self._active_keys is None:
            self._active_keys = set()

    def load(self, parsed: ParsedMidi, config: MappingConfig) -> None:
        self.events = build_events(parsed.notes, config)
        self.duration_ms = parsed.duration_ms
        self.cursor_ms = 0
        self._play_started_at = None
        self._cancel_task()
        self.status = "loaded"

    def play(
        self,
        send: Callable[[PlayEvent], None] | None = None,
        on_progress: Callable[[int, float], None] | None = None,
        on_active_keys: Callable[[set[str]], None] | None = None,
        on_stop: Callable[[], None] | None = None,
    ) -> None:
        if self.status not in ("loaded", "paused", "stopped"):
            return

        if send is not None:
            self._send = send

        if on_progress is not None:
            self._on_progress = on_progress

        if on_active_keys is not None:
            self._on_active_keys = on_active_keys

        if on_stop is not None:
            self._on_stop = on_stop

        if self._send is None:
            return

        if self._task is None or self._task.done():
            self._play_started_at = time.perf_counter() - (self.cursor_ms / 1000.0)
            self._task = asyncio.create_task(self._run())

        self.status = "playing"

    def pause(self) -> None:
        if self.status == "playing":
            if self._play_started_at is not None:
                self.cursor_ms = int((time.perf_counter() - self._play_started_at) * 1000)
            self._cancel_task()
            self.status = "paused"

    def stop(self) -> None:
        if self.status in ("playing", "paused"):
            self._cancel_task()
            self.cursor_ms = 0
            self._play_started_at = None
            self._active_keys.clear()
            if self._on_active_keys:
                self._on_active_keys(self._active_keys.copy())
            self.status = "stopped"

    def _cancel_task(self) -> None:
        if self._task is None:
            return
        if not self._task.done():
            self._task.cancel()
        self._task = None

    async def _run(self) -> None:
        if self._send is None:
            return

        start_at = self._play_started_at
        if start_at is None:
            return

        i = 0
        while i < len(self.events) and self.events[i].t_ms < self.cursor_ms:
            i += 1

        last_progress_report = 0.0

        try:
            while i < len(self.events):
                e = self.events[i]
                due_s = start_at + (e.t_ms / 1000.0)
                now = time.perf_counter()
                sleep_s = due_s - now
                if sleep_s > 0:
                    await asyncio.sleep(sleep_s)

                self._send(e)
                self.cursor_ms = e.t_ms

                # Update active keys
                if e.type == "down":
                    self._active_keys.add(e.key)
                elif e.type == "up":
                    self._active_keys.discard(e.key)

                # Report active keys
                if self._on_active_keys:
                    self._on_active_keys(self._active_keys.copy())

                # Report progress every 100ms
                if self._on_progress and (now - last_progress_report) >= 0.1:
                    progress = (self.cursor_ms / self.duration_ms * 100) if self.duration_ms > 0 else 0
                    self._on_progress(self.cursor_ms, progress)
                    last_progress_report = now

                i += 1

            self.cursor_ms = self.duration_ms
            if self._on_progress:
                self._on_progress(self.cursor_ms, 100.0)
            self._active_keys.clear()
            if self._on_active_keys:
                self._on_active_keys(self._active_keys.copy())
            self.status = "stopped"
            # 播放自然结束，通知外部
            if self._on_stop:
                self._on_stop()
        except asyncio.CancelledError:
            raise

    def preview(self, limit: int = 200) -> list[dict[str, object]]:
        limit = max(0, min(int(limit), 5000))
        out: list[dict[str, object]] = []
        for e in self.events[:limit]:
            out.append(
                {
                    "t_ms": e.t_ms,
                    "type": e.type,
                    "key": e.key,
                    "source": e.source,
                    "note": e.note,
                }
            )
        return out
