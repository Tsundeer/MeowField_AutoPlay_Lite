"""
曲库管理模块

提供 MIDI 文件曲库的管理功能，包括：
- 导入文件夹（扫描 MIDI 文件）
- 增删改查曲库条目
- 持久化存储

优化支持大批量文件（上万个）
"""

import json
import os
import asyncio
from dataclasses import dataclass, asdict
from datetime import datetime
from typing import Optional, Callable
import logging
import hashlib
import concurrent.futures
import time

from src.runtime.paths import get_library_data_dir

logger = logging.getLogger(__name__)

try:
    import mido  # type: ignore
except Exception:  # pragma: no cover
    mido = None

LIBRARY_FILE = "midi_library.json"


@dataclass
class LibraryEntry:
    """曲库条目"""
    id: str
    path: str
    name: str
    folder: str
    duration_ms: int = 0
    notes: int = 0
    added_at: str = ""
    
    def to_dict(self) -> dict:
        return asdict(self)
    
    @classmethod
    def from_dict(cls, data: dict) -> "LibraryEntry":
        return cls(
            id=data.get("id", ""),
            path=data.get("path", ""),
            name=data.get("name", ""),
            folder=data.get("folder", ""),
            duration_ms=data.get("duration_ms", 0),
            notes=data.get("notes", 0),
            added_at=data.get("added_at", ""),
        )


