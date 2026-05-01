from __future__ import annotations

import threading
from dataclasses import dataclass
from typing import Callable

try:
    import keyboard
    KEYBOARD_AVAILABLE = True
except ImportError:
    KEYBOARD_AVAILABLE = False


@dataclass
class HotkeyConfig:
    play_pause: str = "ctrl+shift+c"
    stop: str = "f9"


class HotkeyManager:
    def __init__(self) -> None:
        self.enabled = False
        self._lock = threading.Lock()
        self._on_play_pause: Callable[[], None] | None = None
        self._on_stop: Callable[[], None] | None = None
        self.config = HotkeyConfig()

    def register(
        self,
        on_play_pause: Callable[[], None] | None = None,
        on_stop: Callable[[], None] | None = None,
        config: HotkeyConfig | None = None,
    ) -> bool:
        if not KEYBOARD_AVAILABLE:
            return False

        with self._lock:
            if self.enabled:
                return True

            if config is not None:
                self.config = config

            self._on_play_pause = on_play_pause
            self._on_stop = on_stop

            try:
                if on_play_pause:
                    keyboard.add_hotkey(self.config.play_pause, self._handle_play_pause, suppress=False)
                if on_stop:
                    keyboard.add_hotkey(self.config.stop, self._handle_stop, suppress=False)
                self.enabled = True
                return True
            except Exception as e:
                print(f"[Hotkeys] register failed: {e}")
                return False

    def unregister(self) -> None:
        if not KEYBOARD_AVAILABLE:
            return

        with self._lock:
            if not self.enabled:
                return

            try:
                keyboard.unhook_all_hotkeys()
            except Exception:
                pass
            finally:
                self.enabled = False
                self._on_play_pause = None
                self._on_stop = None

    def _handle_play_pause(self) -> None:
        if self._on_play_pause:
            self._on_play_pause()

    def _handle_stop(self) -> None:
        if self._on_stop:
            self._on_stop()

