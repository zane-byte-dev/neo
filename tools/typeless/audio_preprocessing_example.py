"""
音频预处理示例代码
包含降噪、静音裁剪、音量归一化等功能

依赖安装：
pip install noisereduce pydub
"""

import numpy as np
import noisereduce as nr
from pydub import AudioSegment
from pydub.silence import detect_leading_silence, detect_silence
from scipy.io import wavfile


def reduce_noise(audio_data, sample_rate, stationary=True):
    """
    降噪处理
    
    Args:
        audio_data: numpy array 音频数据
        sample_rate: 采样率
        stationary: 是否为稳态噪音
    
    Returns:
        降噪后的音频数据
    """
    reduced_noise = nr.reduce_noise(
        y=audio_data, 
        sr=sample_rate,
        stationary=stationary,
        prop_decrease=1.0  # 噪音减少比例 0-1
    )
    return reduced_noise


def trim_silence(audio_data, sample_rate, silence_threshold=-40, chunk_size=10):
    """
    裁剪静音部分
    
    Args:
        audio_data: numpy array 音频数据
        sample_rate: 采样率
        silence_threshold: 静音阈值（dB）
        chunk_size: 检测块大小（毫秒）
    
    Returns:
        裁剪后的音频数据
    """
    # 转换为 int16 格式
    audio_int16 = (audio_data * 32767).astype(np.int16)
    
    # 转换为 pydub AudioSegment
    audio = AudioSegment(
        audio_int16.tobytes(),
        frame_rate=sample_rate,
        sample_width=2,
        channels=1
    )
    
    # 检测开头的静音
    trim_leading = detect_leading_silence(
        audio, 
        silence_threshold=silence_threshold,
        chunk_size=chunk_size
    )
    
    # 检测结尾的静音（翻转音频）
    trim_trailing = detect_leading_silence(
        audio.reverse(), 
        silence_threshold=silence_threshold,
        chunk_size=chunk_size
    )
    
    # 裁剪静音部分
    if trim_trailing > 0:
        audio = audio[trim_leading:-trim_trailing]
    else:
        audio = audio[trim_leading:]
    
    # 转换回 numpy array
    samples = np.array(audio.get_array_of_samples())
    normalized = samples.astype(np.float32) / 32767.0
    
    return normalized


def normalize_volume(audio_data, target_level=0.8):
    """
    音量归一化
    
    Args:
        audio_data: numpy array 音频数据
        target_level: 目标音量等级 (0-1)
    
    Returns:
        归一化后的音频数据
    """
    # 计算当前最大音量
    current_max = np.max(np.abs(audio_data))
    
    if current_max > 0:
        # 计算缩放因子
        scaling_factor = target_level / current_max
        normalized = audio_data * scaling_factor
        
        # 防止削波
        normalized = np.clip(normalized, -1.0, 1.0)
        
        return normalized
    
    return audio_data


def remove_silence_chunks(audio_data, sample_rate, min_silence_len=500, silence_thresh=-40):
    """
    移除中间的长静音段（但保留短暂停顿）
    
    Args:
        audio_data: numpy array 音频数据
        sample_rate: 采样率
        min_silence_len: 最小静音长度（毫秒）
        silence_thresh: 静音阈值（dB）
    
    Returns:
        处理后的音频数据
    """
    # 转换为 int16 格式
    audio_int16 = (audio_data * 32767).astype(np.int16)
    
    # 转换为 pydub AudioSegment
    audio = AudioSegment(
        audio_int16.tobytes(),
        frame_rate=sample_rate,
        sample_width=2,
        channels=1
    )
    
    # 检测静音段
    silence_ranges = detect_silence(
        audio,
        min_silence_len=min_silence_len,
        silence_thresh=silence_thresh
    )
    
    # 如果没有静音段，直接返回
    if not silence_ranges:
        return audio_data
    
    # 保留非静音部分
    non_silence_ranges = []
    prev_end = 0
    
    for start, end in silence_ranges:
        if start > prev_end:
            non_silence_ranges.append((prev_end, start))
        prev_end = end
    
    # 添加最后一段
    if prev_end < len(audio):
        non_silence_ranges.append((prev_end, len(audio)))
    
    # 拼接非静音部分
    processed_audio = AudioSegment.empty()
    for start, end in non_silence_ranges:
        processed_audio += audio[start:end]
    
    # 转换回 numpy array
    samples = np.array(processed_audio.get_array_of_samples())
    normalized = samples.astype(np.float32) / 32767.0
    
    return normalized


def preprocess_audio(audio_data, sample_rate, config=None):
    """
    完整的音频预处理流程
    
    Args:
        audio_data: numpy array 音频数据
        sample_rate: 采样率
        config: 配置字典，可选参数包括：
            - enable_noise_reduction: 是否启用降噪（默认 True）
            - enable_silence_trim: 是否裁剪静音（默认 True）
            - enable_normalize: 是否归一化音量（默认 True）
            - enable_remove_silence: 是否移除中间静音（默认 False）
    
    Returns:
        处理后的音频数据
    """
    if config is None:
        config = {}
    
    # 默认配置
    enable_noise_reduction = config.get('enable_noise_reduction', True)
    enable_silence_trim = config.get('enable_silence_trim', True)
    enable_normalize = config.get('enable_normalize', True)
    enable_remove_silence = config.get('enable_remove_silence', False)
    
    processed = audio_data.copy()
    
    # 1. 降噪
    if enable_noise_reduction:
        print("🎵 Reducing noise...")
        processed = reduce_noise(processed, sample_rate)
    
    # 2. 移除中间长静音
    if enable_remove_silence:
        print("✂️  Removing long silence chunks...")
        processed = remove_silence_chunks(processed, sample_rate)
    
    # 3. 裁剪开头和结尾的静音
    if enable_silence_trim:
        print("✂️  Trimming silence...")
        processed = trim_silence(processed, sample_rate)
    
    # 4. 音量归一化
    if enable_normalize:
        print("📊 Normalizing volume...")
        processed = normalize_volume(processed)
    
    return processed


# 使用示例
if __name__ == "__main__":
    # 读取音频文件
    sample_rate, audio_data = wavfile.read("input.wav")
    
    # 转换为 float32 格式（-1 到 1）
    if audio_data.dtype == np.int16:
        audio_data = audio_data.astype(np.float32) / 32767.0
    
    # 预处理
    config = {
        'enable_noise_reduction': True,
        'enable_silence_trim': True,
        'enable_normalize': True,
        'enable_remove_silence': False
    }
    
    processed_audio = preprocess_audio(audio_data, sample_rate, config)
    
    # 保存处理后的音频
    processed_int16 = (processed_audio * 32767).astype(np.int16)
    wavfile.write("output.wav", sample_rate, processed_int16)
    
    print("✅ Audio preprocessing completed!")
