"""
音频转 MIDI 转换模块

调用 PianoTrans.exe 将音频文件转换为 MIDI 文件
"""
from __future__ import annotations

import asyncio
import logging
import os
import sys
from pathlib import Path
from typing import Optional, Callable

logger = logging.getLogger(__name__)

CREATE_NO_WINDOW = 0x08000000


class AudioConverter:
    """
    音频转 MIDI 转换器
    
    调用 PianoTrans.exe 进行音频到 MIDI 的转换
    """
    
    def __init__(self):
        self.piano_trans_path: Optional[str] = None
        self.piano_trans_dir: Optional[str] = None
        self._auto_find_piano_trans()
    
    def _auto_find_piano_trans(self) -> bool:
        possible_paths = [
            "PianoTrans-v1.0/PianoTrans.exe",
            os.path.join(os.getcwd(), "PianoTrans-v1.0/PianoTrans.exe"),
            os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "PianoTrans-v1.0/PianoTrans.exe"),
            os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(__file__)))), "PianoTrans-v1.0/PianoTrans.exe"),
        ]
        
        for path in possible_paths:
            if os.path.exists(path):
                self.piano_trans_path = os.path.abspath(path)
                self.piano_trans_dir = os.path.dirname(self.piano_trans_path)
                logger.info(f"自动找到 PianoTrans.exe: {self.piano_trans_path}")
                return True
        
        logger.info("未自动找到 PianoTrans.exe，请手动设置路径")
        return False
    
    def set_piano_trans_path(self, path: str) -> tuple[bool, str]:
        path = os.path.abspath(path)
        
        if os.path.isdir(path):
            exe_path = os.path.join(path, "PianoTrans.exe")
            if os.path.exists(exe_path):
                self.piano_trans_path = exe_path
                self.piano_trans_dir = path
                logger.info(f"设置 PianoTrans.exe 路径: {exe_path}")
                return True, f"已找到 PianoTrans.exe: {exe_path}"
            else:
                for root, dirs, files in os.walk(path):
                    if "PianoTrans.exe" in files:
                        exe_path = os.path.join(root, "PianoTrans.exe")
                        self.piano_trans_path = exe_path
                        self.piano_trans_dir = os.path.dirname(exe_path)
                        logger.info(f"在子目录中找到 PianoTrans.exe: {exe_path}")
                        return True, f"已找到 PianoTrans.exe: {exe_path}"
                return False, f"目录中未找到 PianoTrans.exe: {path}"
        
        elif os.path.isfile(path):
            if path.lower().endswith(".exe"):
                self.piano_trans_path = path
                self.piano_trans_dir = os.path.dirname(path)
                logger.info(f"设置 PianoTrans.exe 路径: {path}")
                return True, f"已设置 PianoTrans.exe: {path}"
            else:
                return False, f"不是有效的 exe 文件: {path}"
        
        return False, f"路径不存在: {path}"
    
    def get_piano_trans_path(self) -> Optional[str]:
        return self.piano_trans_path
    
    def is_available(self) -> bool:
        if self.piano_trans_path is None:
            return False
        return os.path.exists(self.piano_trans_path)
    
    def _get_env_with_path(self) -> dict:
        """
        获取包含 PianoTrans 目录和 ffmpeg 目录的环境变量
        确保 DLL 和 ffmpeg 可以被正确找到
        """
        env = os.environ.copy()
        if self.piano_trans_dir:
            # 构建需要添加到 PATH 的目录列表
            path_dirs = []
            
            # 1. PianoTrans 主目录
            path_dirs.append(self.piano_trans_dir)
            
            # 2. ffmpeg 子目录（如果存在）
            ffmpeg_dir = os.path.join(self.piano_trans_dir, 'ffmpeg')
            if os.path.exists(ffmpeg_dir):
                path_dirs.append(ffmpeg_dir)
                logger.info(f"已添加 ffmpeg 目录到 PATH: {ffmpeg_dir}")
            
            # 3. 将这些目录添加到 PATH 的最前面
            current_path = env.get('PATH', '')
            new_path = os.pathsep.join(path_dirs) + os.pathsep + current_path
            env['PATH'] = new_path
            
            # 设置当前工作目录
            env['PWD'] = self.piano_trans_dir
            
            logger.info(f"最终 PATH: {env['PATH'][:200]}...")
        return env
    
    def _ensure_ffmpeg_in_main_dir(self):
        """
        确保 ffmpeg.exe 在 PianoTrans 主目录中
        这样 audioread 就能找到它
        """
        import shutil
        
        ffmpeg_subdir = os.path.join(self.piano_trans_dir, 'ffmpeg')
        ffmpeg_exe_subdir = os.path.join(ffmpeg_subdir, 'ffmpeg.exe')
        ffmpeg_exe_main = os.path.join(self.piano_trans_dir, 'ffmpeg.exe')
        
        if os.path.exists(ffmpeg_exe_subdir) and not os.path.exists(ffmpeg_exe_main):
            try:
                shutil.copy2(ffmpeg_exe_subdir, ffmpeg_exe_main)
                logger.info(f"已将 ffmpeg.exe 复制到 PianoTrans 主目录: {ffmpeg_exe_main}")
            except Exception as e:
                logger.warning(f"复制 ffmpeg.exe 失败: {e}")
    
    def _copy_audio_to_temp(self, audio_path: str) -> str:
        """
        将音频文件复制到 PianoTrans 目录下作为临时文件
        这样可以避免路径问题，并确保输出文件能正确生成
        """
        import shutil
        
        audio_name = os.path.basename(audio_path)
        temp_audio_path = os.path.join(self.piano_trans_dir, audio_name)
        
        # 如果文件已存在，先删除
        if os.path.exists(temp_audio_path):
            try:
                os.remove(temp_audio_path)
            except:
                pass
        
        # 复制音频文件到 PianoTrans 目录
        shutil.copy2(audio_path, temp_audio_path)
        logger.info(f"已将音频文件复制到 PianoTrans 目录: {temp_audio_path}")
        return temp_audio_path
    
    def _cleanup_old_midi_files(self):
        """
        清理 PianoTrans 目录下所有旧的 .mid 文件
        避免与新生成的文件混淆
        """
        try:
            for file in os.listdir(self.piano_trans_dir):
                if file.lower().endswith('.mid'):
                    file_path = os.path.join(self.piano_trans_dir, file)
                    try:
                        os.remove(file_path)
                        logger.info(f"已清理旧的 MIDI 文件: {file_path}")
                    except Exception as e:
                        logger.warning(f"无法删除旧 MIDI 文件 {file_path}: {e}")
        except Exception as e:
            logger.warning(f"清理旧 MIDI 文件时出错: {e}")
    
    async def convert_audio_to_midi(
        self,
        audio_path: str,
        output_path: Optional[str] = None,
        on_progress: Optional[Callable[[str], None]] = None
    ) -> tuple[bool, str, Optional[str]]:
        """
        将音频文件转换为 MIDI 文件
        
        改进的转换流程：
        1. 将音频文件复制到 PianoTrans 目录下
        2. 在 PianoTrans 目录内执行转换
        3. 确保完全静默运行
        4. 将输出的 MIDI 文件移动到音频文件原目录（或指定目录）
        """
        if not self.is_available():
            return False, "PianoTrans.exe 未设置或不存在，请先设置 PianoTrans 目录", None
        
        if not os.path.exists(audio_path):
            return False, f"音频文件不存在: {audio_path}", None
        
        audio_dir = os.path.dirname(os.path.abspath(audio_path))
        audio_name = os.path.splitext(os.path.basename(audio_path))[0]
        
        # 如果没有指定输出路径，默认输出到音频文件原目录
        if output_path is None:
            output_path = os.path.join(audio_dir, f"{audio_name}.mid")
        
        temp_audio_path = None
        generated_midi_path = None
        
        try:
            # 步骤0: 确保 ffmpeg.exe 在主目录，并清理旧的 MIDI 文件
            self._ensure_ffmpeg_in_main_dir()
            self._cleanup_old_midi_files()
            
            # 步骤1: 将音频文件复制到 PianoTrans 目录
            temp_audio_path = self._copy_audio_to_temp(audio_path)
            temp_audio_name = os.path.basename(temp_audio_path)
            
            # 步骤2: 准备输出路径
            expected_midi_name = os.path.splitext(temp_audio_name)[0] + ".mid"
            expected_midi_path = os.path.join(self.piano_trans_dir, expected_midi_name)
            
            # 如果预期的输出文件已存在，先删除
            if os.path.exists(expected_midi_path):
                try:
                    os.remove(expected_midi_path)
                    logger.info(f"已删除旧的输出文件: {expected_midi_path}")
                except:
                    pass
            
            # 步骤3: 执行转换命令
            cmd = [self.piano_trans_path, temp_audio_name]
            
            logger.info(f"执行转换命令: {' '.join(cmd)}")
            logger.info(f"工作目录: {self.piano_trans_dir}")
            
            if on_progress:
                on_progress("正在启动 PianoTrans...")
            
            # 准备环境变量和创建标志
            env = self._get_env_with_path()
            
            # Windows 平台：使用多种方法确保完全静默
            import subprocess
            startupinfo = None
            creation_flags = 0
            
            if sys.platform == 'win32':
                # 使用 subprocess 模块的 STARTUPINFO
                startupinfo = subprocess.STARTUPINFO()
                startupinfo.dwFlags |= subprocess.STARTF_USESHOWWINDOW
                startupinfo.wShowWindow = subprocess.SW_HIDE
                
                # 使用 CREATE_NO_WINDOW 标志隐藏窗口
                creation_flags = CREATE_NO_WINDOW
                
                logger.info(f"使用 Windows 静默标志: creation_flags={creation_flags}")
            
            # 启动子进程
            process = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                stdin=asyncio.subprocess.DEVNULL,  # 使用 DEVNULL 而不是 PIPE
                cwd=self.piano_trans_dir,
                env=env,
                creationflags=creation_flags,
                startupinfo=startupinfo
            )
            
            # 等待转换完成，带心跳机制
            heartbeat_count = 0
            stdout = b''
            stderr = b''
            
            while True:
                try:
                    stdout, stderr = await asyncio.wait_for(
                        process.communicate(),
                        timeout=5.0
                    )
                    break
                except asyncio.TimeoutError:
                    heartbeat_count += 1
                    if on_progress:
                        on_progress(f"转换进行中... ({heartbeat_count * 5}秒)")
                    logger.info(f"PianoTrans 转换进行中... ({heartbeat_count * 5}秒)")
                    continue
            
            # 记录输出信息（用于调试）
            if stdout:
                logger.info(f"PianoTrans stdout: {stdout.decode('utf-8', errors='ignore')}")
            if stderr:
                logger.warning(f"PianoTrans stderr: {stderr.decode('utf-8', errors='ignore')}")
            
            logger.info(f"PianoTrans 返回码: {process.returncode}")
            
            # 步骤4: 查找生成的 MIDI 文件
            # 由于已经清理了旧文件，只需要查找预期的文件名
            possible_outputs = [
                expected_midi_path,
                os.path.join(self.piano_trans_dir, "output.mid"),
            ]
            
            # 搜索 PianoTrans 目录下所有新生成的 .mid 文件
            try:
                for file in os.listdir(self.piano_trans_dir):
                    if file.lower().endswith('.mid'):
                        file_path = os.path.join(self.piano_trans_dir, file)
                        if file_path not in possible_outputs:
                            possible_outputs.append(file_path)
            except Exception as e:
                logger.warning(f"搜索 MIDI 文件时出错: {e}")
            
            # 检查所有可能的输出文件
            for possible_path in possible_outputs:
                if os.path.exists(possible_path):
                    logger.info(f"找到生成的 MIDI 文件: {possible_path}")
                    
                    # 将文件移动到目标位置
                    import shutil
                    if possible_path != output_path:
                        shutil.move(possible_path, output_path)
                        logger.info(f"已将 MIDI 文件移动到: {output_path}")
                        generated_midi_path = output_path
                    else:
                        generated_midi_path = possible_path
                    
                    # 清理临时音频文件
                    try:
                        if temp_audio_path and os.path.exists(temp_audio_path):
                            os.remove(temp_audio_path)
                            logger.info(f"已删除临时音频文件: {temp_audio_path}")
                    except:
                        pass
                    
                    return True, f"转换成功！MIDI 文件已保存到: {generated_midi_path}", generated_midi_path
            
            # 如果没找到输出文件
            if process.returncode == 0:
                logger.warning("转换返回成功但未找到输出文件")
                return False, "转换完成但未找到输出文件，请检查 PianoTrans 目录", None
            else:
                error_msg = stderr.decode('utf-8', errors='ignore') if stderr else "未知错误"
                logger.error(f"转换失败: {error_msg}")
                return False, f"转换失败: {error_msg}", None
                
        except Exception as e:
            logger.error(f"转换异常: {e}", exc_info=True)
            return False, f"转换异常: {str(e)}", None
        finally:
            # 确保清理临时文件
            try:
                if temp_audio_path and os.path.exists(temp_audio_path):
                    os.remove(temp_audio_path)
                    logger.info(f"已清理临时音频文件: {temp_audio_path}")
            except:
                pass
    
    def get_supported_formats(self) -> list[str]:
        return ['.wav', '.mp3', '.flac', '.ogg', '.m4a', '.aac']


_converter: Optional[AudioConverter] = None


def get_converter() -> AudioConverter:
    global _converter
    if _converter is None:
        _converter = AudioConverter()
    return _converter


def set_piano_trans_path(path: str) -> tuple[bool, str]:
    return get_converter().set_piano_trans_path(path)


async def convert_audio_to_midi(
    audio_path: str,
    output_path: Optional[str] = None,
    on_progress: Optional[Callable[[str], None]] = None
) -> tuple[bool, str, Optional[str]]:
    return await get_converter().convert_audio_to_midi(audio_path, output_path, on_progress)
