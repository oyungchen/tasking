# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A **Task Management Tool** with a date×status grid view for managing tasks across three states: Pending, Processing, and Done.

## Architecture

### File Structure
- `server.py` - Flask API server, serves static files and REST endpoints
- `models.py` - Data models (`Task` dataclass, enums for status/priority)
- `storage.py` - JSON file-based persistence (`TaskStorage` class)
- `web/` - Frontend (index.html, app.js, styles.css)
- `scripts/control.sh` - Start/stop/restart launcher script

### Grid View Logic

The table has dates as rows and statuses as columns. A task's row is determined by its effective date:
- **Pending** → `created_at`
- **Processing** → `updated_at`
- **Done** → `completed_at`

Drag and drop is bidirectional:
- **Horizontal** → changes status (calls PATCH move)
- **Vertical** → changes the effective date field (calls PUT)

### Data Storage
Tasks are stored in a single JSON file: `tasks/tasks.json`

Each task has: id, name, description, deadline, created_at, started_at, updated_at, completed_at, priority, status, color

### API Endpoints
- `GET /api/tasks` - List tasks (optional `?start=&end=` date filters)
- `POST /api/tasks` - Create task
- `PUT /api/tasks/<id>` - Update task (also handles date field changes for vertical drag)
- `DELETE /api/tasks/<id>` - Delete task
- `PATCH /api/tasks/<id>/move` - Move task to new status

## Running the Application

```bash
# Install dependencies
.venv/bin/pip install -r requirements.txt

# Start the server
.venv/bin/python server.py

# Or use the launcher script
./scripts/control.sh start
```

Open http://localhost:8080 in your browser.

## Requirements

- Python 3.x
- Flask (`flask>=3.0`)