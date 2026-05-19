# Shell Command Task Type

Date: 2026-05-19

## Summary

Add a `script` task type alongside the existing `normal` type. Script tasks carry a shell command that the assigned peer can execute with one click. Execution output stays local; only task status changes sync back to the assigner.

## Model Changes

### Task dataclass (`models.py`)

Two new fields:

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| `type` | `str` | `"normal"` | `"normal"` or `"script"` |
| `shell_command` | `Optional[str]` | `None` | Only meaningful for script tasks |
| `shell_result` | `Optional[dict]` | `None` | `{exit_code, stdout, stderr, executed_at}`, local only |

No change to existing fields. `color` computation skips for script tasks (no priority).

### Script task constraints

- No `description`, no `deadline`, no `priority` — these fields stay `""` / `None` / `"medium"` defaults
- `name` serves as a label/tag for the command
- Card displays terminal icon `>_` instead of priority dot

## API Changes

### `POST /api/tasks` — accept `type` and `shell_command`

```json
{
  "name": "deploy staging",
  "type": "script",
  "shell_command": "bash /home/user/deploy.sh"
}
```

Script tasks ignore `description`, `deadline`, `priority` from the payload.

### `PUT /api/tasks/<id>` — accept `type` and `shell_command`

Same update semantics.

### `POST /api/tasks/<id>/execute` — NEW

Only callable by the assigned peer. Validates `task.assigned_to.instance_id` matches caller.

Implementation:
```python
result = subprocess.run(
    task.shell_command, shell=True,
    capture_output=True, text=True, timeout=30
)
task.shell_result = {
    "exit_code": result.returncode,
    "stdout": result.stdout[-5000:],
    "stderr": result.stderr[-5000:],
    "executed_at": _now()
}
```

On success (exit_code=0): auto-move task to `done`, set `completed_at`.
On failure (exit_code≠0): task stays in current status, result is stored for local display.

### `/peer/status-update` — NO changes

Shell results are never transmitted between peers. Only status changes flow through the existing mechanism.

## Frontend Changes

### New Task Modal

Type switcher at the top: two tabs/buttons — "Task" (default) and "Script".

**Normal tab**: name, description, deadline, priority (unchanged).

**Script tab**: name (label), shell command input, no description/deadline/priority fields.

### Task Cards

Script tasks: terminal icon `>_` replaces priority dot. No description preview. No priority class.

```html
<span class="script-icon">>_</span>
```

### Task Detail

Script tasks show:
- Command in a styled code block
- If `assigned_to` is me AND no result yet: **Execute** button
- After execution: stdout block (green if exit 0), stderr block (red if exit ≠ 0)

Normal tasks: unchanged.

### Execute Flow

1. Click Execute → `confirm("Run: <command>?")` 
2. OK → `POST /api/tasks/<id>/execute`
3. Reload task detail → show result
4. If exit_code=0 → task moves to Done column (via move endpoint internally)
5. Status change propagates to assigner via existing `/peer/status-update`

## Security

- Only the assigned peer can execute (server validates `assigned_to.instance_id`)
- Confirmation dialog before execution
- 30-second timeout prevents hung processes
- Output truncated to 5000 chars to prevent memory issues
- No shell command can execute without explicit user approval in UI
- Shell results never leave the executing machine

## Files Touched

| File | Change |
|------|--------|
| `models.py` | Add `type`, `shell_command`, `shell_result` fields |
| `server.py` | Accept fields in create/update; add `/execute` endpoint |
| `web/index.html` | Type switcher in add-task modal; execute section in detail modal |
| `web/app.js` | Type toggle logic; script task rendering; execute handler |
| `web/styles.css` | Script icon, code block, execute button styling |