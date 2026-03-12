# Neo Tools

This repository contains a collection of Python-based utilities and automation scripts designed for the Neo knowledge management ecosystem.

## Components

- **`memory-server/`**: An MCP (Model Context Protocol) server implemented in Python using the `mcp.server.fastmcp` SDK. It exposes tools to archive chat sessions into daily notes and extract grammar audits.
- **`refinery/`**: A set of CLI tools for extracting, curating, and converting content:
  - `butler.py`: Cleans the `inbox/` workspace and manages daily archival and auto-commits.
  - `clipper.py`: Downloads webpages, converting them cleanly into Markdown. Uses Jina AI with a standard local HTML scraping fallback.
  - `curator.py`: Randomly picks archived notes and asks Gemini to provide a new perspective or insights.
  - `ebook_refinery.py`: Uses `pandoc` to split an EPUB book into separate markdown chapters.
  - `audio_refinery.py`: Uses `edge-tts` to batch convert Markdown files into podcast-style MP3 files.
- **`wechat/`**: Tools for scraping, downloading, and cleaning WeChat articles into Markdown.

## Installation

You need Python 3 installed. We recommend creating a virtual environment or simply using `uv`:

```sh
# Using pip
pip install -r requirements.txt

# Or simply use uv to run scripts without explicit environment setup (recommended)
uv run memory-server/server.py
uv run refinery/butler.py
```

## Setup & Environment Variables

Most of the scripts read their context dynamically from environment variables:
- `GEMINI_WORK_DIR`: Path to the root of the obsidian / notes vault. Some `refinery` scripts rely on this to locate the `inbox` or `history` subdirectories.
- `GEMINI_PROJECT_DIR`: Path to the root of the project codebase (`neo`). Used by `memory-server`.

## System Requirements

- `ebook_refinery.py` requires `pandoc` to be installed on your system.
  - macOS: `brew install pandoc`
- The scripts heavily utilize standard unix tools and `git` commands under the hood.
