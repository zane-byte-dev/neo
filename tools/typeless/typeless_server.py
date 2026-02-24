import os
import sys
import time
import datetime
import threading
import queue
import subprocess
import sounddevice as sd
import scipy.io.wavfile as wav
import numpy as np
import gc
import warnings
import requests
import json
import logging
from http.server import BaseHTTPRequestHandler, HTTPServer
from pynput import keyboard

# Conditional FunASR import
try:
    from funasr import AutoModel
    FUNASR_AVAILABLE = True
except ImportError:
    FUNASR_AVAILABLE = False
    # Will log warning after logging is configured

# 加载环境变量
def load_env_file(env_path):
    """手动加载 .env 文件（不依赖 python-dotenv）"""
    if not os.path.exists(env_path):
        return False
    
    try:
        with open(env_path, 'r', encoding='utf-8') as f:
            for line in f:
                line = line.strip()
                # 跳过注释和空行
                if not line or line.startswith('#'):
                    continue
                # 解析键值对
                if '=' in line:
                    key, value = line.split('=', 1)
                    key = key.strip()
                    value = value.strip()
                    # 只有当环境变量不存在时才设置
                    if key and not os.getenv(key):
                        os.environ[key] = value
        return True
    except Exception as e:
        print(f"⚠️  Error loading .env file: {e}")
        return False

# 获取当前脚本所在目录
script_dir = os.path.dirname(os.path.abspath(__file__))
env_path = os.path.join(script_dir, '.env')

# 尝试使用 python-dotenv，如果不存在则手动加载
try:
    from dotenv import load_dotenv
    load_dotenv(env_path)
    logging.info("✅ Loaded .env using python-dotenv")
except ImportError:
    if load_env_file(env_path):
        logging.info("✅ Loaded .env manually (without python-dotenv)")
    else:
        logging.warning("⚠️  No .env file found, using system environment variables")
except Exception as e:
    logging.warning(f"⚠️  Could not load .env file: {e}")

# Suppress warnings
warnings.filterwarnings("ignore", category=FutureWarning)

# --- Configuration (从环境变量读取，提供默认值) ---
PORT = int(os.getenv('PORT', 52345))
SAMPLE_RATE = int(os.getenv('SAMPLE_RATE', 44100))
CHANNELS = int(os.getenv('CHANNELS', 1))
OUTPUT_DIR = os.getenv('OUTPUT_DIR', 'inbox')
TEMP_AUDIO_FILE = ".typeless_recording.wav"
TEMP_COMPRESSED_FILE = ".typeless_recording.ogg"
MAX_RECORDING_DURATION = int(os.getenv('MAX_RECORDING_DURATION', 300))  # 最大录音时长（秒）
MIN_RECORDING_DURATION = float(os.getenv('MIN_RECORDING_DURATION', 0.3))  # 最小录音时长（秒）
MIN_AUDIO_VOLUME = float(os.getenv('MIN_AUDIO_VOLUME', 0.01))  # 最小音量阈值

# Timing Constants
CLIPBOARD_DELAY = 0.1  # 剪贴板更新延迟（秒）
RECORDING_POLL_INTERVAL = 0.05  # 录音轮询间隔（秒）
CLIPBOARD_TIMEOUT = 2  # 剪贴板操作超时（秒）
GEMINI_UPLOAD_RETRIES = 3  # Gemini 上传重试次数
RETRY_DELAY = 1  # 重试延迟（秒）

# PTT Key (Right Option)
PTT_KEY = keyboard.Key.alt_r

# Mode Configuration
MODE = "local"

# Local Config (Ollama + ASR)
OLLAMA_API_URL = os.getenv('OLLAMA_API_URL', 'http://localhost:11434/api/generate')
LOCAL_LLM_MODEL = os.getenv('LOCAL_LLM_MODEL', 'qwen2.5:3b')

