"""
Task storage module for JSON file persistence.
"""
import os
import json
from pathlib import Path
from typing import List, Optional
from datetime import datetime
from models import Task


class TaskStorage:
    """JSON file-based task storage"""

    TASKS_DIR = "tasks"
    TASKS_FILE = os.path.join(TASKS_DIR, "tasks.json")

    def __init__(self):
        self._ensure_storage_exists()

    def _ensure_storage_exists(self):
        Path(self.TASKS_DIR).mkdir(parents=True, exist_ok=True)
        if not os.path.exists(self.TASKS_FILE):
            with open(self.TASKS_FILE, "w", encoding="utf-8") as f:
                json.dump([], f)

    def _read_all(self) -> List[Task]:
        try:
            with open(self.TASKS_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
                return [Task.from_dict(t) for t in data]
        except (json.JSONDecodeError, FileNotFoundError):
            return []

    def _write_all(self, tasks: List[Task]):
        with open(self.TASKS_FILE, "w", encoding="utf-8") as f:
            json.dump([t.to_dict() for t in tasks], f, ensure_ascii=False, indent=2)

    def get_all_tasks(self) -> List[Task]:
        return self._read_all()

    def get_tasks_by_date_range(self, start_date: datetime, end_date: datetime) -> List[Task]:
        tasks = self._read_all()
        filtered = []
        for task in tasks:
            try:
                task_date = datetime.fromisoformat(task.created_at)
                if start_date <= task_date <= end_date:
                    filtered.append(task)
            except (ValueError, TypeError):
                continue
        return filtered

    def get_task(self, task_id: str) -> Optional[Task]:
        tasks = self._read_all()
        for t in tasks:
            if t.id == task_id:
                return t
        return None

    def save_task(self, task: Task) -> bool:
        try:
            tasks = self._read_all()
            for i, t in enumerate(tasks):
                if t.id == task.id:
                    tasks[i] = task
                    self._write_all(tasks)
                    return True
            tasks.append(task)
            self._write_all(tasks)
            return True
        except Exception as e:
            print(f"Error saving task: {e}")
            return False

    def delete_task(self, task_id: str) -> bool:
        try:
            tasks = self._read_all()
            filtered = [t for t in tasks if t.id != task_id]
            if len(filtered) < len(tasks):
                self._write_all(filtered)
                return True
            return False
        except Exception as e:
            print(f"Error deleting task: {e}")
            return False

    def move_task(self, task_id: str, new_status: str) -> Optional[Task]:
        try:
            tasks = self._read_all()
            for t in tasks:
                if t.id == task_id:
                    t.status = new_status
                    now = datetime.now().isoformat()
                    if new_status == "processing" and t.started_at is None:
                        t.started_at = now
                    elif new_status == "done" and t.completed_at is None:
                        t.completed_at = now
                    self._write_all(tasks)
                    return t
            return None
        except Exception as e:
            print(f"Error moving task: {e}")
            return None