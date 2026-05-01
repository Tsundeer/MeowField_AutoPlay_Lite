"""
音频转换模块
"""
from .audio_to_midi import AudioConverter, get_converter, convert_audio_to_midi, set_piano_trans_path

__all__ = ['AudioConverter', 'get_converter', 'convert_audio_to_midi', 'set_piano_trans_path']