# ASR Engine Configuration
ASR_ENGINE = os.getenv('ASR_ENGINE', 'auto')  # Options: funasr, whisper, auto
WHISPER_MODEL_SIZE = os.getenv('WHISPER_MODEL_SIZE', 'small')
FUNASR_MODEL = os.getenv('FUNASR_MODEL', 'paraformer-zh')
FUNASR_VAD_MODEL = os.getenv('FUNASR_VAD_MODEL', 'fsmn-vad')
FUNASR_PUNC_MODEL = os.getenv('FUNASR_PUNC_MODEL', 'ct-punc')

# Language Config
INPUT_LANGUAGE = os.getenv('INPUT_LANGUAGE', 'auto')  # auto/zh/en/ja/es/fr 等
OUTPUT_LANGUAGE = os.getenv('OUTPUT_LANGUAGE', 'zh')  # zh/en/ja/auto(保持原语言)

# Logging Configuration
LOG_DIR = os.getenv('LOG_DIR', 'logs')
LOG_LEVEL = os.getenv('LOG_LEVEL', 'INFO')
os.makedirs(LOG_DIR, exist_ok=True)

# --- Colors for Logging ---
class Colors:
    HEADER = '\033[95m'
    BLUE = '\033[94m'
    GREEN = '\033[92m'
    FAIL = '\033[91m'
    ENDC = '\033[0m'

# Custom colored formatter for console
class ColoredFormatter(logging.Formatter):
    """自定义彩色日志格式化器"""
    
    FORMATS = {
        logging.DEBUG: f"{Colors.BLUE}%(message)s{Colors.ENDC}",
        logging.INFO: "%(message)s",
        logging.WARNING: f"{Colors.HEADER}%(message)s{Colors.ENDC}",
        logging.ERROR: f"{Colors.FAIL}%(message)s{Colors.ENDC}",
        logging.CRITICAL: f"{Colors.FAIL}%(message)s{Colors.ENDC}"
    }
    
    def format(self, record):
        log_fmt = self.FORMATS.get(record.levelno, "%(message)s")
        formatter = logging.Formatter(log_fmt)
        return formatter.format(record)

# Setup logging
logger = logging.getLogger()
logger.setLevel(getattr(logging, LOG_LEVEL.upper(), logging.INFO))

# Clear any existing handlers to avoid duplicates
logger.handlers.clear()

# File handler (uncolored)
file_handler = logging.FileHandler(os.path.join(LOG_DIR, 'typeless.log'))
file_handler.setLevel(logging.INFO)
file_handler.setFormatter(logging.Formatter('%(asctime)s - %(levelname)s - %(message)s'))
logger.addHandler(file_handler)

# Console handler (colored)
console_handler = logging.StreamHandler()
console_handler.setLevel(logging.DEBUG)
console_handler.setFormatter(ColoredFormatter())
logger.addHandler(console_handler)

# Global State
is_recording = False
stop_event = threading.Event()
recording_thread = None
client = None # Gemini Client
whisper_model = None # Faster Whisper Model
funasr_model = None # FunASR Model  
keyboard_controller = keyboard.Controller() # For simulating paste
processing_state = "ready"  # Track state: ready, recording, processing, done

# Thread locks for shared sources
whisper_lock = threading.Lock()
funasr_lock = threading.Lock()

# Log FunASR availability after logging is configured
if not FUNASR_AVAILABLE:
    logging.warning("FunASR not available, will use Whisper only")

# --- Helper Functions ---

def get_language_config() -> dict:
    """获取语言配置（仅中英）"""
    language_names = {
        'zh': 'Simplified Chinese',
        'en': 'English',
        'auto': 'Chinese + English (keep English as-is)'
    }
    
    output_lang = OUTPUT_LANGUAGE.lower()
    output_lang_name = language_names.get(output_lang, output_lang)
    
    return {
        'input_lang': INPUT_LANGUAGE.lower(),
        'output_lang': output_lang,
        'output_lang_name': output_lang_name,
        'should_translate': output_lang != 'auto'
    }

