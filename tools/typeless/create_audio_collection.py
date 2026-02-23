import os
import subprocess

audio_dir = "03_文章/记忆承载/Audio"
playlist_path = os.path.join(audio_dir, "000_完整播放列表.m3u")
merged_path = os.path.join(audio_dir, "000_记忆承载全集_HighQuality.mp3")
concat_list_path = os.path.join(audio_dir, "concat_list.txt")

# Get all mp3 files, sorted
files = sorted([f for f in os.listdir(audio_dir) if f.endswith(".mp3") and not f.startswith("000_")])

# 1. Create Playlist (.m3u)
with open(playlist_path, "w", encoding="utf-8") as f:
    f.write("#EXTM3U\n")
    for file in files:
        f.write(f"{file}\n")
print(f"✅ Playlist created: {playlist_path}")

# 2. Create ffmpeg concat list
with open(concat_list_path, "w", encoding="utf-8") as f:
    for file in files:
        # ffmpeg concat demuxer requires single quotes around filenames
        # and paths relative to the list file or absolute
        f.write(f"file '{file}'\n")

# 3. High Quality Merge using ffmpeg
print("⏳ Merging files using ffmpeg (Stream copy)...")
try:
    # Use -y to overwrite output if exists
    subprocess.run([
        "ffmpeg", "-y", "-f", "concat", "-safe", "0", 
        "-i", concat_list_path, 
        "-c", "copy", 
        merged_path
    ], check=True, capture_output=True)
    print(f"✅ High-quality merged file created: {merged_path}")
except subprocess.CalledProcessError as e:
    print(f"❌ ffmpeg merge failed: {e.stderr.decode()}")
finally:
    if os.path.exists(concat_list_path):
        os.remove(concat_list_path)

