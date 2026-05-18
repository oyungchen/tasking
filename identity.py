"""Instance identity management."""
import json
import os
import socket
import uuid

IDENTITY_FILE = os.path.join("tasks", ".instance.json")


def _ensure_dir():
    os.makedirs("tasks", exist_ok=True)


def _make_fresh_identity():
    return {
        "instance_id": uuid.uuid4().hex,
        "display_name": socket.gethostname(),
    }


def get_or_create_identity():
    _ensure_dir()
    fresh = _make_fresh_identity()
    try:
        fd = os.open(IDENTITY_FILE, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o644)
    except FileExistsError:
        try:
            with open(IDENTITY_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except (json.JSONDecodeError, IOError):
            identity = _make_fresh_identity()
            with open(IDENTITY_FILE, "w", encoding="utf-8") as f:
                json.dump(identity, f, indent=2)
            return identity
    else:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(fresh, f, indent=2)
        return fresh


def set_display_name(name):
    _ensure_dir()
    identity = get_or_create_identity()
    identity["display_name"] = name.strip() or socket.gethostname()
    with open(IDENTITY_FILE, "w", encoding="utf-8") as f:
        json.dump(identity, f, indent=2)
    return identity
