# Changelog

All notable changes to this project are documented in this file.

## v1.2.0

### Added

- Added Identity V game profile support.
- Added dedicated profiles for piano, harp, and flute.
- Added a full 36-key Identity V piano mapping.
- Added Identity V reference documentation and quick lookup materials.

### Changed

- Updated project documentation to describe multi-game support.

## v1.1.3

### Added

- Added YiHuan piano support with fixed semitone mapping.
- Added support for semitone playback through `Shift` and `Ctrl` key combinations.
- Added game-specific key range and note range switching for supported profiles.
- Added repository metadata for open-source release under GPL-3.0.

### Changed

- Reworked profile switching so key mapping and note range mapping change together per game.
- Updated the desktop virtual keyboard to reflect game-specific layouts.
- Refined release packaging structure for public source distribution.

### Fixed

- Fixed profile isolation between Open Space, Identity V, and YiHuan.
- Fixed delayed profile mapping refresh after switching game or instrument.
- Fixed several key-send failures caused by unsupported multi-key stroke handling.
- Fixed incorrect black-key folding for fixed-semitone game profiles.

## v1.1.2

### Changed

- Improved stability analysis and packaging checks for desktop startup behavior.
- Hardened error handling around backend startup and runtime failure scenarios.

### Fixed

- Fixed several launch-time crash and blank-window issues observed on other machines.
- Improved diagnostics for backend startup, missing files, and port conflicts.

## v0.3.0

### Added

- Added real-time virtual keyboard visualization during playback.
- Added active key tracking in the playback pipeline.
- Added progress display, hotkey support, and persistent desktop-side settings.

### Changed

- Improved the core MIDI parsing, note mapping, and chord handling workflow.
- Expanded project documentation and usage materials.
