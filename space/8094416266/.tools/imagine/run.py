#!/usr/bin/env python3
"""
generate_image — AI image generation tool.

Stdin:  JSON { "args": { "prompt": "...", "aspect_ratio": "1:1" }, "context": { ... } }
Stdout: JSON { "type": "image", "data": "<base64>", "mimeType": "image/png", "caption": "..." }
        or   { "type": "text",  "content": "..." }
        or   { "type": "error", "content": "..." }

Requires GEMINI_API_KEY environment variable.
"""

import sys
import json
import os
import urllib.request
import urllib.error

GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models"
IMAGE_MODEL = "gemini-2.5-flash-image"


def main():
    raw = sys.stdin.read()
    if not raw.strip():
        json.dump({"type": "error", "content": "No input received on stdin"}, sys.stdout)
        return

    input_data = json.loads(raw)
    args = input_data.get("args", {})
    prompt = str(args.get("prompt", "")).strip()
    if not prompt:
        json.dump({"type": "error", "content": "prompt is required"}, sys.stdout)
        return

    api_key = os.environ.get("GEMINI_API_KEY", "")
    if not api_key:
        json.dump({"type": "error", "content": "GEMINI_API_KEY not set"}, sys.stdout)
        return

    url = f"{GEMINI_BASE_URL}/{IMAGE_MODEL}:generateContent?key={api_key}"

    payload = json.dumps({
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {
            "responseModalities": ["TEXT", "IMAGE"],
        },
    }).encode("utf-8")

    req = urllib.request.Request(
        url,
        data=payload,
        headers={"Content-Type": "application/json"},
    )

    try:
        resp = urllib.request.urlopen(req, timeout=55)
        data = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")[:200]
        json.dump({"type": "error", "content": f"API error ({e.code}): {body}"}, sys.stdout)
        return
    except Exception as e:
        json.dump({"type": "error", "content": f"Request failed: {e}"}, sys.stdout)
        return

    parts = (
        data.get("candidates", [{}])[0]
        .get("content", {})
        .get("parts", [])
    )

    image_data = None
    mime_type = "image/png"
    text_parts = []

    for part in parts:
        if "inlineData" in part:
            image_data = part["inlineData"]["data"]
            mime_type = part["inlineData"].get("mimeType", "image/png")
        elif "text" in part:
            text_parts.append(part["text"])

    text_response = "".join(text_parts)

    if image_data:
        result = {
            "type": "image",
            "data": image_data,
            "mimeType": mime_type,
        }
        if text_response:
            result["caption"] = text_response
        json.dump(result, sys.stdout)
    elif text_response:
        json.dump({"type": "text", "content": text_response}, sys.stdout)
    else:
        json.dump({"type": "error", "content": "No image or text in model response"}, sys.stdout)


if __name__ == "__main__":
    main()
