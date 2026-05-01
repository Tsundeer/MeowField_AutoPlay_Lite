from __future__ import annotations

from collections import defaultdict

from src.chords.detect import detect_chord_key
from src.mapping.notes import (
    MappingConfig,
    apply_transpose,
    fold_to_range,
    map_note_to_key,
    map_note_to_microphone_key,
    nearest_white,
    MICROPHONE_MIN_MIDI,
    MICROPHONE_MAX_MIDI,
)
from src.models.core import MidiNote, PlayEvent


def _normalize_note(note: int, cfg: MappingConfig) -> int:
    n = apply_transpose(note, cfg.transpose_semitones)
    n = fold_to_range(n, cfg.note_range_low, cfg.note_range_high)
    if cfg.prefer_nearest_white:
        n = nearest_white(n, cfg.note_range_low, cfg.note_range_high)
    return n


def build_events(notes: list[MidiNote], cfg: MappingConfig) -> list[PlayEvent]:
    if not notes:
        return []

    # 鼓模式：只处理指定通道（GM 鼓通常为 Channel 10，即 channel==9），且不做白键/折叠处理
    if cfg.instrument == "drums":
        filtered = notes
        if cfg.midi_channel_filter is not None:
            filtered = [n for n in notes if n.channel == cfg.midi_channel_filter]
        if not filtered:
            return []

        scaled: list[MidiNote] = []
        for n in filtered:
            start_ms = int(n.start_ms / cfg.speed)
            end_ms = int(n.end_ms / cfg.speed)
            if end_ms <= start_ms:
                end_ms = start_ms + 1
            scaled.append(
                MidiNote(
                    start_ms=start_ms,
                    end_ms=end_ms,
                    note=n.note,
                    velocity=n.velocity,
                    channel=n.channel,
                    track=n.track,
                )
            )

        events: list[PlayEvent] = []
        for n in scaled:
            key = map_note_to_key(n.note, cfg.custom_key_map)
            if key is None:
                continue
            events.append(PlayEvent(t_ms=n.start_ms, type="down", key=key, source="drum", note=n.note))
            events.append(PlayEvent(t_ms=n.end_ms, type="up", key=key, source="drum", note=n.note))

        events.sort(key=lambda e: (e.t_ms, 0 if e.type == "down" else 1, e.key))
        return events

    # 麦克风模式：使用专用的 15 键位映射，自动折叠音域
    if cfg.is_microphone_mode:
        scaled: list[MidiNote] = []
        for n in notes:
            start_ms = int(n.start_ms / cfg.speed)
            end_ms = int(n.end_ms / cfg.speed)
            if end_ms <= start_ms:
                end_ms = start_ms + 1
            scaled.append(
                MidiNote(
                    start_ms=start_ms,
                    end_ms=end_ms,
                    note=n.note,
                    velocity=n.velocity,
                    channel=n.channel,
                    track=n.track,
                )
            )

        scaled.sort(key=lambda x: (x.start_ms, x.end_ms, -x.note))

        clusters: list[list[MidiNote]] = []
        cur: list[MidiNote] = []
        cur_start = scaled[0].start_ms

        for n in scaled:
            if not cur:
                cur = [n]
                cur_start = n.start_ms
                continue
            if n.start_ms - cur_start <= cfg.chord_cluster_window_ms:
                cur.append(n)
            else:
                clusters.append(cur)
                cur = [n]
                cur_start = n.start_ms
        if cur:
            clusters.append(cur)

        events: list[PlayEvent] = []

        for group in clusters:
            group.sort(key=lambda x: (-x.note, -x.velocity, x.end_ms))

            # 麦克风模式：使用专用映射函数
            per_key_notes: dict[str, list[MidiNote]] = defaultdict(list)
            for n in group:
                key = map_note_to_microphone_key(
                    n.note,
                    cfg.transpose_semitones,
                    cfg.custom_key_map,
                    cfg.note_range_low,
                    cfg.note_range_high,
                )
                if key is None:
                    continue
                per_key_notes[key].append(n)

            key_entries = []
            for key, ns in per_key_notes.items():
                vel = max(x.velocity for x in ns)
                start = min(x.start_ms for x in ns)
                end = max(x.end_ms for x in ns)
                key_entries.append((key, vel, start, end))

            key_entries.sort(key=lambda x: (-x[1], x[2], x[3], x[0]))
            key_entries = key_entries[: max(1, cfg.max_polyphony)]

            for key, _vel, start, end in key_entries:
                events.append(PlayEvent(t_ms=start, type="down", key=key, source="mic"))
                events.append(PlayEvent(t_ms=end, type="up", key=key, source="mic"))

        events.sort(key=lambda e: (e.t_ms, 0 if e.type == "down" else 1, e.key))
        return events

    # 钢琴模式（默认）
    scaled: list[MidiNote] = []
    for n in notes:
        start_ms = int(n.start_ms / cfg.speed)
        end_ms = int(n.end_ms / cfg.speed)
        if end_ms <= start_ms:
            end_ms = start_ms + 1
        scaled.append(
            MidiNote(
                start_ms=start_ms,
                end_ms=end_ms,
                note=n.note,
                velocity=n.velocity,
                channel=n.channel,
                track=n.track,
            )
        )

    scaled.sort(key=lambda x: (x.start_ms, x.end_ms, -x.note))

    clusters: list[list[MidiNote]] = []
    cur: list[MidiNote] = []
    cur_start = scaled[0].start_ms

    for n in scaled:
        if not cur:
            cur = [n]
            cur_start = n.start_ms
            continue
        if n.start_ms - cur_start <= cfg.chord_cluster_window_ms:
            cur.append(n)
        else:
            clusters.append(cur)
            cur = [n]
            cur_start = n.start_ms
    if cur:
        clusters.append(cur)

    events: list[PlayEvent] = []

    for group in clusters:
        group.sort(key=lambda x: (-x.note, -x.velocity, x.end_ms))

        norm_notes = [_normalize_note(n.note, cfg) for n in group]
        chord_key: str | None = None
        if cfg.chord_prefer:
            chord_key = detect_chord_key(norm_notes)

        melody_key: str | None = None
        if cfg.keep_melody_top_note and group:
            melody_note = _normalize_note(group[0].note, cfg)
            melody_key = map_note_to_key(melody_note, cfg.custom_key_map)

        if chord_key is not None:
            t0 = min(n.start_ms for n in group)
            t1 = max(n.end_ms for n in group)
            events.append(PlayEvent(t_ms=t0, type="down", key=chord_key, source="chord"))
            events.append(PlayEvent(t_ms=t1, type="up", key=chord_key, source="chord"))

            if melody_key is not None:
                t0m = group[0].start_ms
                t1m = group[0].end_ms
                events.append(
                    PlayEvent(t_ms=t0m, type="down", key=melody_key, source="melody", note=melody_note)
                )
                events.append(
                    PlayEvent(t_ms=t1m, type="up", key=melody_key, source="melody", note=melody_note)
                )
            continue

        per_key_notes: dict[str, list[MidiNote]] = defaultdict(list)
        for n in group:
            norm = _normalize_note(n.note, cfg)
            key = map_note_to_key(norm, cfg.custom_key_map)
            if key is None:
                continue
            per_key_notes[key].append(n)

        key_entries = []
        for key, ns in per_key_notes.items():
            vel = max(x.velocity for x in ns)
            start = min(x.start_ms for x in ns)
            end = max(x.end_ms for x in ns)
            key_entries.append((key, vel, start, end))

        key_entries.sort(key=lambda x: (-x[1], x[2], x[3], x[0]))
        key_entries = key_entries[: max(1, cfg.max_polyphony)]

        for key, _vel, start, end in key_entries:
            events.append(PlayEvent(t_ms=start, type="down", key=key, source="melody"))
            events.append(PlayEvent(t_ms=end, type="up", key=key, source="melody"))

    events.sort(key=lambda e: (e.t_ms, 0 if e.type == "down" else 1, e.key))
    return events
