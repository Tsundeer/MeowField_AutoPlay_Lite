from __future__ import annotations

from dataclasses import dataclass

import mido

from src.models.core import MidiNote


@dataclass(frozen=True)
class ParsedMidi:
    notes: list[MidiNote]
    duration_ms: int


def parse_midi_file(path: str) -> ParsedMidi:
    mid = mido.MidiFile(path)

    tempo = 500000
    abs_ticks = 0
    abs_ms = 0

    ongoing: dict[tuple[int, int], tuple[int, int, int, int]] = {}
    notes: list[MidiNote] = []

    for track_index, track in enumerate(mid.tracks):
        abs_ticks = 0
        abs_ms = 0
        ongoing.clear()

        tempo = 500000
        for msg in track:
            abs_ticks += msg.time
            delta_ms = int(mido.tick2second(msg.time, mid.ticks_per_beat, tempo) * 1000)
            abs_ms += delta_ms

            if msg.type == "set_tempo":
                tempo = msg.tempo
                continue

            if msg.type == "note_on" and msg.velocity > 0:
                key = (msg.channel if hasattr(msg, "channel") else 0, msg.note)
                ongoing[key] = (abs_ms, msg.velocity, msg.channel if hasattr(msg, "channel") else 0, track_index)
                continue

            if msg.type in ("note_off", "note_on"):
                vel = 0
                if msg.type == "note_on":
                    vel = msg.velocity
                if msg.type == "note_off" or vel == 0:
                    key = (msg.channel if hasattr(msg, "channel") else 0, msg.note)
                    if key in ongoing:
                        start_ms, velocity, channel, tr = ongoing.pop(key)
                        end_ms = max(start_ms + 1, abs_ms)
                        notes.append(
                            MidiNote(
                                start_ms=start_ms,
                                end_ms=end_ms,
                                note=msg.note,
                                velocity=velocity,
                                channel=channel,
                                track=tr,
                            )
                        )

    if not notes:
        return ParsedMidi(notes=[], duration_ms=0)

    notes.sort(key=lambda n: (n.start_ms, n.end_ms, n.note))
    duration_ms = max(n.end_ms for n in notes)
    return ParsedMidi(notes=notes, duration_ms=duration_ms)
