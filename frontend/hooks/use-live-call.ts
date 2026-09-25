"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { pcm16At16k, playWavBase64 } from "@/lib/audio";
import { type CallStatus, liveSocketUrl, parseLiveMessage } from "@/lib/live-call";
import { voiceTicket } from "@/lib/api";
import type { BusinessRole } from "@/lib/types";

type CallCallbacks = {
  onFinal(text: string): void;
  onReply(role: BusinessRole, text: string): void;
};

export function useLiveCall(callbacks: CallCallbacks) {
  const callbacksRef = useRef(callbacks);
  useEffect(() => { callbacksRef.current = callbacks; }, [callbacks]);
  const [status, setStatus] = useState<CallStatus>("idle");
  const [partial, setPartial] = useState("");
  const [notice, setNotice] = useState("");
  const statusRef = useRef<CallStatus>("idle");
  const socketRef = useRef<WebSocket | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const contextRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const playbackRef = useRef<AbortController | null>(null);
  const generationRef = useRef(0);

  const changeStatus = useCallback((next: CallStatus) => {
    statusRef.current = next;
    setStatus(next);
  }, []);

  const cleanup = useCallback(async (next: CallStatus = "idle") => {
    generationRef.current++;
    playbackRef.current?.abort();
    playbackRef.current = null;
    const socket = socketRef.current;
    socketRef.current = null;
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "stop" }));
    socket?.close();
    processorRef.current?.disconnect();
    if (processorRef.current) processorRef.current.onaudioprocess = null;
    processorRef.current = null;
    sourceRef.current?.disconnect();
    sourceRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    const context = contextRef.current;
    contextRef.current = null;
    if (context) await context.close().catch(() => {});
    setPartial("");
    changeStatus(next);
  }, [changeStatus]);

  useEffect(() => () => { void cleanup(); }, [cleanup]);

  const start = useCallback(async (sessionId: string) => {
    if (statusRef.current !== "idle" && statusRef.current !== "disconnected") return;
    if (!navigator.mediaDevices?.getUserMedia) {
      setNotice("当前浏览器无法使用麦克风，请用 localhost 或 HTTPS 打开页面");
      return;
    }
    await cleanup();
    const generation = generationRef.current;
    changeStatus("connecting");
    setNotice("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (generation !== generationRef.current) { stream.getTracks().forEach((track) => track.stop()); return; }
      streamRef.current = stream;
      const context = new AudioContext({ sampleRate: 16000 });
      contextRef.current = context;
      await context.resume();
      const source = context.createMediaStreamSource(stream);
      const processor = context.createScriptProcessor(4096, 1, 1);
      sourceRef.current = source;
      processorRef.current = processor;
      processor.onaudioprocess = (event) => {
        const socket = socketRef.current;
        if (statusRef.current !== "listening" || socket?.readyState !== WebSocket.OPEN) return;
        if (socket.bufferedAmount > 512 * 1024) {
          setNotice("网络传输较慢，请结束通话后重试");
          return;
        }
        socket.send(pcm16At16k(event.inputBuffer.getChannelData(0), context.sampleRate));
      };
      source.connect(processor);
      processor.connect(context.destination);

      const { ticket, wsOrigin } = await voiceTicket(sessionId);
      const target = new URL(liveSocketUrl(sessionId, window.location, wsOrigin));
      if (ticket) target.searchParams.set("ticket", ticket);
      const socket = new WebSocket(target);
      socketRef.current = socket;
      socket.onmessage = async (event: MessageEvent<string>) => {
        if (socketRef.current !== socket) return;
        try {
          const message = parseLiveMessage(JSON.parse(event.data));
          if (message.type === "state") changeStatus(message.state);
          if (message.type === "partial") setPartial(message.text);
          if (message.type === "final") {
            setPartial("");
            callbacksRef.current.onFinal(message.text);
          }
          if (message.type === "reply") {
            callbacksRef.current.onReply(message.reply_role, message.reply_text);
            changeStatus("speaking");
            if (message.audio_error) setNotice("本轮语音合成失败，文字回复已保留");
            const controller = new AbortController();
            playbackRef.current = controller;
            try { await playWavBase64(message.reply_audio, controller.signal); }
            catch (error) {
              if (!controller.signal.aborted) setNotice(error instanceof Error ? error.message : "语音播放失败，文字已保留");
            } finally {
              if (playbackRef.current === controller) playbackRef.current = null;
            }
            if (socketRef.current === socket && socket.readyState === WebSocket.OPEN) {
              socket.send(JSON.stringify({ type: "resume" }));
            }
          }
          if (message.type === "error") {
            setNotice(message.error.message);
            await cleanup("disconnected");
          }
          if (message.type === "done") await cleanup();
        } catch (error) {
          setNotice(error instanceof Error ? error.message : "语音连接出错");
          await cleanup("disconnected");
        }
      };
      socket.onerror = () => setNotice("语音连接失败，请检查服务和网络");
      socket.onclose = () => {
        if (socketRef.current === socket) {
          setNotice((previous) => previous || "语音连接已断开，已保存的文字仍可查看");
          void cleanup("disconnected");
        }
      };
    } catch (error) {
      const message = error instanceof DOMException && error.name === "NotAllowedError"
        ? "麦克风权限被拒绝，请在浏览器地址栏允许麦克风后重试"
        : error instanceof Error ? `无法开始通话：${error.message}` : "无法开始通话";
      setNotice(message);
      await cleanup("disconnected");
    }
  }, [changeStatus, cleanup]);

  return {
    status, partial, notice, start,
    stop: () => cleanup(),
    clearNotice: () => setNotice(""),
  };
}
