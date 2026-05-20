# Task Manager

A collaborative task management tool with a date×status grid view and LAN peer-to-peer task sharing.

## Features

- **Date×Status Grid** — Tasks organized by date (rows) and status columns (Pending, Processing, Done)
- **Drag & Drop** — Horizontal drag changes status; vertical drag changes the effective date
- **Date Range Slider** — Filter tasks by date range with an interactive slider
- **Two Task Types**:
  - **Normal** — Description, deadline, priority (High/Medium/Low) with color coding
  - **Script** — Shell command tasks that can be executed and show exit code/output
- **LAN Peer Discovery** — Auto-discovers other instances on the local network via mDNS (Zeroconf)
- **Peer-to-Peer Assignment** — Assign tasks to other instances; receives status updates back
- **Instance Identity** — Each instance gets a unique ID and customizable display name
- **Persistent Storage** — Tasks saved in a single JSON file

## Installation

### Requirements
- Python 3.x
- Flask >= 3.0
- zeroconf >= 0.130

```bash
python -m venv .venv
.venv/bin/pip install -r requirements.txt
```

## Running

```bash
# Start
./scripts/control.sh start

# Or manually
.venv/bin/python server.py
```

Open http://localhost:8080 in your browser.

```bash
# Stop / Restart / Status
./scripts/control.sh stop
./scripts/control.sh restart
./scripts/control.sh status
```

Set a custom port:

```bash
PORT=9090 .venv/bin/python server.py
```

## Usage

1. **Add Task** — Click "+" button, choose Task or Script tab, fill in details
2. **Move Task** — Drag & drop horizontally to change status, vertically to change date
3. **Execute Script** — Open an assigned script task and click Execute
4. **Assign to Peer** — Open a task detail and assign to a discovered LAN peer
5. **Edit Name** — Click the pencil icon next to your name in the header
6. **View Descriptions** — Click the hamburger menu to view all task descriptions fullscreen

## File Structure

```
tasking/
├── server.py          # Flask API server
├── models.py          # Task dataclass, enums
├── storage.py         # JSON file persistence
├── identity.py        # Instance identity management
├── peer.py            # LAN peer discovery (mDNS)
├── web/
│   ├── index.html     # Frontend HTML
│   ├── app.js         # Frontend logic
│   └── styles.css     # Styles
├── scripts/
│   └── control.sh     # Start/stop/restart/status launcher
├── tasks/             # Task data directory (gitignored)
└── requirements.txt
```

## API

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/tasks` | List tasks (`?start=&end=` date filters) |
| POST | `/api/tasks` | Create task |
| GET | `/api/tasks/<id>` | Get task |
| PUT | `/api/tasks/<id>` | Update task |
| DELETE | `/api/tasks/<id>` | Delete task |
| PATCH | `/api/tasks/<id>/move` | Move task to new status |
| POST | `/api/tasks/<id>/execute` | Execute script task |
| POST | `/api/tasks/<id>/assign` | Assign task to LAN peer |
| GET | `/api/identity` | Get instance identity |
| POST | `/api/identity/name` | Set display name |
| GET | `/api/peers` | List discovered LAN peers |

## License

MIT