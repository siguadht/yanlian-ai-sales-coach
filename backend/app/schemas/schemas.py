from typing import Literal

from pydantic import BaseModel, Field, model_validator

Industry = Literal["装修", "教育课程", "保险"]
CustomerType = Literal["爱砍价型", "挑剔型", "冷漠型"]
Difficulty = Literal["温和", "难缠"]
PlayerRole = Literal["sales", "customer"]
DecorationScene = Literal["电销获客", "设计师逼单"]


class SessionCreate(BaseModel):
    industry: Industry
    scene: DecorationScene | None = None
    customer_type: CustomerType
    difficulty: Difficulty
    player_role: PlayerRole = "sales"

    @model_validator(mode="after")
    def scene_matches_industry(self):
        if self.scene is not None and self.industry != "装修":
            raise ValueError("装修部门场景只能用于装修行业")
        return self


class SalesMessage(BaseModel):
    content: str = Field(min_length=1, max_length=2000)


class AssistantQuestion(BaseModel):
    question: str = Field(min_length=1, max_length=2000)
    industry: Industry | None = None


class TtsRequest(BaseModel):
    text: str = Field(min_length=1, max_length=500)


class Highlight(BaseModel):
    point: str
    type: Literal["good", "bad"]
    demo: str


class EvaluationOut(BaseModel):
    score: int = Field(ge=0, le=100)
    highlights: list[Highlight]
    tone: str


class DemoReviewOut(BaseModel):
    summary: str = Field(min_length=1, max_length=1000)
    highlights: list[Highlight] = Field(min_length=1, max_length=3)