def generate_system_prompt(lang_config: dict) -> str:
    """根据语言配置生成 system prompt（针对 Qwen 优化，使用中文指令）"""
    if lang_config['output_lang'] == 'auto':
        return (
            "你是一位专业的文字编辑。你的任务是将语音转录文本优化为高质量的书面文字。\n\n"
            "处理规则：\n"
            "1. 必须使用简体中文输出（即使输入是繁体）\n"
            "2. 保留所有英文专业术语、品牌名、项目名、代码/API 名称，不要翻译成中文\n"
            "3. 去除口语化表达、语气词（如\"嗯\"、\"啊\"、\"那个\"等）\n"
            "4. 修正语法错误和逻辑不通顺的地方，但保持原意\n"
            "5. 保持简洁，不要添加原文没有的内容\n\n"
            "直接输出优化后的文本，不要任何解释或前缀。"
        )
    else:
        if lang_config['output_lang'] == 'zh':
            return (
                "你是一位专业的文字编辑。将语音转录文本优化为高质量的简体中文书面文字。\n\n"
                "处理规则：\n"
                "1. 必须使用简体中文输出\n"
                "2. 去除口语化表达、语气词、重复内容\n"
                "3. 修正语法错误，保持原意\n"
                "4. 保持简洁，不添加额外内容\n\n"
                "直接输出优化后的文本。"
            )
        else:
            target_lang = lang_config['output_lang_name']
            return f"You are an elite editor. Convert the spoken input into high-quality {target_lang} text. Remove fillers, fix logic, keep it concise. Output ONLY the refined text in {target_lang}."


def send_notification(title: str, message: str) -> None:
    """发送 macOS 通知"""
    try:
        title = title.replace('"', '\\"')
        message = message.replace('"', '\\"')
        script = f'display notification "{message}" with title "{title}"'
        subprocess.run(['osascript', '-e', script], check=True, timeout=5)
    except subprocess.TimeoutExpired:
        logging.warning("Notification timeout")
    except Exception as e:
        logging.warning(f"Notification failed: {e}")

def play_sound(sound_name: str) -> None:
    """播放系统声音"""
    subprocess.Popen(['afplay', f'/System/Library/Sounds/{sound_name}.aiff'])

def _write_to_clipboard(text: str) -> bool:
    """内部函数：写入剪贴板
    
    Args:
        text: 要写入的文本
        
    Returns:
        bool: 成功返回 True，失败返回 False
    """
    try:
        process = subprocess.Popen(
            'pbcopy',
            env={'LANG': 'en_US.UTF-8'},
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE
        )
        stdout, stderr = process.communicate(text.encode('utf-8'), timeout=CLIPBOARD_TIMEOUT)
        
        if process.returncode != 0:
            logging.error(f"Clipboard error: {stderr.decode()}")
            return False
        return True
        
    except subprocess.TimeoutExpired:
        logging.error("Clipboard operation timeout")
        process.kill()
        return False
    except Exception as e:
        logging.error(f"Clipboard error: {e}")
        return False

def copy_to_clipboard(text: str) -> None:
    """复制文本到剪贴板"""
    if _write_to_clipboard(text):
        logging.info("Text copied to clipboard")

def paste_text_via_clipboard(text: str) -> bool:
    """通过剪贴板粘贴文本，避免中文输入法干扰
    
    Args:
        text: 要粘贴的文本
        
    Returns:
        bool: 成功返回 True，失败返回 False
    """
    try:
        # 先复制到剪贴板
        if not _write_to_clipboard(text):
            return False
        
        # 短暂延迟确保剪贴板已更新
        time.sleep(CLIPBOARD_DELAY)
        
        # 模拟 Cmd+V 粘贴（不受输入法影响）
        keyboard_controller.press(keyboard.Key.cmd)
        keyboard_controller.press('v')
        keyboard_controller.release('v')
        keyboard_controller.release(keyboard.Key.cmd)
        
        logging.info("Text pasted via clipboard")
        return True
        
    except Exception as e:
        logging.error(f"Paste error: {e}")
        return False

