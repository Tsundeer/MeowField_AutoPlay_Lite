from __future__ import annotations

CHORDS: list[tuple[set[int], str]] = [
    ({7, 11, 2, 5}, "M"),  # G7 (4音) - 先匹配
    ({0, 4, 7}, "Z"),      # C
    ({2, 5, 9}, "X"),      # Dm
    ({4, 7, 11}, "C"),     # Em
    ({5, 9, 0}, "V"),      # F
    ({7, 11, 2}, "B"),     # G
    ({9, 0, 4}, "N"),      # Am
]


def detect_chord_key(notes: list[int]) -> str | None:
    pcs = {n % 12 for n in notes}
    if not pcs:
        return None

    for target, key in CHORDS:
        if target.issubset(pcs):
            return key
    return None
