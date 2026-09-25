import { afterEach, describe, expect, it, vi } from "vitest";
import { askAssistant, sendText } from "../lib/api";
import { pcm16At16k } from "../lib/audio";
import { liveSocketUrl, parseLiveMessage } from "../lib/live-call";
import { parseEvaluation, parseHistorySessions, parseSessionDetail, parseSession } from "../lib/types";

afterEach(() => vi.unstubAllGlobals());

const session = {
  id: "abc", industry: "装修", customer_type: "挑剔型", difficulty: "温和",
  player_role: "customer", status: "evaluated", created_at: "2026-09-20T00:00:00Z",
};

describe("后端契约", () => {
  it("保留并识别已放弃的历史会话", () => {
    expect(parseSession({ ...session, status: "abandoned" }).status).toBe("abandoned");
  });

  it("装修部门分别读取，旧记录保持未区分", () => {
    expect(parseSession({ ...session, scene: "电销获客" }).scene).toBe("电销获客");
    expect(parseSession({ ...session, scene: "设计师逼单" }).scene).toBe("设计师逼单");
    expect(parseSession(session).scene).toBeNull();
    expect(() => parseSession({ ...session, scene: "施工部" })).toThrow();
  });
  it("客户角色只接受无分数示范拆解", () => {
    const review = parseEvaluation({ kind: "demo", id: "r1", summary: "先问需求", highlights: [
      { point: "澄清顾虑", type: "good", demo: "您最在意哪一点？" },
    ] });
    expect(review?.kind).toBe("demo");
    expect(review).not.toHaveProperty("score");
    expect(parseSessionDetail({ session, messages: [
      { id: "m1", role: "customer", content: "太贵了", created_at: null },
      { id: "m2", role: "sales", content: "可以说说预算吗", created_at: null },
    ], evaluation: review }).messages.map((m) => m.role)).toEqual(["customer", "sales"]);
  });

  it("拒绝未知角色，避免把数据误显示为另一方", () => {
    expect(() => parseSessionDetail({ session: { ...session, player_role: "manager" }, messages: [], evaluation: null })).toThrow();
  });

  it("按浏览器所在主机建立本地语音连接", () => {
    expect(liveSocketUrl("abc", { protocol: "http:", hostname: "127.0.0.1" }))
      .toBe("ws://127.0.0.1:18011/api/v1/voice/live/abc");
    expect(liveSocketUrl("abc", { protocol: "https:", hostname: "demo.example" }, "wss://voice.example"))
      .toBe("wss://voice.example/api/v1/voice/live/abc");
    expect(parseLiveMessage({ type: "reply", reply_text: "您好", reply_audio: "", reply_role: "sales", audio_error: true }))
      .toMatchObject({ type: "reply", reply_role: "sales", audio_error: true });
  });

  it("16kHz 音频转成有符号 16 位 PCM", () => {
    const result = new Int16Array(pcm16At16k(new Float32Array([-1, 0, 1]), 16000));
    expect([...result]).toEqual([-32768, 0, 32767]);
  });

  it("完整读取跨块 SSE 并以 done 收尾", async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('event: chunk\ndata: {"text":"你'));
        controller.enqueue(encoder.encode('好"}\n\nevent: done\ndata: {"reply":"你好"}\n\n'));
        controller.close();
      },
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(stream, { status: 200 })));
    const chunks: string[] = [];
    let done = "";
    await sendText("abc", "您好", { onChunk: (part) => chunks.push(part), onDone: (reply) => { done = reply; } });
    expect(chunks).toEqual(["你好"]);
    expect(done).toBe("你好");
  });

  it("识别被拆开的 CRLF，并在 done 后及时结束读取", async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({ start(controller) {
      controller.enqueue(encoder.encode('event: chunk\r\ndata: {"text":"你好"}\r'));
      controller.enqueue(encoder.encode('\n\r\nevent: done\r\ndata: {"reply":"你好"}\r'));
      controller.enqueue(encoder.encode('\n\r\n'));
      // Deliberately do not close: the UI must finish at the done event.
    } });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(stream, { status: 200 })));
    const chunks: string[] = [];
    let reply = "";
    await sendText("abc", "您好", { onChunk: (part) => chunks.push(part), onDone: (text) => { reply = text; } });
    expect(chunks).toEqual(["你好"]);
    expect(reply).toBe("你好");
  });

  it("历史列表只接受销售分数，客户示范保持无分数", () => {
    const rows = parseHistorySessions({ sessions: [
      { ...session, player_role: "sales", score: 82 },
      { ...session, id: "customer", score: null },
    ] });
    expect(rows.map((row) => row.score)).toEqual([82, null]);
    expect(() => parseHistorySessions({ sessions: [{ ...session, score: 80 }] })).toThrow();
  });

  it("话术助手将行业与问题发送到真实流式接口", async () => {
    const stream = new ReadableStream({ start(controller) {
      controller.enqueue(new TextEncoder().encode('event: chunk\ndata: {"text":"先问顾虑"}\n\nevent: done\ndata: {"reply":"先问顾虑"}\n\n'));
      controller.close();
    } });
    const fetchMock = vi.fn().mockResolvedValue(new Response(stream, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    let answer = "";
    await askAssistant("客户嫌贵怎么办", "装修", { onChunk: () => {}, onDone: (reply) => { answer = reply; } });
    expect(answer).toBe("先问顾虑");
    expect(fetchMock.mock.calls[0][0]).toBe("/api/v1/assistant/chat");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ question: "客户嫌贵怎么办", industry: "装修" });
  });
});
