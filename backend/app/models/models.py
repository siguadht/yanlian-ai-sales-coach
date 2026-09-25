import uuid
from datetime import datetime, timezone

from sqlalchemy import Column, DateTime, ForeignKey, Integer, String, Text

from .database import Base


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _uid() -> str:
    return uuid.uuid4().hex


STATUS_IN_PROGRESS = "in_progress"
STATUS_EVALUATED = "evaluated"
STATUS_ABANDONED = "abandoned"


class PracticeSession(Base):
    __tablename__ = "practice_sessions"

    id = Column(String(32), primary_key=True, default=_uid)
    industry = Column(String(32), nullable=False)
    scene = Column(String(32), nullable=True)
    customer_type = Column(String(32), nullable=False)
    difficulty = Column(String(32), nullable=False)
    player_role = Column(String(16), nullable=False, default="sales", server_default="sales")
    owner_id = Column(String(64), nullable=True, index=True)
    status = Column(String(32), nullable=False, default=STATUS_IN_PROGRESS)
    created_at = Column(DateTime, default=_now)
    updated_at = Column(DateTime, default=_now, onupdate=_now)


class Message(Base):
    __tablename__ = "messages"

    id = Column(String(32), primary_key=True, default=_uid)
    session_id = Column(String(32), ForeignKey("practice_sessions.id"), nullable=False, index=True)
    role = Column(String(16), nullable=False)  # customer / sales
    content = Column(Text, nullable=False)
    created_at = Column(DateTime, default=_now)


class Evaluation(Base):
    __tablename__ = "evaluations"

    id = Column(String(32), primary_key=True, default=_uid)
    session_id = Column(String(32), ForeignKey("practice_sessions.id"), nullable=False, index=True)
    score = Column(Integer, nullable=False)
    highlights = Column(Text, nullable=False)  # JSON 字符串
    tone = Column(Text, nullable=False)
    created_at = Column(DateTime, default=_now)


class DemoReview(Base):
    __tablename__ = "demo_reviews"

    id = Column(String(32), primary_key=True, default=_uid)
    session_id = Column(String(32), ForeignKey("practice_sessions.id"), nullable=False, unique=True)
    summary = Column(Text, nullable=False)
    highlights = Column(Text, nullable=False)
    created_at = Column(DateTime, default=_now)
