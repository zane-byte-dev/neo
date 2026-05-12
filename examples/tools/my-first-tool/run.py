#!/usr/bin/env python3
import json
import sys


def main() -> None:
    payload = json.load(sys.stdin)
    args = payload.get("args", {})
    context = payload.get("context", {})

    name = str(args.get("name") or "friend")
    user_id = str(context.get("userId") or "unknown")

    print(json.dumps({
        "type": "text",
        "content": f"Hello, {name}. Tool context userId={user_id}.",
    }))


if __name__ == "__main__":
    main()