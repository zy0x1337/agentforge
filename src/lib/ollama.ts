import type { OllamaModel, ChatMessage } from "@/types";

export async function isOllamaRunning(base = "http://localhost:11434"): Promise<boolean> {
  try {
    const res = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}

export async function listLocalModels(base = "http://localhost:11434"): Promise<OllamaModel[]> {
  const res = await fetch(`${base}/api/tags`);
  if (!res.ok) throw new Error("Ollama not reachable");
  const data = await res.json();
  return (data.models ?? []) as OllamaModel[];
}

export async function deleteModel(name: string, base = "http://localhost:11434"): Promise<void> {
  await fetch(`${base}/api/delete`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
}

/** Pull a model — streams progress events via callback */
export async function pullModel(
  name: string,
  onProgress: (status: string, pct?: number) => void,
  signal?: AbortSignal,
  base = "http://localhost:11434"
): Promise<void> {
  const res = await fetch(`${base}/api/pull`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, stream: true }),
    signal,
  });
  if (!res.body) throw new Error("No response body");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const lines = decoder.decode(value).split("\n").filter(Boolean);
      for (const line of lines) {
        try {
          const json = JSON.parse(line);
          const pct =
            json.total && json.completed
              ? Math.round((json.completed / json.total) * 100)
              : undefined;
          onProgress(json.status ?? "", pct);
        } catch {}
      }
    }
  } finally {
    reader.cancel();
  }
}

/** Non-streaming chat — returns full response */
export async function chat(
  model: string,
  messages: ChatMessage[],
  temperature = 0.7,
  maxTokens?: number,
  signal?: AbortSignal,
  base = "http://localhost:11434"
): Promise<string> {
  const res = await fetch(`${base}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages,
      stream: false,
      options: {
        temperature,
        ...(maxTokens ? { num_predict: maxTokens } : {}),
      },
    }),
    signal,
  });
  if (!res.ok) throw new Error(`Chat error: ${res.statusText}`);
  const data = await res.json();
  return data.message?.content ?? "";
}

/** Streaming chat — calls onChunk for each token */
export async function chatStream(
  model: string,
  messages: ChatMessage[],
  onChunk: (token: string) => void,
  temperature = 0.7,
  signal?: AbortSignal,
  base = "http://localhost:11434"
): Promise<void> {
  const res = await fetch(`${base}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages, stream: true, options: { temperature } }),
    signal,
  });
  if (!res.body) throw new Error("No stream");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const lines = decoder.decode(value).split("\n").filter(Boolean);
      for (const line of lines) {
        try {
          const json = JSON.parse(line);
          if (json.message?.content) onChunk(json.message.content);
        } catch {}
      }
    }
  } finally {
    reader.cancel();
  }
}
