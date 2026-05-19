# LAN Peer Discovery & Task Assignment — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable LAN peer discovery via mDNS so users can see who else is online and assign tasks to each other with status tracking.

**Architecture:** Two new Python modules (`identity.py`, `peer.py`), model changes to `Task`, new API routes in `server.py`, and frontend updates for the peers panel and assign flow. Peer communication uses direct HTTP between Flask instances discovered via Zeroconf. Status sync is best-effort — failure to reach a peer does not block local operations.

**Tech Stack:** Python 3.x + Flask + zeroconf (python-zeroconf), vanilla JS frontend, stdlib urllib for peer HTTP calls

---

### Task 1: Instance Identity (`identity.py`)

**Files:**
- Create: `identity.py`

- [ ] **Step 1: Create identity.py**

```python
"""Instance identity management."""
import json
import os
import socket
import uuid

IDENTITY_FILE = os.path.join("tasks", ".instance.json")


def _ensure_dir():
    os.makedirs("tasks", exist_ok=True)


def get_or_create_identity():
    _ensure_dir()
    if os.path.exists(IDENTITY_FILE):
        with open(IDENTITY_FILE, "r", encoding="utf-8") as f:
            return json.load(f)

    identity = {
        "instance_id": uuid.uuid4().hex,
        "display_name": socket.gethostname(),
    }
    with open(IDENTITY_FILE, "w", encoding="utf-8") as f:
        json.dump(identity, f, indent=2)
    return identity


def set_display_name(name):
    _ensure_dir()
    identity = get_or_create_identity()
    identity["display_name"] = name.strip() or socket.gethostname()
    with open(IDENTITY_FILE, "w", encoding="utf-8") as f:
        json.dump(identity, f, indent=2)
    return identity
```

- [ ] **Step 2: Verify**

```bash
cd /Users/didi/thoughts-lab/taskDone && .venv/bin/python -c "
from identity import get_or_create_identity, set_display_name
i = get_or_create_identity()
assert 'instance_id' in i and 'display_name' in i
u = set_display_name('TestUser')
assert u['display_name'] == 'TestUser'
print('OK:', i['instance_id'][:8])
"
```

- [ ] **Step 3: Commit**

```bash
git add identity.py
git commit -m "feat: add instance identity module"
```

---

### Task 2: Peer Discovery (`peer.py`)

**Files:**
- Create: `peer.py`

- [ ] **Step 1: Install zeroconf**

```bash
cd /Users/didi/thoughts-lab/taskDone && .venv/bin/pip install 'zeroconf>=0.130'
```

- [ ] **Step 2: Create peer.py**

