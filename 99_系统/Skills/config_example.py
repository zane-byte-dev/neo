"""
配置管理示例代码
如果要使用配置文件管理，可以参考这个示例
"""

import os
from dotenv import load_dotenv

# 加载 .env 文件
load_dotenv()

class Config:
    """统一的配置管理类"""
    
    # API 配置
    GEMINI_API_KEY = os.getenv('GEMINI_API_KEY')
    
    # 服务器配置
    PORT = int(os.getenv('PORT', 52345))
    
    # 音频配置
    SAMPLE_RATE = int(os.getenv('SAMPLE_RATE', 44100))
    CHANNELS = int(os.getenv('CHANNELS', 1))
    
    # 录音限制
    MAX_RECORDING_DURATION = int(os.getenv('MAX_RECORDING_DURATION', 300))
    MIN_RECORDING_DURATION = float(os.getenv('MIN_RECORDING_DURATION', 0.3))
    MIN_AUDIO_VOLUME = float(os.getenv('MIN_AUDIO_VOLUME', 0.01))
    
    # 模式配置
    MODE = os.getenv('MODE', 'cloud')
    
    # Cloud 配置
    GEMINI_MODEL = os.getenv('GEMINI_MODEL', 'gemini-2.0-flash')
    
    # Local 配置
    OLLAMA_API_URL = os.getenv('OLLAMA_API_URL', 'http://localhost:11434/api/generate')
    LOCAL_LLM_MODEL = os.getenv('LOCAL_LLM_MODEL', 'qwen2.5:3b')
    WHISPER_MODEL_SIZE = os.getenv('WHISPER_MODEL_SIZE', 'small')
    
    # 文件配置
    OUTPUT_DIR = os.getenv('OUTPUT_DIR', '00_收集')
    TEMP_AUDIO_FILE = '.typeless_recording.wav'
    TEMP_COMPRESSED_FILE = '.typeless_recording.ogg'
    
    # 日志配置
    LOG_LEVEL = os.getenv('LOG_LEVEL', 'INFO')
    LOG_DIR = os.getenv('LOG_DIR', 'logs')
    
    @classmethod
    def validate(cls):
        """验证配置是否完整"""
        if not cls.GEMINI_API_KEY:
            raise ValueError("GEMINI_API_KEY is required but not set")
        
        if cls.MODE not in ['cloud', 'local']:
            raise ValueError(f"Invalid MODE: {cls.MODE}. Must be 'cloud' or 'local'")
        
        print("✅ Configuration validated successfully")
        return True

# 使用示例：
# from config_example import Config
# 
# Config.validate()
# port = Config.PORT
# api_key = Config.GEMINI_API_KEY