class LibraryManager:
    """曲库管理器"""
    
    def __init__(self, data_dir: str | None = None):
        resolved_data_dir = data_dir or str(get_library_data_dir())
        self.data_dir = resolved_data_dir
        self.library_file = os.path.join(resolved_data_dir, LIBRARY_FILE)
        self._entries: dict[str, LibraryEntry] = {}
        self._dirty = False
        self._load()
    
    def _load(self) -> None:
        """从文件加载曲库"""
        if os.path.exists(self.library_file):
            try:
                with open(self.library_file, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    self._entries = {
                        k: LibraryEntry.from_dict(v) for k, v in data.get("entries", {}).items()
                    }
                logger.info(f"已加载曲库: {len(self._entries)} 个条目")
            except Exception as e:
                logger.error(f"加载曲库失败: {e}")
                self._entries = {}
    
    def _save(self, force: bool = False) -> None:
        """保存曲库到文件"""
        if not self._dirty and not force:
            return
        try:
            data = {
                "entries": {k: v.to_dict() for k, v in self._entries.items()},
                "updated_at": datetime.now().isoformat(),
            }
            with open(self.library_file, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False)
            self._dirty = False
            logger.info(f"已保存曲库: {len(self._entries)} 个条目")
        except Exception as e:
            logger.error(f"保存曲库失败: {e}")
    
    def _generate_id(self, path: str) -> str:
        """生成条目 ID"""
        return hashlib.md5(path.encode()).hexdigest()[:12]
    
    def get_all(self) -> list[LibraryEntry]:
        """获取所有条目"""
        return list(self._entries.values())

    def count(self, folder: Optional[str] = None, query: Optional[str] = None) -> int:
        """获取条目数量（可选按 folder/query 过滤）"""
        return len(self._filter_entries(folder=folder, query=query))

    def get_page(
        self,
        offset: int = 0,
        limit: int = 200,
        folder: Optional[str] = None,
        query: Optional[str] = None,
    ) -> list[LibraryEntry]:
        """分页获取条目（可选按 folder/query 过滤）"""
        entries = self._filter_entries(folder=folder, query=query)
        return entries[offset: offset + limit]

    def _filter_entries(self, folder: Optional[str] = None, query: Optional[str] = None) -> list[LibraryEntry]:
        q = (query or "").strip().lower()

        items = list(self._entries.values())
        if folder:
            items = [e for e in items if e.folder == folder]
        if q:
            items = [e for e in items if q in e.name.lower() or q in e.folder.lower()]

        # 稳定排序：先按 folder，再按 name，避免每次分页顺序跳动
        items.sort(key=lambda e: (e.folder or "", e.name or ""))
        return items
    
    def get_by_id(self, entry_id: str) -> Optional[LibraryEntry]:
        """根据 ID 获取条目"""
        return self._entries.get(entry_id)
    
    def get_by_folder(self, folder: str) -> list[LibraryEntry]:
        """根据文件夹获取条目"""
        return [e for e in self._entries.values() if e.folder == folder]
    
    def get_folders(self) -> list[str]:
        """获取所有文件夹"""
        return list(set(e.folder for e in self._entries.values()))
    
    def _add_entry(self, path: str, name: str, folder: str, duration_ms: int = 0, notes: int = 0) -> Optional[LibraryEntry]:
        """添加条目（内部方法，不自动保存）"""
        entry_id = self._generate_id(path)
        if entry_id in self._entries:
            return None
        entry = LibraryEntry(
            id=entry_id,
            path=path,
            name=name,
            folder=folder,
            duration_ms=duration_ms,
            notes=notes,
            added_at=datetime.now().isoformat(),
        )
        self._entries[entry_id] = entry
        self._dirty = True
        return entry
    
    def add(self, path: str, name: str, folder: str, duration_ms: int = 0, notes: int = 0) -> LibraryEntry:
        """添加条目（立即保存）"""
        entry = self._add_entry(path, name, folder, duration_ms, notes)
        if entry:
            self._save(force=True)
            logger.info(f"添加曲库条目: {name}")
        return entry
    
    def update(self, entry_id: str, **kwargs) -> Optional[LibraryEntry]:
        """更新条目"""
        entry = self._entries.get(entry_id)
        if not entry:
            return None
        
        for key, value in kwargs.items():
            if hasattr(entry, key):
                setattr(entry, key, value)
        
        self._dirty = True
        self._save()
        logger.info(f"更新曲库条目: {entry.name}")
        return entry
    
    def delete(self, entry_id: str) -> bool:
        """删除条目"""
        if entry_id in self._entries:
            name = self._entries[entry_id].name
            del self._entries[entry_id]
            self._dirty = True
            self._save()
            logger.info(f"删除曲库条目: {name}")
            return True
        return False
    
    def delete_by_folder(self, folder: str) -> int:
        """删除文件夹下所有条目"""
        to_delete = [e.id for e in self._entries.values() if e.folder == folder]
        for entry_id in to_delete:
            del self._entries[entry_id]
        if to_delete:
            self._dirty = True
            self._save()
        logger.info(f"删除文件夹 {folder}: {len(to_delete)} 个条目")
        return len(to_delete)
    
    def clear(self) -> int:
        """清空曲库"""
        count = len(self._entries)
        self._entries = {}
        self._dirty = True
        self._save()
        logger.info(f"清空曲库: {count} 个条目")
        return count
    
    def _quick_parse_midi(self, file_path: str) -> tuple[int, int]:
        """
        快速解析 MIDI 文件，只读取基本信息
        返回 (duration_ms, notes_count)
        """
        try:
            if mido is None:
                return 0, 0
            mid = mido.MidiFile(file_path)
            notes = 0
            duration_ms = 0
            
            for track in mid.tracks:
                track_time = 0
                for msg in track:
                    track_time += msg.time
                    if msg.type == 'note_on' and msg.velocity > 0:
                        notes += 1
                duration_ms = max(duration_ms, mido.tick2second(track_time, mid.ticks_per_beat, 500000) * 1000)
            
            return int(duration_ms), notes
        except Exception as e:
            logger.debug(f"快速解析失败 {file_path}: {e}")
            return 0, 0
    
    async def scan_folder(
        self,
        folder_path: str,
        on_progress: Optional[Callable] = None,
        cancel_event: Optional[asyncio.Event] = None,
    ) -> list[LibraryEntry]:
        """
        扫描文件夹中的 MIDI 文件
        
        优化版本：
        - 批量保存，减少 IO 操作
        - 分批处理，避免阻塞
        - 使用快速解析
        """
        if not os.path.isdir(folder_path):
            logger.error(f"文件夹不存在: {folder_path}")
            return []
        
        folder_name = os.path.basename(folder_path) or folder_path
        midi_extensions = {".mid", ".midi", ".MID", ".MIDI"}
        
        # 收集所有 MIDI 文件
        midi_files = []
        for root, _, files in os.walk(folder_path):
            for file in files:
                if os.path.splitext(file)[1] in midi_extensions:
                    midi_files.append(os.path.join(root, file))
        
        if not midi_files:
            logger.info(f"文件夹中没有 MIDI 文件: {folder_path}")
            return []
        
        total = len(midi_files)
        logger.info(f"开始扫描文件夹: {folder_path}, 找到 {total} 个 MIDI 文件")
        
        # 发送初始进度
        if on_progress:
            try:
                on_progress(0, total, "", 0)
            except TypeError:
                on_progress(0, total, "")
        
        # 分批处理：批次过小会导致调度/await 开销偏大
        batch_size = 200
        added_entries = []
        existing_ids = set(self._entries.keys())

        max_workers = min(32, (os.cpu_count() or 4) + 4)
        cpu = os.cpu_count() or 4
        concurrency = min(max_workers, max(12, cpu * 2))
        semaphore = asyncio.Semaphore(concurrency)

        processed = 0
        added_count = 0
        last_progress_at = time.monotonic()
        progress_interval_s = 0.4
        with concurrent.futures.ThreadPoolExecutor(max_workers=max_workers) as executor:

            async def _parse_and_add(file_path: str) -> Optional[LibraryEntry]:
                async with semaphore:
                    if cancel_event and cancel_event.is_set():
                        return None
                    name = os.path.splitext(os.path.basename(file_path))[0]
                    entry_id = self._generate_id(file_path)

                    # 跳过已存在的条目
                    if entry_id in existing_ids:
                        return None

                    duration_ms, notes = await asyncio.get_event_loop().run_in_executor(
                        executor, self._quick_parse_midi, file_path
                    )

                    entry = self._add_entry(
                        path=file_path,
                        name=name,
                        folder=folder_name,
                        duration_ms=duration_ms,
                        notes=notes,
                    )
                    if entry:
                        existing_ids.add(entry_id)
                    return entry

            for batch_start in range(0, total, batch_size):
                batch_end = min(batch_start + batch_size, total)
                batch_files = midi_files[batch_start:batch_end]

                tasks = [asyncio.create_task(_parse_and_add(fp)) for fp in batch_files]

                for task in asyncio.as_completed(tasks):
                    try:
                        if cancel_event and cancel_event.is_set():
                            for t in tasks:
                                t.cancel()
                            break
                        entry = await task
                        processed += 1
                        if entry:
                            added_entries.append(entry)
                            added_count += 1

                        if on_progress:
                            now = time.monotonic()
                            if processed == total or (processed % 50 == 0 and now - last_progress_at >= progress_interval_s):
                                last_progress_at = now
                                try:
                                    on_progress(processed, total, entry.name if entry else "", added_count)
                                except TypeError:
                                    on_progress(processed, total, entry.name if entry else "")
                    except Exception as e:
                        processed += 1
                        logger.warning(f"处理文件失败: {e}")

                # 每批处理后让出控制权
                await asyncio.sleep(0)

                if cancel_event and cancel_event.is_set():
                    logger.info(f"扫描取消: 已处理 {processed}/{total}, 新增 {added_count}")
                    break
        
        # 批量保存
        if added_entries and not (cancel_event and cancel_event.is_set()):
            self._save(force=True)
        
        logger.info(f"扫描完成: 新增 {len(added_entries)} 个条目")
        return added_entries
    
    def search(self, query: str) -> list[LibraryEntry]:
        """搜索曲库"""
        query = query.lower()
        return [
            e for e in self._entries.values()
            if query in e.name.lower() or query in e.folder.lower()
        ]