```python
"""LAN peer discovery via mDNS (Zeroconf)."""
import json
import socket
import threading
from urllib.request import Request, urlopen

from zeroconf import ServiceBrowser, ServiceInfo, Zeroconf

from identity import get_or_create_identity

SERVICE_TYPE = "_taskdone._http._tcp.local."
PEER_API_VERSION = 1


def local_ip():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
    except Exception:
        ip = "127.0.0.1"
    finally:
        s.close()
    return ip


def _extract_ip(info):
    if info.addresses:
        addr = info.addresses[0]
        if isinstance(addr, bytes):
            return socket.inet_ntoa(addr)
        return addr
    return None


class PeerRegistry:
    def __init__(self, own_instance_id, own_port):
        self._own_id = own_instance_id
        self._own_port = own_port
        self._zc = Zeroconf()
        self._browser = None
        self._service_info = None
        self._peers = {}
        self._lock = threading.Lock()

    @property
    def own_instance_id(self):
        return self._own_id

    def start(self):
        identity = get_or_create_identity()
        self._service_info = ServiceInfo(
            SERVICE_TYPE,
            f"{identity['instance_id']}.{SERVICE_TYPE}",
            addresses=[socket.inet_aton(local_ip())],
            port=self._own_port,
            properties={
                b"instance_id": identity["instance_id"].encode(),
                b"display_name": identity["display_name"].encode(),
                b"version": str(PEER_API_VERSION).encode(),
            },
        )
        self._zc.register_service(self._service_info, ttl=60)
        self._browser = ServiceBrowser(self._zc, SERVICE_TYPE, handlers=[self._on_change])

    def stop(self):
        if self._browser:
            self._browser.cancel()
        if self._service_info:
            self._zc.unregister_service(self._service_info)
        self._zc.close()

    def _on_change(self, zeroconf, service_type, name, state_change):
        if state_change.name == "Removed":
            self._del(name)
        else:
            info = zeroconf.get_service_info(service_type, name)
            if info:
                self._add(name, info)

    def _del(self, name):
        prefix = name.split(".")[0]
        with self._lock:
            self._peers.pop(prefix, None)

    def _add(self, name, info):
        prefix = name.split(".")[0]
        if prefix == self._own_id:
            return
        props = {}
        if info.properties:
            for k, v in info.properties.items():
                key = k.decode() if isinstance(k, bytes) else k
                val = v.decode() if isinstance(v, bytes) else v
                props[key] = val
        host = _extract_ip(info)
        if not host:
            return
        with self._lock:
            self._peers[prefix] = {
                "instance_id": props.get("instance_id", prefix),
                "display_name": props.get("display_name", "Unknown"),
                "host": host,
                "port": info.port,
            }

    def get_peers(self):
        with self._lock:
            return list(self._peers.values())

    def get_peer(self, instance_id):
        with self._lock:
            return self._peers.get(instance_id)

    def refresh_name(self):
        identity = get_or_create_identity()
        if self._service_info:
            self._zc.update_service(self._service_info)

    def has_peers(self):
        with self._lock:
            return len(self._peers) > 0


def send_status_update(host, port, task_id, status, from_instance):
    url = f"http://{host}:{port}/peer/status-update"
    data = json.dumps({
        "task_id": task_id,
        "status": status,
        "from_instance": from_instance,
    }).encode()
    req = Request(url, data=data, headers={"Content-Type": "application/json"})
    with urlopen(req, timeout=5) as resp:
        return json.loads(resp.read())
```

- [ ] **Step 3: Commit**

```bash
git add peer.py
git commit -m "feat: add LAN peer discovery module via mDNS"
```

---

### Task 3: Update Dependencies

**Files:**
- Modify: `requirements.txt`

- [ ] **Step 1: Add zeroconf to requirements.txt**

Current: `flask>=3.0`

Replace with:
```
flask>=3.0
zeroconf>=0.130
```

- [ ] **Step 2: Commit**

```bash
git add requirements.txt
git commit -m "chore: add zeroconf dependency"
```

---

### Task 4: Update Task Model

**Files:**
- Modify: `models.py`

- [ ] **Step 1: Add fields to Task dataclass**

After `color: Optional[str] = None` add two fields:

```python
assigned_by: Optional[dict] = None
assigned_to: Optional[dict] = None
```

The full dataclass:

```python
@dataclass
class Task:
    id: str
    name: str
    created_at: str
    description: str = ""
    deadline: Optional[str] = None
    started_at: Optional[str] = None
    updated_at: Optional[str] = None
    completed_at: Optional[str] = None
    priority: str = "medium"
    status: str = "pending"
    color: Optional[str] = None
    assigned_by: Optional[dict] = None
    assigned_to: Optional[dict] = None
```

The `from_dict` classmethod filters to `__dataclass_fields__`, so old tasks without these fields load fine (they get the defaults).

- [ ] **Step 2: Verify**

```bash
cd /Users/didi/thoughts-lab/taskDone && .venv/bin/python -c "
from models import Task
t = Task(id='x', name='x', created_at='2026-01-01T00:00:00',
         assigned_by={'instance_id':'abc','display_name':'Alice'})
assert t.to_dict()['assigned_by'] == {'instance_id':'abc','display_name':'Alice'}
old = Task.from_dict({'id':'x','name':'x','created_at':'2026-01-01T00:00:00'})
assert old.assigned_by is None
assert old.assigned_to is None
print('OK')
"
```

- [ ] **Step 3: Commit**

```bash
git add models.py
git commit -m "feat: add assignment fields to Task model"
```

---

### Task 5: Server Routes (`server.py`)

**Files:**
- Modify: `server.py`

- [ ] **Step 1: Update imports at top of server.py**

Replace the existing imports block (lines 1-10):

```python
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
from peer import PeerRegistry, send_status_update
```

- [ ] **Step 2: Extract PORT to module level, init identity and peers**

