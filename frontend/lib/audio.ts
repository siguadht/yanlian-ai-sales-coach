/** Convert browser Float32 microphone samples into 16 kHz mono PCM for the existing backend. */
export function pcm16At16k(input: Float32Array, inputRate: number): ArrayBuffer {
  const ratio = inputRate / 16000;
  const count = Math.floor(input.length / ratio);
  const pcm = new Int16Array(count);
  for (let index = 0; index < count; index++) {
    const start = Math.floor(index * ratio);
    const end = Math.min(input.length, Math.max(start + 1, Math.floor((index + 1) * ratio)));
    let sum = 0;
    for (let sample = start; sample < end; sample++) sum += input[sample];
    const value = Math.max(-1, Math.min(1, sum / (end - start)));
    pcm[index] = value < 0 ? value * 0x8000 : value * 0x7fff;
  }
  return pcm.buffer;
}

export function playWavBase64(encoded: string, signal?: AbortSignal): Promise<void> {
  if (!encoded) return Promise.resolve();
  return new Promise((resolve, reject) => {
    let url: string;
    try {
      const binary = atob(encoded);
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
      url = URL.createObjectURL(new Blob([bytes], { type: "audio/wav" }));
    } catch { reject(new Error("语音数据无法播放")); return; }

    const audio = new Audio(url);
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      audio.pause();
      audio.removeAttribute("src");
      URL.revokeObjectURL(url);
      signal?.removeEventListener("abort", abort);
      if (error) reject(error); else resolve();
    };
    const abort = () => finish(new Error("播放已停止"));
    if (signal?.aborted) { abort(); return; }
    signal?.addEventListener("abort", abort, { once: true });
    audio.onended = () => finish();
    audio.onerror = () => finish(new Error("语音播放失败，请查看文字回复"));
    audio.play().catch(() => finish(new Error("浏览器阻止了语音播放，请检查声音权限")));
  });
}
