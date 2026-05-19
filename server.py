"""
Task Manager API Server
"""
import json as json_lib
import os
import random
import string
from datetime import datetime
from urllib.request import Request, urlopen

from flask import Flask, request, jsonify, send_from_directory
from models import Task, PRIORITY_COLORS, Priority
from storage import TaskStorage
from identity import get_or_create_identity, set_display_name
from peer import PeerRegistry, send_status_update, local_ip

PORT = int(os.environ.get("PORT", 8080))

app = Flask(__name__, static_folder="web", static_url_path="")
storage = TaskStorage()
identity = get_or_create_identity()
peer_registry = PeerRegistry(identity["instance_id"], PORT)


def _now():
    return datetime.now().isoformat()


@app.route("/")
def index():
    return send_from_directory("web", "index.html")


@app.route("/api/tasks", methods=["GET"])
def get_tasks():
    start = request.args.get("start")
    end = request.args.get("end")

    if start and end:
        try:
            start_date = datetime.fromisoformat(start).replace(tzinfo=None)
            end_date = datetime.fromisoformat(end).replace(tzinfo=None)
            end_date = end_date.replace(hour=23, minute=59, second=59, microsecond=999999)
            tasks = storage.get_tasks_by_date_range(start_date, end_date)
        except ValueError:
            return jsonify({"error": "Invalid date format"}), 400
    else:
        tasks = storage.get_all_tasks()

    return jsonify([t.to_dict() for t in tasks])


@app.route("/api/tasks/<task_id>", methods=["GET"])
def get_task(task_id):
    task = storage.get_task(task_id)
    if task is None:
        return jsonify({"error": "Task not found"}), 404
    return jsonify(task.to_dict())


@app.route("/api/tasks", methods=["POST"])
def create_task():
    data = request.get_json()
    if not data or not data.get("name"):
        return jsonify({"error": "Task name is required"}), 400

    task_id = datetime.now().strftime("%Y%m%d%H%M%S") + "-" + "".join(
        random.choices(string.ascii_lowercase + string.digits, k=6)
    )

    task_type = data.get("type", "normal")
    if task_type not in ("normal", "script"):
        return jsonify({"error": "Invalid task type"}), 400
    now = _now()
    task = Task(
        id=task_id,
        name=data["name"].strip(),
        description=data.get("description", "").strip() if task_type == "normal" else "",
        deadline=data.get("deadline") or None if task_type == "normal" else None,
        priority=data.get("priority", "medium") if task_type == "normal" else "medium",
        type=task_type,
        shell_command=data.get("shell_command", "").strip() if task_type == "script" else None,
        status="pending",
        created_at=now,
        updated_at=now,
    )
    storage.save_task(task)
    return jsonify(task.to_dict()), 201


@app.route("/api/tasks/<task_id>", methods=["PUT"])
def update_task(task_id):
    task = storage.get_task(task_id)
    if task is None:
        return jsonify({"error": "Task not found"}), 404

    data = request.get_json()
    if not data:
        return jsonify({"error": "No data provided"}), 400

    for field in ("name", "description", "deadline", "priority",
                  "created_at", "started_at", "updated_at", "completed_at",
                  "shell_command", "shell_result"):
        if field in data:
            val = data[field]
            if field in ("deadline", "started_at", "updated_at", "completed_at"):
                val = val or None
            elif field in ("description", "shell_command"):
                val = (val or "").strip()
            elif field == "name":
                val = val.strip()
            elif field == "shell_result":
                val = val or None
            setattr(task, field, val)

    if "priority" in data and task.type == "normal":
        task.color = PRIORITY_COLORS.get(Priority(task.priority), "#888888")

    if "updated_at" not in data:
        task.updated_at = _now()
    storage.save_task(task)
    return jsonify(task.to_dict())


@app.route("/api/tasks/<task_id>", methods=["DELETE"])
def delete_task(task_id):
    if storage.delete_task(task_id):
        return jsonify({"ok": True})
    return jsonify({"error": "Task not found"}), 404


@app.route("/api/tasks/<task_id>/move", methods=["PATCH"])
def move_task(task_id):
    data = request.get_json()
    if not data or not data.get("status"):
        return jsonify({"error": "Status is required"}), 400

    new_status = data["status"]
    if new_status not in ("pending", "processing", "done"):
        return jsonify({"error": "Invalid status"}), 400

    task = storage.move_task(task_id, new_status)
    if task is None:
        return jsonify({"error": "Task not found"}), 404

    task.updated_at = _now()
    if task.assigned_by and task.assigned_by.get("host"):
        try:
            send_status_update(
                task.assigned_by["host"],
                task.assigned_by.get("port", 8080),
                task.id,
                new_status,
                get_or_create_identity()["instance_id"],
            )
        except Exception as e:
            print(f"Status update failed for task {task.id}: {e}")
    storage.save_task(task)
    return jsonify(task.to_dict())