Replace the current `app = Flask(...)` and `storage = TaskStorage()` lines (lines 12-13):

```python
PORT = int(os.environ.get("PORT", 8080))

app = Flask(__name__, static_folder="web", static_url_path="")
storage = TaskStorage()
identity = get_or_create_identity()
peer_registry = PeerRegistry(identity["instance_id"], PORT)
```

- [ ] **Step 3: Add new API routes**

Insert these routes before the existing `if __name__ == "__main__"` block (before line 134):

```python
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
        "host": _local_ip(),
        "port": PORT,
    }

    try:
        payload = json_lib.dumps({
            "from_instance": ident["instance_id"],
            "from_display": ident["display_name"],
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
    task_data["assigned_by"] = {
        "instance_id": data.get("from_instance", ""),
        "display_name": data.get("from_display", "Unknown"),
        "host": request.remote_addr,
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

    now = _now()
    if new_status == "processing" and not task.started_at:
        task.started_at = now
    elif new_status == "done" and not task.completed_at:
        task.completed_at = now

    task.status = new_status
    task.updated_at = now
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
```

- [ ] **Step 4: Add status sync to move_task**

In the existing `move_task` function (line 116), after `task.updated_at = _now()` (line 129), before `storage.save_task(task)` (line 130), add:

```python
    if task.assigned_by and task.assigned_by.get("host"):
        try:
            send_status_update(
                task.assigned_by["host"],
                task.assigned_by.get("port", 8080),
                task.id,
                new_status,
                get_or_create_identity()["instance_id"],
            )
        except Exception:
            pass
```

The complete move_task function becomes:

```python
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
        except Exception:
            pass
    storage.save_task(task)
    return jsonify(task.to_dict())
```

- [ ] **Step 5: Update the main block to start discovery**

Replace the existing `if __name__ == "__main__"` block (lines 134-136):

```python
if __name__ == "__main__":
    peer_registry.start()
    try:
        app.run(host="0.0.0.0", port=PORT, debug=False)
    finally:
        peer_registry.stop()
```

- [ ] **Step 6: Add _local_ip helper to server.py**

The `assign_task` function needs the local IP. Add this helper after `_now()` (or import from peer.py). Since `_local_ip` is defined in `peer.py` but not exported, let's just add a small inline helper or import it.

Add to server.py's import from peer:

```python
from peer import PeerRegistry, send_status_update, _local_ip
```

But `_local_ip` is private in peer.py. Let's make it public. Edit the import in server.py to:

```python
from peer import PeerRegistry, send_status_update
import socket as _socket
```

And add this helper inside server.py after `_now()`:

No — the cleanest approach: the `assign_task` route can get the local IP from peer_registry or just use the peer module. Let's just add `_local_ip` as a public export from peer.py.

Actually, looking at the assign flow again: the assigned_by on the receiver needs host and port so they can call back. The `assign_task` sends `task_dict` which already has `assigned_by` set from the assigner's side. But wait — the assigner sets `assigned_by` in the task_dict they send. The receiver gets it in `peer_assign`. So the assigner needs its own IP.

Simplest fix: export `_local_ip` from peer.py as a public function.

In peer.py, rename `_local_ip` to `local_ip` (remove underscore).

Then in server.py import:

```python
from peer import PeerRegistry, send_status_update, local_ip
```

And in `assign_task`, use it:

```python
    task_dict["assigned_by"] = {
        "instance_id": ident["instance_id"],
        "display_name": ident["display_name"],
        "host": local_ip(),
        "port": PORT,
    }
```

Let me update the plan to reflect this.

- [ ] **Step 6: Commit**

```bash
git add server.py peer.py
git commit -m "feat: add peer API routes and status sync to server"
```

---

### Task 6: Frontend — HTML (`web/index.html`)

**Files:**
- Modify: `web/index.html`

- [ ] **Step 1: Add peers bar after header**

After the closing `</header>` tag (line 16), add:

```html
        <div id="peers-bar" class="peers-bar">
            <span id="peers-self"></span>
            <span id="peers-list"></span>
            <span class="peers-none" id="peers-none">No one else online</span>
        </div>
```

- [ ] **Step 2: Add assign button in detail modal**

Inside the task detail modal, after the `<div id="task-detail-content"></div>` (line 46), before `<div class="form-actions">`, add:

```html
            <div id="assign-section" class="assign-section hidden">
                <select id="assign-target" class="assign-select">
                    <option value="">Assign to...</option>
                </select>
                <button id="assign-confirm-btn">Assign</button>
            </div>
```

- [ ] **Step 3: Commit**

```bash
git add web/index.html
git commit -m "feat: add peers bar and assign UI to HTML"
```

---

### Task 7: Frontend — CSS (`web/styles.css`)

**Files:**
- Modify: `web/styles.css`

- [ ] **Step 1: Add new styles**

Append to the end of `styles.css`:

```css
/* Peers bar */
.peers-bar {
    display: flex; align-items: center; gap: 8px;
    padding: 6px 10px; margin-bottom: 14px;
    background: var(--surface); border: 1px solid var(--border);
    border-radius: var(--radius); font-size: 0.78rem;
    flex-wrap: wrap; min-height: 30px;
}
.peers-bar .peers-label { color: var(--muted); font-weight: 500; }
.peers-bar .peer-tag {
    padding: 2px 8px; border-radius: 10px;
    background: var(--bg); border: 1px solid var(--border);
    cursor: pointer; transition: background 0.12s;
    white-space: nowrap;
}
.peers-bar .peer-tag:hover { background: #e8e8e8; }
.peers-bar .peer-tag.selected {
    background: var(--accent); color: #fff; border-color: var(--accent);
}
.peers-bar .peer-tag.self {
    font-weight: 600; cursor: default; border-color: var(--accent);
}
.peers-bar .peer-edit {
    cursor: pointer; color: var(--muted); font-size: 0.7rem;
    margin-left: 2px;
}
.peers-bar .peer-edit:hover { color: var(--text); }
.peers-bar .peers-none { color: var(--muted); font-style: italic; }

.peer-name-input {
    width: 100px; padding: 1px 6px; font-size: 0.78rem;
    border: 1px solid var(--accent); border-radius: 4px;
    background: var(--surface);
}

/* Assignment */
.assign-section {
    padding: 10px 0; border-top: 1px solid var(--border);
    margin-top: 8px; display: flex; gap: 6px; align-items: center;
}
.assign-section.hidden { display: none; }
.assign-select {
    flex: 1; padding: 6px 8px; border: 1px solid var(--border);
    border-radius: 4px; font-size: 0.82rem; background: var(--bg);
}
#assign-confirm-btn {
    padding: 6px 12px; border: 1px solid var(--accent);
    border-radius: 4px; background: var(--accent); color: #fff;
    cursor: pointer; font-size: 0.82rem;
}
#assign-confirm-btn:hover { background: #555; }

/* Task card assignment badges */
.task-card.assigned-to-me {
    border-left: 3px solid #6c5ce7;
}
.task-card.assigned-out {
    opacity: 0.55;
}
.task-card .assign-badge {
    font-size: 0.65rem; padding: 1px 5px; border-radius: 3px;
    display: inline-block; margin-top: 2px;
}
.task-card .assign-badge.from { background: #f0edff; color: #6c5ce7; }
.task-card .assign-badge.to { background: #f5f5f5; color: var(--muted); }
```

- [ ] **Step 2: Commit**

```bash
git add web/styles.css
git commit -m "feat: add peers bar and assignment styles"
```

---

### Task 8: Frontend — JavaScript (`web/app.js`)

**Files:**
- Modify: `web/app.js`

- [ ] **Step 1: Add state and DOM refs**

After `let dragData = null;` (line 11), add:

```javascript
    let peers = { self: null, peers: [] };
    let selectedPeerId = null;
```

Add to `els` object (after `closeFullscreen: $('close-fullscreen')`):

```javascript
        peersBar: $('peers-bar'), peersSelf: $('peers-self'),
        peersList: $('peers-list'), peersNone: $('peers-none'),
        assignSection: $('assign-section'), assignTarget: $('assign-target'),
        assignConfirmBtn: $('assign-confirm-btn'),
```

- [ ] **Step 2: Add peers polling function**

After `loadAllTasks()` (line 65), add:

```javascript
    async function loadPeers() {
        try {
            const data = await apiGet('/api/peers');
            peers.self = data.self;
            peers.peers = data.peers;
        } catch (e) { peers.peers = []; }
        renderPeers();
    }

    function renderPeers() {
        if (!peers.peers.length) {
            els.peersNone.style.display = '';
            els.peersList.innerHTML = '';
        } else {
            els.peersNone.style.display = 'none';
            els.peersList.innerHTML = peers.peers.map(p =>
                '<span class="peer-tag' + (selectedPeerId === p.instance_id ? ' selected' : '') + '" data-peer-id="' + p.instance_id + '">' + esc(p.display_name) + '</span>'
            ).join(' | ');
        }

        const myself = peers.self;
        els.peersSelf.innerHTML = '<span class="peer-tag self">' + esc(myself ? myself.display_name : 'You')
            + '<span class="peer-edit" id="peer-name-edit">&#9998;</span></span> ';

        const editBtn = $('peer-name-edit');
        if (editBtn) {
            editBtn.addEventListener('click', e => {
                e.stopPropagation();
                startNameEdit();
            });
        }

        document.querySelectorAll('#peers-list .peer-tag').forEach(tag => {
            tag.addEventListener('click', () => {
                const pid = tag.dataset.peerId;
                selectedPeerId = selectedPeerId === pid ? null : pid;
                renderPeers();
            });
        });
    }

    function startNameEdit() {
        const selfTag = els.peersSelf.querySelector('.peer-tag.self');
        const current = peers.self ? peers.self.display_name : 'You';
        selfTag.innerHTML = '<input class="peer-name-input" id="peer-name-input" value="' + esc(current) + '">';
        const input = $('peer-name-input');
        input.focus(); input.select();
        input.addEventListener('blur', () => finishNameEdit(input.value));
        input.addEventListener('keydown', e => { if (e.key === 'Enter') finishNameEdit(input.value); });
    }

    async function finishNameEdit(name) {
        if (!name.trim()) { renderPeers(); return; }
        try {
            await apiPost('/api/identity/name', { name: name.trim() });
            await loadPeers();
        } catch (e) { renderPeers(); }
    }
```

- [ ] **Step 3: Add assign flow**

After `finishNameEdit`, add:

```javascript
    function updateAssignUI() {
        if (!selectedTaskId || !peers.peers.length) {
            els.assignSection.classList.add('hidden');
            return;
        }
        const task = tasks.find(t => t.id === selectedTaskId);
        if (!task || task.assigned_to) {
            els.assignSection.classList.add('hidden');
            return;
        }
        els.assignSection.classList.remove('hidden');
        els.assignTarget.innerHTML = '<option value="">Assign to...</option>'
            + peers.peers.map(p => '<option value="' + p.instance_id + '">' + esc(p.display_name) + '</option>').join('');
    }
```

- [ ] **Step 4: Update showDetail to call updateAssignUI**

In `showDetail`, after `els.detailModal.classList.remove('hidden');` (line 361), add:

```javascript
        updateAssignUI();
```

- [ ] **Step 5: Update cardHtml to show assignment badges**

Replace the existing `cardHtml` function (lines 273-281) with:

```javascript
    function cardHtml(task) {
        const desc = task.description
            ? '<div class="task-meta">' + esc(task.description.substring(0, 35) + (task.description.length > 35 ? '...' : '')) + '</div>'
            : '';
        const dl = task.deadline ? '<div class="task-meta" style="color:' + (new Date(task.deadline) < Date.now() && task.status !== 'done' ? 'var(--high)' : 'var(--muted)') + '">DL: ' + task.deadline + '</div>' : '';

        let badge = '';
        let extraClass = '';
        if (task.assigned_by) {
            extraClass = ' assigned-to-me';
            badge = '<span class="assign-badge from">From ' + esc(task.assigned_by.display_name || '?') + '</span>';
        } else if (task.assigned_to) {
            extraClass = ' assigned-out';
            badge = '<span class="assign-badge to">→ ' + esc(task.assigned_to.display_name || '?') + '</span>';
        }

        return '<div class="task-card priority-' + task.priority + extraClass + '" draggable="true" data-task-id="' + task.id + '">'
            + '<span class="priority-dot"></span><span class="task-name">' + esc(task.name) + '</span>'
            + badge + desc + dl + '</div>';
    }
```

- [ ] **Step 6: Add assign button handler in bindEvents**

In `bindEvents`, after the delete button handler (after line 455, `els.deleteTaskBtn.addEventListener(...)`):