# --- ASR Transcription Functions ---

def transcribe_with_funasr(audio_path: str, language: str = 'auto') -> dict:
    """
    使用 FunASR 进行语音转录
    
    Args:
        audio_path: 音频文件路径
        language: 语言设置（auto表示自动检测）
        
    Returns:
        dict: {
            'text': str,           # 转录文本
            'language': str,       # 检测到的语言
            'engine': str,         # 引擎名称
            'has_punctuation': bool  # 是否含标点
        }
    """
    global funasr_model
    
    # Thread-safe model initialization
    if funasr_model is None:
        with funasr_lock:
            if funasr_model is None:
                logging.info(f"{Colors.BLUE}⏳ Loading FunASR ({FUNASR_MODEL})...{Colors.ENDC}")
                load_start = time.time()
                funasr_model = AutoModel(
                    model=FUNASR_MODEL,
                    vad_model=FUNASR_VAD_MODEL,
                    punc_model=FUNASR_PUNC_MODEL
                )
                logging.info(f"  [Time] FunASR Model Load: {time.time() - load_start:.2f}s")
    
    # Transcribe
    result = funasr_model.generate(input=audio_path)
    
    # Parse result - FunASR returns list of dicts
    if isinstance(result, list) and len(result) > 0:
        text = result[0].get('text', '')
    else:
        text = ''
    
    return {
        'text': text.strip(),
        'language': 'zh',  # FunASR primarily for Chinese
        'engine': 'funasr',
        'has_punctuation': True  # FunASR auto-adds punctuation
    }


def transcribe_with_whisper(audio_path: str, language: str = 'auto') -> dict:
    """
    使用 Whisper 进行语音转录（现有逻辑封装）
    
    Args:
        audio_path: 音频文件路径
        language: 语言设置
        
    Returns:
        dict: 统一格式的转录结果
    """
    global whisper_model
    
    # Thread-safe model initialization
    if whisper_model is None:
        with whisper_lock:
            if whisper_model is None:
                logging.info(f"{Colors.BLUE}⏳ Loading Local Whisper ({WHISPER_MODEL_SIZE})...{Colors.ENDC}")
                load_start = time.time()
                from faster_whisper import WhisperModel
                whisper_model = WhisperModel(WHISPER_MODEL_SIZE, device="cpu", compute_type="int8")
                logging.info(f"  [Time] Model Load: {time.time() - load_start:.2f}s")
    
    # Prepare input
    input_lang = None if language == 'auto' else language
    logging.info(f"{Colors.BLUE}🧠  Transcribing (Language: {input_lang or 'auto-detect'})...{Colors.ENDC}")
    
    # Whisper Vocabulary Config
    WHISPER_VOCABULARY = os.getenv(
        'WHISPER_VOCABULARY',
        'Gemini, ChatGPT, Claude, Notion, Obsidian, Typeless, GitHub, API, React, Python, TypeScript, macOS, iOS, Android, OpenAI, Google, Apple, Microsoft'
    )
    
    # Build prompts
    initial_prompts = {
        'zh': f"请使用简体中文。语音笔记，包含中文和英文术语。常见词汇：{WHISPER_VOCABULARY}。",
        'en': f"Voice memo with Chinese and English terms. Common words: {WHISPER_VOCABULARY}.",
    }
    default_prompt = f"请使用简体中文。Voice memo, Chinese and English mixed. Common terms: {WHISPER_VOCABULARY}."
    initial_prompt = initial_prompts.get(input_lang, default_prompt) if input_lang else default_prompt
    
    # Transcribe
    segments, info = whisper_model.transcribe(
        audio_path,
        beam_size=5,
        language=input_lang,
        initial_prompt=initial_prompt,
        vad_filter=True
    )
    
    raw_text = "".join([segment.text for segment in segments])
    detected_lang = info.language if hasattr(info, 'language') else 'unknown'
    
    return {
        'text': raw_text.strip(),
        'language': detected_lang,
        'engine': 'whisper',
        'has_punctuation': False  # Whisper doesn't add punctuation
    }


