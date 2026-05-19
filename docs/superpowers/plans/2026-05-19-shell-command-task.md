# Shell Command Task Type — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `script` task type carrying a shell command that the assigned peer can execute with one click.

**Architecture:** Extend Task dataclass with `type`, `shell_command`, `shell_result` fields; add `/api/tasks/<id>/execute` endpoint; add type-switcher tabs in the add-task modal; render script tasks with terminal icon and Execute button in detail view.

**Tech Stack:** Python (Flask, subprocess, dataclasses), vanilla JS, CSS

---

### Task 1: Add type/shell_command/shell_result to Task dataclass

**Files:**
- Modify: `models.py`

- [ ] **Step 1: Add the three new fields to the Task dataclass**

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
    type: str = "normal"
    shell_command: Optional[str] = None
    shell_result: Optional[dict] = None
    color: Optional[str] = None
    assigned_by: Optional[dict] = None
    assigned_to: Optional[dict] = None

    def __post_init__(self):
        if self.color is None and self.type == "normal":
            self.color = PRIORITY_COLORS.get(Priority(self.priority), "#888888")
```

- [ ] **Step 2: Verify the model loads correctly**

```bash
.venv/bin/python -c "from models import Task; t = Task(id='x', name='test', created_at='2026-01-01', type='script', shell_command='echo hi'); print(t.to_dict())"
```

Expected output includes `"type": "script"`, `"shell_command": "echo hi"`, `"shell_result": null`, `"color": null`.

- [ ] **Step 3: Commit**

```bash
git add models.py
git commit -m "feat: add type, shell_command, shell_result to Task model

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 2: Accept type/shell_command in server create and update

**Files:**
- Modify: `server.py:61-83` (create_task), `server.py:86-114` (update_task)

- [ ] **Step 1: Update create_task to accept type and shell_command**

Replace the `Task(...)` construction in `create_task()` (lines 72-81):

```python
    task_type = data.get("type", "normal")
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
```

- [ ] **Step 2: Update update_task to accept type, shell_command, shell_result**

Replace the field list in `update_task()` (line 96-97):

```python
    for field in ("name", "description", "deadline", "priority",
                  "created_at", "started_at", "updated_at", "completed_at",
                  "type", "shell_command", "shell_result"):
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
```

- [ ] **Step 3: Update color logic in update_task to skip for script tasks**

Replace the priority/color block (lines 108-109):

```python
    if "priority" in data and task.type == "normal":
        task.color = PRIORITY_COLORS.get(Priority(task.priority), "#888888")
```

- [ ] **Step 4: Test create and update**

```bash
# Create a script task
curl -s -X POST http://localhost:8080/api/tasks \
  -H "Content-Type: application/json" \
  -d '{"name":"deploy","type":"script","shell_command":"echo hello"}' | python3 -m json.tool

# Verify it was created
curl -s http://localhost:8080/api/tasks | python3 -c "import sys,json; tasks=json.load(sys.stdin); print([t['type'] for t in tasks])"
```

Expected: last task has `"type": "script"`, `"shell_command": "echo hello"`, no description/deadline.

- [ ] **Step 5: Commit**

```bash
git add server.py
git commit -m "feat: accept type and shell_command in create/update endpoints

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 3: Add POST /api/tasks/<id>/execute endpoint

**Files:**
- Modify: `server.py` (after move_task endpoint, before identity endpoint)

- [ ] **Step 1: Add import for subprocess at top of server.py**

```python
import subprocess
```

Add after line 8 (`from datetime import datetime`):

```python
import subprocess
```

- [ ] **Step 2: Add the execute endpoint**

Insert after the `move_task` function (after line 151):

```python
@app.route("/api/tasks/<task_id>/execute", methods=["POST"])
def execute_task(task_id):
    task = storage.get_task(task_id)
    if task is None:
        return jsonify({"error": "Task not found"}), 404

    if task.type != "script" or not task.shell_command:
        return jsonify({"error": "Not a script task"}), 400

    ident = get_or_create_identity()
    if not task.assigned_to or task.assigned_to.get("instance_id") != ident["instance_id"]:
        return jsonify({"error": "Not assigned to you"}), 403

    if task.shell_result:
        return jsonify({"error": "Already executed"}), 409

    try:
        result = subprocess.run(
            task.shell_command, shell=True,
            capture_output=True, text=True, timeout=30
        )
    except subprocess.TimeoutExpired:
        return jsonify({"error": "Command timed out after 30s"}), 504
    except Exception as e:
        return jsonify({"error": str(e)}), 500

    task.shell_result = {
        "exit_code": result.returncode,
        "stdout": result.stdout[-5000:],
        "stderr": result.stderr[-5000:],
        "executed_at": _now(),
    }

    if result.returncode == 0:
        task = storage.move_task(task_id, "done")
        task.completed_at = _now()

    task.updated_at = _now()
    storage.save_task(task)
    return jsonify(task.to_dict())
