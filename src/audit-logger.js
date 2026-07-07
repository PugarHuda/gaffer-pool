// Auditable structured log required by the hackathon evidence bundle:
// captures model loads/unloads and per-inference-call performance
// (prompt, tokens, TTFT, tokens/sec) as JSON lines.
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

export class AuditLogger {
  constructor(filePath) {
    this.filePath = filePath;
    mkdirSync(dirname(filePath), { recursive: true });
  }

  #write(entry) {
    appendFileSync(
      this.filePath,
      JSON.stringify({ ts: new Date().toISOString(), ...entry }) + "\n"
    );
  }

  // Generic structured event (e.g. wallet-create, stake-commitment, settlement).
  record(entry) {
    this.#write(entry);
  }

  modelLoad({ modelSrc, modelType, modelId, durationMs }) {
    this.#write({ event: "model_load", modelSrc, modelType, modelId, durationMs });
  }

  modelUnload({ modelId }) {
    this.#write({ event: "model_unload", modelId });
  }

  inference({ modelId, task, prompt, promptTokens, completionTokens, ttftMs, durationMs }) {
    const tokensPerSec =
      completionTokens && durationMs ? +(completionTokens / (durationMs / 1000)).toFixed(2) : null;
    this.#write({
      event: "inference",
      modelId,
      task,
      prompt,
      promptTokens: promptTokens ?? null,
      completionTokens: completionTokens ?? null,
      ttftMs,
      durationMs,
      tokensPerSec,
    });
  }
}