def transcribe_audio(audio_path: str, engine: str = None) -> dict:
    """
    统一的语音转录接口，自动选择或切换引擎
    
    Args:
        audio_path: 音频文件路径
        engine: 指定引擎（funasr/whisper/auto），None时使用配置
        
    Returns:
        dict: 转录结果
    """
    engine = engine or ASR_ENGINE
    
    if engine == 'funasr' and FUNASR_AVAILABLE:
        try:
            return transcribe_with_funasr(audio_path)
        except Exception as e:
            logging.error(f"FunASR failed: {e}, falling back to Whisper")
            return transcribe_with_whisper(audio_path)
    
    elif engine == 'auto':
        # Auto mode: Try FunASR first for speed, fall back to Whisper if needed
        if FUNASR_AVAILABLE:
            try:
                return transcribe_with_funasr(audio_path)
            except Exception as e:
                logging.warning(f"FunASR failed: {e}, falling back to Whisper")
                return transcribe_with_whisper(audio_path)
        else:
            return transcribe_with_whisper(audio_path)
    
    else:  # Default to Whisper
        return transcribe_with_whisper(audio_path)

# --- Processing Logic ---

def process_with_local(audio_path: str) -> str:
    """使用本地 Whisper + Ollama 处理音频
    
    Args:
        audio_path: 音频文件路径
        
    Returns:
        str: 处理后的文本，失败返回 None
    """
    global whisper_model
    start_time = time.time()
    lang_config = get_language_config()
    
    try:
        # Use unified ASR interface
        transcribe_start = time.time()
        input_lang = lang_config['input_lang']
        
        result = transcribe_audio(audio_path, engine=ASR_ENGINE)
        
        raw_text = result['text']
        detected_lang = result['language']
        engine_used = result['engine']
        has_punctuation = result.get('has_punctuation', False)
        
        logging.info(f"  [Engine]: {engine_used.upper()}")
        logging.info(f"  [Time] Transcription: {time.time() - transcribe_start:.2f}s")
        logging.info(f"  [Detected Language]: {detected_lang}")
        logging.info(f"  [Raw Input]: {raw_text[:50]}...")
        
        if not raw_text.strip(): 
            return None

        llm_start = time.time()
        output_desc = lang_config['output_lang_name']
        logging.info(f"{Colors.BLUE}✨  Refining to {output_desc} (Ollama: {LOCAL_LLM_MODEL})...{Colors.ENDC}")
        
        system_prompt = generate_system_prompt(lang_config)
        
        # 针对中文模型优化用户 prompt
        if lang_config['output_lang'] in ['zh', 'auto']:
            user_prompt = f"语音转录原文：\n{raw_text}\n\n优化后："
        else:
            user_prompt = f"Transcript: {raw_text}\n\nRefined Text:"
        
        payload = {
            "model": LOCAL_LLM_MODEL, 
            "prompt": user_prompt, 
            "system": system_prompt, 
            "stream": False
        }
        
        response = requests.post(OLLAMA_API_URL, json=payload)
        if response.status_code == 200:
            result = response.json().get("response", "").strip()
            logging.info(f"  [Time] Ollama Refinement: {time.time() - llm_start:.2f}s")
            logging.info(f"  [Total] Processing took: {time.time() - start_time:.2f}s")
            return result
        else:
            logging.error(f"{Colors.FAIL}Ollama Error: {response.text}{Colors.ENDC}")
            return None
            
    except Exception as e:
        logging.error(f"{Colors.FAIL}Local Processing Error: {e}{Colors.ENDC}")
        logging.error(f"Local processing failed: {e}")
        return None
    finally:
        gc.collect()

