export type CallStatus = "idle" | "connecting" | "listening" | "thinking" | "speaking" | "disconnected";

export type LiveMessage =
  | { type: "state"; state: "listening" | "thinking" }
  | { type: "partial" | "final"; text: string }
  | { type: "reply"; reply_text: string; reply_audio: string; reply_role: "sales" | "customer"; audio_error: boolean }
  | { type: "error"; error: { code: string; message: string } }
  | { type: "done" };

export function liveSocketUrl(sessionId: string, location: Pick<Location, "protocol" | "hostname">, runtimeOrigin?: string | null): string {
  const configured = runtimeOrigin?.trim() || process.env.NEXT_PUBLIC_BACKEND_WS_ORIGIN?.trim();
  const origin = configured || `${location.protocol === "https:" ? "wss" : "ws"}://${location.hostname}:18011`;
  return `${origin.replace(/\/$/, "")}/api/v1/voice/live/${encodeURIComponent(sessionId)}`;
}

export function parseLiveMessage(value: unknown): LiveMessage {
  if (!value || typeof value !== "object") throw new Error("语音消息格式有误");
  const message = value as Record<string, unknown>;
  if (message.type === "state" && (message.state === "listening" || message.state === "thinking")) {
    return { type: "state", state: message.state };
  }
  if ((message.type === "partial" || message.type === "final") && typeof message.text === "string") {
    return { type: message.type, text: message.text };
  }
  if (message.type === "reply" && typeof message.reply_text === "string" &&
      typeof message.reply_audio === "string" &&
      (message.reply_role === "sales" || message.reply_role === "customer")) {
    return {
      type: "reply", reply_text: message.reply_text, reply_audio: message.reply_audio,
      reply_role: message.reply_role, audio_error: message.audio_error === true,
    };
  }
  if (message.type === "error") {
    const error = message.error as Record<string, unknown> | undefined;
    return {
      type: "error", error: {
        code: typeof error?.code === "string" ? error.code : "VOICE_ERROR",
        message: typeof error?.message === "string" ? error.message : "语音连接失败",
      },
    };
  }
  if (message.type === "done") return { type: "done" };
  throw new Error("语音消息类型无法识别");
}
