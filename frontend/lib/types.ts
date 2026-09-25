export type PlayerRole = "sales" | "customer";
export type BusinessRole = PlayerRole;
export type Industry = "装修" | "教育课程" | "保险";
export type DecorationScene = "电销获客" | "设计师逼单";
export type CustomerType = "爱砍价型" | "挑剔型" | "冷漠型";
export type Difficulty = "温和" | "难缠";

export interface Session {
  id: string;
  industry: Industry;
  scene: DecorationScene | null;
  customer_type: CustomerType;
  difficulty: Difficulty;
  player_role: PlayerRole;
  status: "in_progress" | "evaluated" | "abandoned";
  created_at: string | null;
}

export interface HistorySession extends Session {
  score: number | null;
}

export interface Message {
  id: string;
  role: BusinessRole;
  content: string;
  created_at: string | null;
}

export interface Highlight {
  point: string;
  type: "good" | "bad";
  demo: string;
}

export type Evaluation =
  | { kind: "score"; id: string; score: number; highlights: Highlight[]; tone: string }
  | { kind: "demo"; id: string; summary: string; highlights: Highlight[] };

export interface SessionDetail {
  session: Session;
  messages: Message[];
  evaluation: Evaluation | null;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function oneOf<T extends string>(value: unknown, options: readonly T[]): value is T {
  return typeof value === "string" && options.includes(value as T);
}

export function parseSession(value: unknown): Session {
  if (!isRecord(value) || typeof value.id !== "string" ||
      !oneOf(value.industry, ["装修", "教育课程", "保险"]) ||
      !(value.scene === undefined || value.scene === null ||
        (value.industry === "装修" && oneOf(value.scene, ["电销获客", "设计师逼单"]))) ||
      !oneOf(value.customer_type, ["爱砍价型", "挑剔型", "冷漠型"]) ||
      !oneOf(value.difficulty, ["温和", "难缠"]) ||
      !oneOf(value.player_role, ["sales", "customer"]) ||
      !oneOf(value.status, ["in_progress", "evaluated", "abandoned"])) {
    throw new Error("会话数据格式有误，请刷新后重试");
  }
  return {
    id: value.id,
    industry: value.industry,
    scene: (value.scene ?? null) as DecorationScene | null,
    customer_type: value.customer_type,
    difficulty: value.difficulty,
    player_role: value.player_role,
    status: value.status,
    created_at: typeof value.created_at === "string" ? value.created_at : null,
  };
}

export function parseHistorySessions(value: unknown): HistorySession[] {
  if (!isRecord(value) || !Array.isArray(value.sessions)) throw new Error("历史记录格式有误");
  return value.sessions.map((item) => {
    const session = parseSession(item);
    if (!isRecord(item) || !(item.score === null ||
      (typeof item.score === "number" && Number.isInteger(item.score) && item.score >= 0 && item.score <= 100))) {
      throw new Error("历史分数格式有误");
    }
    if (session.player_role === "customer" && item.score !== null) throw new Error("客户示范记录不能包含分数");
    return { ...session, score: item.score as number | null };
  });
}

function parseHighlight(value: unknown): Highlight {
  if (!isRecord(value) || typeof value.point !== "string" ||
      !oneOf(value.type, ["good", "bad"]) || typeof value.demo !== "string") {
    throw new Error("点评数据格式有误");
  }
  return { point: value.point, type: value.type, demo: value.demo };
}

export function parseEvaluation(value: unknown): Evaluation | null {
  if (value === null || value === undefined) return null;
  if (!isRecord(value) || typeof value.id !== "string" || !Array.isArray(value.highlights)) {
    throw new Error("点评数据格式有误");
  }
  const highlights = value.highlights.map(parseHighlight);
  if (value.kind === "score" && typeof value.score === "number" &&
      Number.isFinite(value.score) && typeof value.tone === "string") {
    return { kind: "score", id: value.id, score: value.score, highlights, tone: value.tone };
  }
  if (value.kind === "demo" && typeof value.summary === "string") {
    return { kind: "demo", id: value.id, summary: value.summary, highlights };
  }
  throw new Error("点评类型无法识别");
}

export function parseSessionDetail(value: unknown): SessionDetail {
  if (!isRecord(value) || !Array.isArray(value.messages)) throw new Error("会话数据格式有误");
  const messages = value.messages.map((item): Message => {
    if (!isRecord(item) || typeof item.id !== "string" ||
        !oneOf(item.role, ["sales", "customer"]) || typeof item.content !== "string") {
      throw new Error("对话记录格式有误");
    }
    return {
      id: item.id, role: item.role, content: item.content,
      created_at: typeof item.created_at === "string" ? item.created_at : null,
    };
  });
  return { session: parseSession(value.session), messages, evaluation: parseEvaluation(value.evaluation) };
}