def save_note(text: str) -> str:
    """保存语音笔记为 Markdown 文件
    
    Args:
        text: 笔记内容
        
    Returns:
        str: 保存的文件路径
    """
    timestamp = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    filename_ts = datetime.datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
    content = f"---\ncreated: {timestamp}\ntype: voice-memo\ntags: [inbox, typeless]\nmode: {MODE}\n---\n\n# 🎙️ Voice Memo: {timestamp}\n\n{text}\n"
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    file_path = os.path.join(OUTPUT_DIR, f"Typeless_{filename_ts}.md")
    with open(file_path, "w", encoding="utf-8") as f: f.write(content)
    return file_path

# --- Recording Thread ---

def record_audio_thread():
    global is_recording, processing_state
    processing_state = "recording"
    q = queue.Queue()
    full_recording = []
    recording_start_time = time.time()

    def callback(indata, frames, time, status):
        if status: print(status, file=sys.stderr)
        q.put(indata.copy())

    logging.info(f"\n{Colors.GREEN}🎙️  RECORDING... (Hold to Record){Colors.ENDC}")
    play_sound("Tink")
    
    try:
        with sd.InputStream(samplerate=SAMPLE_RATE, channels=CHANNELS, callback=callback):
            while not stop_event.is_set():
                # 检查超时
                if time.time() - recording_start_time > MAX_RECORDING_DURATION:
                    logging.warning(f"\n{Colors.FAIL}⚠️  Recording timeout ({MAX_RECORDING_DURATION}s), auto-stopping{Colors.ENDC}")
                    break
                    
                while not q.empty():
                    chunk = q.get()
                    full_recording.append(chunk)
                time.sleep(RECORDING_POLL_INTERVAL)
    except Exception as e:
        logging.error(f"Recording error: {e}")
        # Calculate duration and max_volume if possible, or use placeholders
        duration = time.time() - recording_start_time
        max_volume = np.max(np.abs(np.concatenate(full_recording, axis=0))) if full_recording else 0.0
        logging.info(f"Recording captured: duration={duration:.2f}s, max_volume={max_volume:.4f}")
        
        is_recording = False
        processing_state = "processing"  # Set to processing
        logging.info(f"{Colors.GREEN}⏹️  STOPPED. Processing...{Colors.ENDC}")
        play_sound("Pop")
        return # Exit early if recording failed
    
    # 清除停止事件，为下次录音做准备
    stop_event.clear()
    
    logging.info(f"{Colors.BLUE}⏹️  STOPPED. Processing...{Colors.ENDC}")
    play_sound("Pop")
    
    if full_recording:
        # 计算录音时长
        recording_duration = (time.time() - recording_start_time)
        
        # 检查录音是否太短
        if recording_duration < MIN_RECORDING_DURATION:
            logging.warning(f"{Colors.FAIL}⚠️  Recording too short ({recording_duration:.2f}s < {MIN_RECORDING_DURATION}s), skipping...{Colors.ENDC}")
            is_recording = False
            return
        
        audio_data = np.concatenate(full_recording, axis=0)
        
        # 检查音量是否太低
        max_volume = np.max(np.abs(audio_data))
        if max_volume < MIN_AUDIO_VOLUME:
            logging.warning(f"{Colors.FAIL}⚠️  Audio too quiet (max: {max_volume:.4f}), skipping...{Colors.ENDC}")
            is_recording = False
            return
        
        # Optimize memory: use in-place multiplication then convert
        np.multiply(audio_data, 32767, out=audio_data, casting='unsafe')
        audio_data = audio_data.astype(np.int16)
        
        try:
            wav.write(TEMP_AUDIO_FILE, SAMPLE_RATE, audio_data)
        except Exception as e:
            logging.error(f"Failed to write audio file: {e}")
            is_recording = False
            return
        
        logging.info(f"Recording captured: duration={recording_duration:.2f}s, max_volume={max_volume:.4f}")
        
        # Immediate cleanup of raw audio data
        del full_recording
        del audio_data
        gc.collect()
        
        # Process
        result = process_with_local(TEMP_AUDIO_FILE)
        
        # Handle Result
        if result:
            copy_to_clipboard(result)
            save_note(result)
            
            # Auto-Insert (Paste Mode - 避免中文输入法干扰)
            logging.info(f"{Colors.BLUE}📋  Pasting...{Colors.ENDC}")
            paste_text_via_clipboard(result)
            
            send_notification("Typeless", f"✅ Inserted (local)!")
            processing_state = "done"
            logging.info(f"{Colors.GREEN}Done.{Colors.ENDC}")
            # Reset to ready after 2 seconds
            threading.Timer(2.0, lambda: globals().update({'processing_state': 'ready'})).start()
        else:
            send_notification("Typeless", "❌ Failed.")
            processing_state = "ready"  # Reset immediately on failure
            
    is_recording = False