```

- [ ] **Step 3: Test execute endpoint**

```bash
# First create a script task
TASK=$(curl -s -X POST http://localhost:8080/api/tasks \
  -H "Content-Type: application/json" \
  -d '{"name":"test-exec","type":"script","shell_command":"echo hello && exit 0"}')
TASK_ID=$(echo $TASK | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")

# Try executing without being assigned (should fail 403)
curl -s -X POST http://localhost:8080/api/tasks/$TASK_ID/execute | python3 -m json.tool
# Expected: {"error": "Not assigned to you"}

# Test with a failing command
curl -s -X POST http://localhost:8080/api/tasks \
  -H "Content-Type: application/json" \
  -d '{"name":"fail-test","type":"script","shell_command":"exit 1"}' > /dev/null
```

All validation errors should return proper JSON.

- [ ] **Step 4: Commit**

```bash
git add server.py
git commit -m "feat: add POST /api/tasks/<id>/execute endpoint

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 4: Add type-switcher tabs to the add-task modal

**Files:**
- Modify: `web/index.html:49-82`

- [ ] **Step 1: Replace the add-task form with type-switcher version**

Replace the entire add-task modal (lines 49-82):

```html
    <!-- Add Task Modal -->
    <div id="add-task-modal" class="modal hidden">
        <div class="modal-content">
            <h2>New Task</h2>
            <div class="type-tabs">
                <button type="button" class="type-tab active" data-type="normal" id="tab-normal">Task</button>
                <button type="button" class="type-tab" data-type="script" id="tab-script">Script</button>
            </div>
            <form id="add-task-form">
                <input type="hidden" id="task-type" value="normal">
                <div class="form-group">
                    <input type="text" id="task-name" placeholder="Task name" required>
                </div>
                <div class="form-group normal-only">
                    <textarea id="task-description" rows="3" placeholder="Description (optional)"></textarea>
                </div>
                <div class="form-group script-only hidden">
                    <input type="text" id="task-command" placeholder="Shell command, e.g. bash deploy.sh">
                </div>
                <div class="form-group normal-only">
                    <input type="date" id="task-deadline">
                </div>
                <div class="form-group normal-only">
                    <select id="task-priority">
                        <option value="low">Low</option>
                        <option value="medium" selected>Medium</option>
                        <option value="high">High</option>
                    </select>
                </div>
                <div class="form-group" id="add-assign-group">
                    <div class="multi-select" id="task-assign">
                        <div class="multi-select-trigger" id="task-assign-trigger">Assign to...</div>
                        <div class="multi-select-drop" id="task-assign-drop"></div>
                    </div>
                </div>
                <div class="form-actions">
                    <button type="button" id="cancel-add">Cancel</button>
                    <button type="submit">Add</button>
                </div>
            </form>
        </div>
    </div>
```

- [ ] **Step 2: Commit**

```bash
git add web/index.html
git commit -m "feat: add type-switcher tabs to add-task modal

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 5: Add script task styling (type tabs, code block, execute button)

**Files:**
- Modify: `web/styles.css`

- [ ] **Step 1: Add styles for type-switcher tabs, script icon, code block, execute button**

Append before the `@media` query (before line 263):

```css
/* Type switcher tabs */
.type-tabs {
    display: flex; gap: 0; margin-bottom: 14px;
    border: 1px solid var(--border); border-radius: var(--radius);
    overflow: hidden;
}
.type-tab {
    flex: 1; padding: 7px 0; border: none; background: var(--bg);
    font-size: 0.82rem; cursor: pointer; color: var(--muted);
    font-family: inherit; text-align: center;
}
.type-tab.active { background: var(--accent); color: #fff; }
.normal-only.hidden, .script-only.hidden { display: none; }

/* Script icon on cards */
.script-icon {
    display: inline-block; width: 16px; text-align: center;
    margin-right: 4px; color: var(--muted); font-size: 0.75rem;
    font-family: monospace; vertical-align: middle;
}

/* Shell command code block */
.code-block {
    background: #1e1e1e; color: #d4d4d4; padding: 10px 12px;
    border-radius: 4px; font-family: 'SF Mono', Menlo, monospace;
    font-size: 0.82rem; margin: 6px 0; word-break: break-all;
    white-space: pre-wrap;
}

/* Execute result */
.exec-result { margin: 6px 0; padding: 10px; border-radius: 4px; }
.exec-result .result-label { font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.3px; margin-bottom: 4px; }
.exec-result.stdout { background: #eaf5ea; }
.exec-result.stdout .result-label { color: #27ae60; }
.exec-result.stderr { background: #fef0ef; }
.exec-result.stderr .result-label { color: #e74c3c; }
.exec-result pre { font-size: 0.8rem; white-space: pre-wrap; word-break: break-word; max-height: 200px; overflow-y: auto; }

/* Execute button */
.btn-execute {
    padding: 6px 12px; border: 1px solid var(--accent);
    border-radius: 4px; background: var(--accent); color: #fff;
    cursor: pointer; font-size: 0.82rem; font-family: inherit;
}
.btn-execute:hover { background: #555; }
```

- [ ] **Step 2: Commit**

```bash
git add web/styles.css
git commit -m "feat: add script task and type-switcher styles

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 6: Wire up type-switcher and script task logic in app.js

**Files:**
- Modify: `web/app.js`

- [ ] **Step 1: Add new DOM element references to the `els` object**

After `taskAssign` line (after line 46):

```javascript
        taskType: $('task-type'), taskCommand: $('task-command'),
        tabNormal: $('tab-normal'), tabScript: $('tab-script'),
```

- [ ] **Step 2: Update showAdd() to reset type tab and fields**

Replace `showAdd()` (lines 521-526):

```javascript
    function showAdd() {
        els.taskName.value = ''; els.taskDesc.value = '';
        els.taskDeadline.value = ''; els.taskPriority.value = 'medium';
        els.taskCommand.value = '';
        switchType('normal');
        buildMultiSelect(els.taskAssignTrigger, els.taskAssignDrop, peers.peers);
        els.addTaskModal.classList.remove('hidden'); els.taskName.focus();
    }
```

- [ ] **Step 3: Add switchType() helper and tab click handlers**

Insert after `buildMultiSelect` / `getCheckedPeers` (after the `getCheckedPeers` function):

```javascript
    function switchType(type) {
        els.taskType.value = type;
        els.tabNormal.classList.toggle('active', type === 'normal');
        els.tabScript.classList.toggle('active', type === 'script');
        document.querySelectorAll('.normal-only').forEach(el => el.classList.toggle('hidden', type === 'script'));
        document.querySelectorAll('.script-only').forEach(el => el.classList.toggle('hidden', type === 'normal'));
        els.taskName.placeholder = type === 'script' ? 'Label, e.g. deploy staging' : 'Task name';
    }
```

- [ ] **Step 4: Update add-task form submit handler**

Replace the submit handler (lines 546-554):

```javascript
        els.addTaskForm.addEventListener('submit', async e => {
            e.preventDefault();
            const name = els.taskName.value.trim();
            if (!name) return;
            const taskType = els.taskType.value;
            const payload = { name, type: taskType };
            if (taskType === 'script') {
                payload.shell_command = els.taskCommand.value.trim();
            } else {
                payload.description = els.taskDesc.value.trim();
                payload.deadline = els.taskDeadline.value || null;
                payload.priority = els.taskPriority.value;
            }
            const task = await apiPost('/api/tasks', payload);
            const targets = getCheckedPeers(els.taskAssignDrop);
            for (const toInstance of targets) {
                try { await apiPost('/api/tasks/' + task.id + '/assign', { to_instance: toInstance }); }
                catch (err) { /* assign failed for one peer, continue */ }
            }
            hideAdd();
            await loadAllTasks(); initSlider(); await loadTasks();
        });
```

- [ ] **Step 5: Update cardHtml() to render script tasks with terminal icon**

Replace `cardHtml()` (lines 389-408):

```javascript
    function cardHtml(task) {
        if (task.type === 'script') {
            let badge = '';
            let extraClass = '';
            if (task.assigned_by) {
                extraClass = ' assigned-to-me';
                badge = '<span class="assign-badge from">From ' + esc(task.assigned_by.display_name || '?') + '</span>';
            } else if (task.assigned_to) {
                extraClass = ' assigned-out';
                badge = '<span class="assign-badge to">&rarr; ' + esc(task.assigned_to.display_name || '?') + '</span>';
            }
            return '<div class="task-card script-task' + extraClass + '" draggable="true" data-task-id="' + task.id + '">'
                + '<span class="script-icon">&gt;_</span><span class="task-name">' + esc(task.name) + '</span>'
                + badge + '</div>';
        }

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
            badge = '<span class="assign-badge to">&rarr; ' + esc(task.assigned_to.display_name || '?') + '</span>';
        }

        return '<div class="task-card priority-' + task.priority + extraClass + '" draggable="true" data-task-id="' + task.id + '">'
            + '<span class="priority-dot"></span><span class="task-name">' + esc(task.name) + '</span>'
            + badge + desc + dl + '</div>';
    }
```

- [ ] **Step 6: Update showDetail() to render script tasks with command and execute button**

Replace `showDetail()` detail content rendering (lines 473-479):

```javascript
        if (task.type === 'script' && task.shell_command) {
            let execHtml = '<p class="label">Command</p><div class="code-block">' + esc(task.shell_command) + '</div>';
            if (task.shell_result) {
                const r = task.shell_result;
                const exitLabel = r.exit_code === 0 ? 'Exit 0' : 'Exit ' + r.exit_code;
                execHtml += '<p class="label" style="margin-top:8px;">Result</p>';
                execHtml += '<div class="exec-result ' + (r.exit_code === 0 ? 'stdout' : 'stderr') + '">';
                execHtml += '<div class="result-label">' + exitLabel + ' - ' + (r.executed_at || '') + '</div>';
                if (r.stdout) execHtml += '<pre>' + esc(r.stdout) + '</pre>';
                if (r.stderr) execHtml += '<pre style="color:var(--high)">' + esc(r.stderr) + '</pre>';
                execHtml += '</div>';
            } else if (task.assigned_by && !task.assigned_to && task.status !== 'done') {
                execHtml += '<button class="btn-execute" id="execute-btn" style="margin-top:8px;">Execute</button>';
            }
            els.detailContent.innerHTML = '<p class="label">Type</p><p>Script</p>'
                + '<p class="label">Status</p><p>' + task.status.charAt(0).toUpperCase() + task.status.slice(1) + '</p>'
                + execHtml
                + '<p class="label" style="margin-top:8px;">Timeline</p>'
                + '<div class="timeline">' + timelineHtml + '</div>';

            const execBtn = $('execute-btn');
            if (execBtn) {
                execBtn.addEventListener('click', async () => {
                    if (!confirm('Run: ' + task.shell_command + '?')) return;
                    try {
                        await apiPost('/api/tasks/' + task.id + '/execute');
                        await loadAllTasks(); await loadTasks();
                        const updated = tasks.find(x => x.id === task.id);
                        if (updated) showDetail(updated.id);
                    } catch (err) { alert('Execute failed: ' + err.message); }
                });
            }
        } else {
            els.detailContent.innerHTML =
                '<p class="label">Status</p><p>' + task.status.charAt(0).toUpperCase() + task.status.slice(1) + '</p>'
                + '<p class="label">Priority</p><p>' + task.priority.charAt(0).toUpperCase() + task.priority.slice(1) + '</p>'
                + (task.description ? '<p class="label">Description</p><div class="desc-block" id="desc-block">' + esc(task.description) + '</div>' : '')
                + (task.deadline ? '<p class="label">Deadline</p><p>' + task.deadline + '</p>' : '')
                + '<p class="label" style="margin-top:8px;">Timeline</p>'
                + '<div class="timeline">' + timelineHtml + '</div>';

            const descBlock = $('desc-block');
            if (descBlock) {
                descBlock.addEventListener('click', () => showDescFullscreen(task));
            }
        }
```

- [ ] **Step 7: Add tab click handlers to bindEvents()**

Add after the multi-select toggle handlers (after the `document.addEventListener('click', ...)` block for multi-select closing):

```javascript
        els.tabNormal.addEventListener('click', () => switchType('normal'));
        els.tabScript.addEventListener('click', () => switchType('script'));
```

- [ ] **Step 8: Commit**

```bash
git add web/app.js
git commit -m "feat: wire up type-switcher and script task logic

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 7: End-to-end verification

- [ ] **Step 1: Restart server**

```bash
./scripts/control.sh restart
```

- [ ] **Step 2: Create a normal task and verify it renders**

Open http://localhost:8080, click "+", select "Task" tab, fill name, click Add.
Expected: task appears in grid with priority dot, description preview.

- [ ] **Step 3: Create a script task and verify it renders**

Click "+", switch to "Script" tab, enter name "deploy test" and command "echo deployed", click Add.
Expected: task appears in grid with `>_` icon, no priority dot, no description.

- [ ] **Step 4: Click script task and verify detail**

Click the script task card.
Expected: detail shows Type: Script, command in code block, no Execute button (not assigned yet).

- [ ] **Step 5: Assign to a peer and verify Execute button**

If a peer is available (e.g., oyungchen at 192.168.31.251), assign the task to them via the detail modal.
On the peer's machine, open the task detail.
Expected: Execute button should appear.

- [ ] **Step 6: Click Execute and verify result**

On the peer's machine, click Execute, confirm in dialog.
Expected: if exit_code=0, task moves to Done; stdout shown in green block. If exit_code≠0, task stays, stderr shown in red.

- [ ] **Step 7: Verify the original assigner's view**

On the assigner's machine, refresh.
Expected: task status updated (Done if success), but no shell result shown (only status sync).