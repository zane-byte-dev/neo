import time
from pynput.keyboard import Controller

keyboard = Controller()

print("🚀 3秒后开始打字，请把光标移到一个输入框里！")
time.sleep(3)

try:
    print("Typing...")
    keyboard.type("Hello World! 你好世界！")
    print("Done.")
except Exception as e:
    print(f"Error: {e}")
