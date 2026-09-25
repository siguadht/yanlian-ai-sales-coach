import {
  type CustomerType, type Difficulty, type Industry, type PlayerRole, type DecorationScene,
  type Evaluation, type Session, type SessionDetail, type HistorySession,
  isRecord, parseEvaluation, parseSession, parseSessionDetail, parseHistorySessions,
} from "./types";

const ROOT = "/api/v1";

export async function authStatus(): Promise<{ auth_required: boolean; authenticated: boolean }> {
  const value = await jsonRequest("/auth/me");
  if (!isRecord(value) || typeof value.auth_required !== "boolean" || typeof value.authenticated !== "boolean") {
    throw new ApiError("PARSE_ERROR", "登录状态无法读取");
  }
  return { auth_required: value.auth_required, authenticated: value.authenticated };
}

export async function loginWithCode(code: string): Promise<void> {
  await jsonRequest("/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code }) });
}

export async function voiceTicket(sessionId: string): Promise<{ ticket: string | null; wsOrigin: string | null }> {
  const value = await jsonRequest(`/auth/ws-ticket?session_id=${encodeURIComponent(sessionId)}`, { method: "POST" });
  if (!isRecord(value) || (value.ticket !== null && typeof value.ticket !== "string") ||
      (value.ws_origin !== null && typeof value.ws_origin !== "string")) {
    throw new ApiError("PARSE_ERROR", "语音连接授权失败");
  }
  return { ticket: value.ticket, wsOrigin: value.ws_origin };
}

export class ApiError extends Error {
  constructor(public code: string, message: string) { super(message); }
}

async function errorFromResponse(response: Response): Promise<ApiError> {
  let body: unknown;
  try { body = await response.json(); } catch { /* Proxy or network errors may not return JSON. */ }
  const error = isRecord(body) && isRecord(body.error) ? body.error : null;
  return new ApiError(
    typeof error?.code === "string" ? error.code : "HTTP_ERROR",
    typeof error?.message === "string" ? error.message : `请求失败（${response.status}）`,
  );
}

async function jsonRequest(path: string, init?: RequestInit): Promise<unknown> {
  let response: Response;
  try { response = await fetch(`${ROOT}${path}`, { cache: "no-store", ...init }); }
  catch { throw new ApiError("NETWORK_ERROR", "无法连接服务，请检查网络后重试"); }
  if (!response.ok) throw await errorFromResponse(response);
  try { return await response.json(); }
  catch { throw new ApiError("PARSE_ERROR", "服务返回的数据无法读取"); }
}

export async function createSession(input: {
  industry: Industry; scene: DecorationScene | null; customer_type: CustomerType; difficulty: Difficulty; player_role: PlayerRole;
}): Promise<{ session: Session; opening: string }> {
  const body = await jsonRequest("/practice/sessions", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input),
  });
  if (!isRecord(body)) throw new Error("会话数据格式有误");
  return { session: parseSession(body.session), opening: typeof body.opening === "string" ? body.opening : "" };
}

export async function getSession(id: string): Promise<SessionDetail> {
  return parseSessionDetail(await jsonRequest(`/practice/sessions/${encodeURIComponent(id)}`));
}

export async function listSessions(): Promise<HistorySession[]> {
  return parseHistorySessions(await jsonRequest("/practice/sessions"));
}

export async function endSession(id: string): Promise<Evaluation> {
  const body = await jsonRequest(`/practice/sessions/${encodeURIComponent(id)}/end`, { method: "POST" });
  if (!isRecord(body)) throw new Error("点评数据格式有误");
  const evaluation = parseEvaluation(body.evaluation);
  if (!evaluation) throw new Error("没有收到点评结果");
  return evaluation;
}

export async function synthesizeSpeech(text: string): Promise<string> {
  const body = await jsonRequest("/voice/tts", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }),
  });
  if (!isRecord(body) || typeof body.audio !== "string") throw new Error("语音数据格式有误");
  return body.audio;
}

async function streamReply(
  path: string, body: Record<string, unknown>,
  callbacks: { onChunk(text: string): void; onDone(text: string): void },
): Promise<void> {
  let response: Response;
  try {
    response = await fetch(`${ROOT}${path}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body), cache: "no-store",
    });
  } catch { throw new ApiError("NETWORK_ERROR", "无法连接服务，请检查网络后重试"); }
  if (!response.ok) throw await errorFromResponse(response);
  if (!response.body) throw new ApiError("STREAM_ERROR", "没有收到回复流");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer = (buffer + decoder.decode(value, { stream: !done })).replace(/\r\n/g, "\n");
      const blocks = buffer.split("\n\n");
      buffer = blocks.pop() || "";
      for (const block of blocks) {
        const event = block.match(/^event:\s*(.+)$/m)?.[1];
        const dataLine = block.match(/^data:\s*(.+)$/m)?.[1];
        if (!event || !dataLine) continue;
        let data: unknown;
        try { data = JSON.parse(dataLine); } catch { throw new ApiError("PARSE_ERROR", "回复数据格式有误"); }
        if (event === "chunk" && isRecord(data) && typeof data.text === "string") callbacks.onChunk(data.text);
        if (event === "error") {
          const error = isRecord(data) && isRecord(data.error) ? data.error : null;
          throw new ApiError(
            typeof error?.code === "string" ? error.code : "STREAM_ERROR",
            typeof error?.message === "string" ? error.message : "回复失败，请重试",
          );
        }
        if (event === "done") {
          callbacks.onDone(isRecord(data) && typeof data.reply === "string" ? data.reply : "");
          return;
        }
      }
      if (done) break;
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  throw new ApiError("STREAM_ERROR", "回复中断，已保留已有对话");
}

export function sendText(id: string, content: string, callbacks: { onChunk(text: string): void; onDone(text: string): void }): Promise<void> {
  return streamReply(`/practice/sessions/${encodeURIComponent(id)}/messages`, { content }, callbacks);
}

export function askAssistant(question: string, industry: Industry | null, callbacks: { onChunk(text: string): void; onDone(text: string): void }): Promise<void> {
  return streamReply("/assistant/chat", { question, industry }, callbacks);
}
