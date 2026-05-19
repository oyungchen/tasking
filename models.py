"""
Task data models for the task management system.
"""
from datetime import datetime
from enum import Enum
from dataclasses import dataclass, field, asdict
from typing import Optional
import json


class TaskStatus(Enum):
    PENDING = "pending"
    PROCESSING = "processing"
    DONE = "done"


class Priority(Enum):
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"


PRIORITY_COLORS = {
    Priority.HIGH: "#e74c3c",
    Priority.MEDIUM: "#f39c12",
    Priority.LOW: "#27ae60",
}

STATUS_COLORS = {
    TaskStatus.PENDING: "#f5f0e8",
    TaskStatus.PROCESSING: "#e8eef5",
    TaskStatus.DONE: "#eaf5ea",
}


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

    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict) -> "Task":
        return cls(**{k: v for k, v in data.items() if k in cls.__dataclass_fields__})