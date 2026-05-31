import type { OllamaModel, ChatMessage } from "@/types";

const BASE = "http://localhost:11434";

export async function isOllamaRunning(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE}/api/tags`, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}

export async function listLocalModels(): Promise<OllamaModel[]> {
  const res = await fetch(`${BASE}/api/tags`);
  if (!res.ok) throw new Error("Ollama not reachable");
  const data = await res.json();
  return (data.models ?? []) as OllamaModel[];
}

export async function deleteModel(name: string): Promise<void> {
  await fetch(`${BASE}/api/delete`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
}

/** Pull a model — streams progress events via callback */
export async function pullModel(
  name: string,
  onProgress: (status: string, pct?: number) => void
): Promise<void> {
  const res = await fetch(`${BASE}/api/pull`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, stream: true }),
  });
  if (!res.body) throw new Error("No response body");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();

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
}

/** Non-streaming chat — returns full response */
export async function chat(
  model: string,
  messages: ChatMessage[],
  temperature = 0.7,
  maxTokens?: number
): Promise<string> {
  const res = await fetch(`${BASE}/api/chat`, {
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
  temperature = 0.7
): Promise<void> {
  const res = await fetch(`${BASE}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages, stream: true, options: { temperature } }),
  });
  if (!res.body) throw new Error("No stream");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();

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
}