# --- PTT Logic ---

def on_press(key):
    global is_recording, stop_event, recording_thread
    if key == PTT_KEY and not is_recording:
        # 确保之前的线程已经完全结束
        if recording_thread is not None and recording_thread.is_alive():
            logging.error(f"{Colors.FAIL}⚠️  Previous recording still active, skipping...{Colors.ENDC}")
            return
            
        is_recording = True
        stop_event.clear()
        recording_thread = threading.Thread(target=record_audio_thread)
        recording_thread.start()

def on_release(key):
    global is_recording, stop_event
    if key == PTT_KEY:
        # 无条件设置停止事件，确保录音能结束
        if is_recording:
            logging.debug(f"{Colors.BLUE}⏸️  Key released, stopping...{Colors.ENDC}")
        stop_event.set()

def run_listener():
    with keyboard.Listener(on_press=on_press, on_release=on_release) as listener:
        listener.join()

# --- Server Logic ---

class RequestHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args): return
    
    def do_POST(self):
        # Placeholder for future POST requests
        self.send_response(405) # Method Not Allowed
        self.end_headers()
        self.wfile.write(b"POST method not implemented for this path.")

    def do_GET(self):
        """Handle GET requests for API endpoints"""
        if self.path == '/api/status':
            # Return current server status
            status_data = {
                'state': processing_state,
                'mode': 'local',
                'asr_engine': ASR_ENGINE,
                'llm_model': LOCAL_LLM_MODEL,
                'funasr_available': FUNASR_AVAILABLE
            }
            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps(status_data).encode())
        elif self.path == '/toggle':
            self.send_response(200); self.end_headers(); self.wfile.write(b"Use PTT Key (Right Option)")
        elif self.path == '/status':
            self.send_response(200); self.end_headers(); self.wfile.write(b"Mode: local")
        else: self.send_response(404); self.end_headers()

def run_server():
    server_address = ('127.0.0.1', PORT)
    httpd = HTTPServer(server_address, RequestHandler)
    
    lang_config = get_language_config()
    lang_display = f"{INPUT_LANGUAGE} → {lang_config['output_lang_name']}"
    
    logging.info(f"{Colors.HEADER}🚀 Typeless Server Running...{Colors.ENDC}")
    logging.info(f"   Mode: local | PTT Key: Right Option (alt_r)")
    logging.info(f"   Language: {lang_display}")
    logging.info(f"{Colors.BLUE}💡 Tip: Edit .env to change language settings{Colors.ENDC}")
    
    listener_thread = threading.Thread(target=run_listener, daemon=True)
    listener_thread.start()
    
    httpd.serve_forever()

if __name__ == "__main__":
    run_server()