@app.route("/api/identity", methods=["GET"])
def get_identity():
    ident = get_or_create_identity()
    return jsonify(ident)


@app.route("/api/identity/name", methods=["POST"])
def set_identity_name():
    data = request.get_json()
    if not data or not data.get("name"):
        return jsonify({"error": "Name is required"}), 400
    ident = set_display_name(data["name"].strip())
    peer_registry.refresh_name()
    return jsonify(ident)


@app.route("/api/peers", methods=["GET"])
def get_peers():
    peers = peer_registry.get_peers()
    own = get_or_create_identity()
    return jsonify({
        "self": {"instance_id": own["instance_id"], "display_name": own["display_name"]},
        "peers": peers,
    })


@app.route("/api/tasks/<task_id>/assign", methods=["POST"])
def assign_task(task_id):
    data = request.get_json()
    if not data or not data.get("to_instance"):
        return jsonify({"error": "to_instance is required"}), 400

    task = storage.get_task(task_id)
    if task is None:
        return jsonify({"error": "Task not found"}), 404

    peer = peer_registry.get_peer(data["to_instance"])
    if not peer:
        return jsonify({"error": "Peer not found"}), 404

    ident = get_or_create_identity()
    task_dict = task.to_dict()
    task_dict["assigned_by"] = {
        "instance_id": ident["instance_id"],
        "display_name": ident["display_name"],
        "host": local_ip(),
        "port": PORT,
    }

    try:
        payload = json_lib.dumps({
            "from_instance": ident["instance_id"],
            "from_display": ident["display_name"],
            "from_port": PORT,
            "task": task_dict,
        }).encode()
        req = Request(
            f"http://{peer['host']}:{peer['port']}/peer/assign",
            data=payload,
            headers={"Content-Type": "application/json"},
        )
        with urlopen(req, timeout=5) as resp:
            resp.read()
    except Exception as e:
        return jsonify({"error": f"Failed to assign: {e}"}), 502

    task.assigned_to = {
        "instance_id": peer["instance_id"],
        "display_name": peer["display_name"],
    }
    task.updated_at = _now()
    storage.save_task(task)
    return jsonify(task.to_dict())


@app.route("/peer/assign", methods=["POST"])
def peer_assign():
    data = request.get_json()
    if not data or "task" not in data:
        return jsonify({"error": "Task data required"}), 400

    task_data = data["task"]
    sender_host = (
        (task_data.get("assigned_by") or {}).get("host")
        or request.remote_addr
    )
    task_data["assigned_by"] = {
        "instance_id": data.get("from_instance", ""),
        "display_name": data.get("from_display", "Unknown"),
        "host": sender_host,
        "port": data.get("from_port", 8080),
    }
    task_data["assigned_to"] = None

    existing = storage.get_task(task_data["id"])
    if existing:
        return jsonify({"task_id": task_data["id"], "ok": True, "existed": True})

    task = Task.from_dict(task_data)
    task.updated_at = _now()
    storage.save_task(task)
    return jsonify({"task_id": task.id, "ok": True}), 201


@app.route("/peer/status-update", methods=["POST"])
def peer_status_update():
    data = request.get_json()
    if not data or not data.get("task_id") or not data.get("status"):
        return jsonify({"error": "task_id and status required"}), 400

    task = storage.get_task(data["task_id"])
    if task is None:
        return jsonify({"error": "Task not found"}), 404

    if not task.assigned_to or task.assigned_to.get("instance_id") != data.get("from_instance"):
        return jsonify({"error": "Not authorized"}), 403

    new_status = data["status"]
    if new_status not in ("pending", "processing", "done"):
        return jsonify({"error": "Invalid status"}), 400

    task = storage.move_task(data["task_id"], new_status)
    task.updated_at = _now()
    storage.save_task(task)
    return jsonify({"ok": True})


@app.route("/peer/info", methods=["GET"])
def peer_info():
    ident = get_or_create_identity()
    return jsonify({
        "instance_id": ident["instance_id"],
        "display_name": ident["display_name"],
        "peer_api_version": 1,
    })


if __name__ == "__main__":
    peer_registry.start()
    try:
        app.run(host="0.0.0.0", port=PORT, debug=False)
    finally:
        peer_registry.stop()