from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

from src.mapping.notes import MappingConfig
from src.runtime.paths import get_game_profiles_dir


@dataclass(frozen=True)
class GameProfile:
    profile_id: str
    name: str
    instrument: str = "piano"
    midi_channel_filter: int | None = None
    note_range_low: int = 48
    note_range_high: int = 83
    prefer_nearest_white: bool = True
    transpose_semitones: int = 0
    speed: float = 1.0
    max_polyphony: int = 10
    chord_mode: str = "prefer"
    keep_melody_top_note: bool = True
    chord_cluster_window_ms: int = 40
    auto_transpose: bool = False
    link_latency_ms: int = 0
    custom_key_map: dict[int, str] | None = None

    def to_mapping_config(self) -> MappingConfig:
        return MappingConfig(
            instrument=self.instrument,
            midi_channel_filter=self.midi_channel_filter,
            note_range_low=self.note_range_low,
            note_range_high=self.note_range_high,
            prefer_nearest_white=self.prefer_nearest_white,
            transpose_semitones=self.transpose_semitones,
            speed=self.speed,
            max_polyphony=self.max_polyphony,
            chord_mode=self.chord_mode,
            keep_melody_top_note=self.keep_melody_top_note,
            chord_cluster_window_ms=self.chord_cluster_window_ms,
            auto_transpose=self.auto_transpose,
            link_latency_ms=self.link_latency_ms,
            custom_key_map=self.custom_key_map,
        )

    def to_dict(self) -> dict[str, object]:
        return {
            "id": self.profile_id,
            "name": self.name,
            "instrument": self.instrument,
            "midi_channel_filter": self.midi_channel_filter,
            "note_range_low": self.note_range_low,
            "note_range_high": self.note_range_high,
            "prefer_nearest_white": self.prefer_nearest_white,
            "transpose_semitones": self.transpose_semitones,
            "speed": self.speed,
            "max_polyphony": self.max_polyphony,
            "chord_mode": self.chord_mode,
            "keep_melody_top_note": self.keep_melody_top_note,
            "chord_cluster_window_ms": self.chord_cluster_window_ms,
            "auto_transpose": self.auto_transpose,
            "link_latency_ms": self.link_latency_ms,
            "custom_key_map": self.custom_key_map,
        }


class GameProfileManager:
    def __init__(self, profiles_dir: str | Path | None = None) -> None:
        self.profiles_dir = Path(profiles_dir) if profiles_dir is not None else get_game_profiles_dir()
        self._profiles = self._load_profiles()

    def _load_profiles(self) -> dict[str, GameProfile]:
        profiles: dict[str, GameProfile] = {}
        if not self.profiles_dir.exists():
            return profiles

        for path in sorted(self.profiles_dir.glob("*.json")):
            with path.open("r", encoding="utf-8") as f:
                raw = json.load(f)

            profile_id = str(raw["id"]).strip()
            if not profile_id:
                raise ValueError(f"Profile id is empty: {path}")

            custom_map = raw.get("custom_key_map")
            parsed_map = None if custom_map is None else {int(k): str(v) for k, v in dict(custom_map).items()}

            profiles[profile_id] = GameProfile(
                profile_id=profile_id,
                name=str(raw.get("name") or profile_id),
                instrument=str(raw.get("instrument") or "piano"),
                midi_channel_filter=raw.get("midi_channel_filter"),
                note_range_low=int(raw.get("note_range_low") or 48),
                note_range_high=int(raw.get("note_range_high") or 83),
                prefer_nearest_white=bool(raw.get("prefer_nearest_white", True)),
                transpose_semitones=int(raw.get("transpose_semitones") or 0),
                speed=float(raw.get("speed") or 1.0),
                max_polyphony=int(raw.get("max_polyphony") or 10),
                chord_mode=str(raw.get("chord_mode") or "prefer"),
                keep_melody_top_note=bool(raw.get("keep_melody_top_note", True)),
                chord_cluster_window_ms=int(raw.get("chord_cluster_window_ms") or 40),
                auto_transpose=bool(raw.get("auto_transpose", False)),
                link_latency_ms=int(raw.get("link_latency_ms") or 0),
                custom_key_map=parsed_map,
            )

        return profiles

    def list_profiles(self) -> list[GameProfile]:
        return list(self._profiles.values())

    def get_profile(self, profile_id: str) -> GameProfile:
        profile = self._profiles.get(profile_id)
        if profile is None:
            raise KeyError(profile_id)
        return profile

    def get_default_profile(self) -> GameProfile:
        if not self._profiles:
            raise RuntimeError("No game profiles found")
        preferred_profile = self._profiles.get("open-space-piano")
        if preferred_profile is not None:
            return preferred_profile
        return self.list_profiles()[0]