```javascript
        els.assignConfirmBtn.addEventListener('click', async () => {
            const toInstance = els.assignTarget.value;
            if (!toInstance || !selectedTaskId) return;
            try {
                await apiPost('/api/tasks/' + selectedTaskId + '/assign', { to_instance: toInstance });
                els.detailModal.classList.add('hidden');
                selectedPeerId = null;
                await loadAllTasks(); initSlider(); await loadTasks();
                renderPeers();
            } catch (e) { alert('Failed to assign: ' + e.message); }
        });
```

- [ ] **Step 7: Start peers polling in init**

In `init()` (line 58), add after `initSlider();`:

```javascript
        await loadPeers();
        setInterval(loadPeers, 5000);
```

- [ ] **Step 8: Commit**

```bash
git add web/app.js
git commit -m "feat: add peers polling, assign flow, and assignment badges to frontend"
```

---

### Task 9: Integration Verification

- [ ] **Step 1: Start instance A**

```bash
cd /Users/didi/thoughts-lab/taskDone && PORT=8080 .venv/bin/python server.py &
sleep 2
curl -s http://localhost:8080/api/identity | python -m json.tool
```

- [ ] **Step 2: Start instance B (with separate data dir)**

```bash
cd /tmp && mkdir -p taskdone_b/tasks && cp /Users/didi/thoughts-lab/taskDone/tasks/.instance.json /tmp/taskdone_b/tasks/ 2>/dev/null; true
# Need to run from a copy or symlink the code — for testing, just use a different port with same code
# Actually, the simplest test uses a second terminal:
cd /Users/didi/thoughts-lab/taskDone && TASKS_DIR=/tmp/taskdone_b/tasks PORT=8081 .venv/bin/python server.py &
```

Wait — the storage path is hardcoded as `tasks/tasks.json` relative to CWD. Running from the same dir with the same PORT env won't conflict because the port is different, but they'd share the same tasks.json. For a proper test, we need separate data.

Simpler approach: test one instance at a time, verifying the API endpoints work:

```bash
# Start one instance
cd /Users/didi/thoughts-lab/taskDone && PORT=8080 .venv/bin/python server.py &
sleep 2

# Test identity endpoints
curl -s http://localhost:8080/api/identity
echo ""
curl -s -X POST http://localhost:8080/api/identity/name -H 'Content-Type: application/json' -d '{"name":"TestAlice"}'
echo ""

# Test peers endpoint (should show self with no peers on single machine)
curl -s http://localhost:8080/api/peers
echo ""

# Create a task
curl -s -X POST http://localhost:8080/api/tasks -H 'Content-Type: application/json' -d '{"name":"Test task","priority":"medium"}'
echo ""

# Test peer/assign (simulating an incoming assignment)
TASK_ID=$(curl -s http://localhost:8080/api/tasks | python -c "import sys,json; print(json.load(sys.stdin)[0]['id'])")
echo "Task ID: $TASK_ID"

curl -s -X POST http://localhost:8080/peer/assign -H 'Content-Type: application/json' -d "{\"from_instance\":\"test123\",\"from_display\":\"Bob\",\"task\":{\"id\":\"assigned-1\",\"name\":\"From Bob\",\"created_at\":\"2026-05-19T10:00:00\",\"priority\":\"high\",\"status\":\"pending\"}}"
echo ""

# Verify the assigned task appears
curl -s http://localhost:8080/api/tasks | python -c "import sys,json; tasks=json.load(sys.stdin); [print(t['name'], t.get('assigned_by')) for t in tasks]"

# Kill server
kill %1
```

- [ ] **Step 2: Run the verification commands above**

Expected output:
- Identity returns `instance_id` and `display_name`
- Name change works and returns updated display_name
- Peers returns self info
- Task creation works
- Peer assign creates a task with `assigned_by` set
- Listing tasks shows both the created task and the assigned task

- [ ] **Step 3: Open browser and verify UI**

Start the server and open http://localhost:8080. Verify:
- Peers bar shows "You" with edit icon
- Clicking edit icon allows name change
- When another instance is on the LAN, it appears in the peers bar
- Task detail modal shows assign section when peers are online

- [ ] **Step 4: Commit any final tweaks**

```bash
git status
git diff
```