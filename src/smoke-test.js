// M1 smoke test: load a small LLM via @qvac/sdk, run one streamed completion,
// and emit an audit log entry with TTFT and tokens/sec.
import { completion, LLAMA_3_2_1B_INST_Q4_0, loadModel, unloadModel } from "@qvac/sdk";
import { AuditLogger } from "./audit-logger.js";

const log = new AuditLogger("artifacts/audit-log.jsonl");

console.log("Loading model (first run downloads weights — may take a while)...");
const loadStart = performance.now();
const modelId = await loadModel({
  modelSrc: LLAMA_3_2_1B_INST_Q4_0,
  modelType: "llm",
});
log.modelLoad({
  modelSrc: "LLAMA_3_2_1B_INST_Q4_0",
  modelType: "llm",
  modelId,
  durationMs: Math.round(performance.now() - loadStart),
});
console.log(`Model loaded: ${modelId}`);

const prompt =
  "In two sentences, why does on-device AI matter for keeping your football picks and analysis private?";
const history = [{ role: "user", content: prompt }];

const inferStart = performance.now();
let ttftMs = null;
let tokenCount = 0;
let text = "";

const result = completion({ modelId, history, stream: true });
for await (const token of result.tokenStream) {
  if (ttftMs === null) ttftMs = Math.round(performance.now() - inferStart);
  tokenCount++;
  text += token;
  process.stdout.write(token);
}
const durationMs = Math.round(performance.now() - inferStart);

log.inference({
  modelId,
  task: "completion",
  prompt,
  completionTokens: tokenCount,
  ttftMs,
  durationMs,
});

console.log(
  `\n\n--- smoke test OK ---\nTTFT: ${ttftMs} ms | tokens: ${tokenCount} | ` +
    `tok/s: ${(tokenCount / (durationMs / 1000)).toFixed(2)}\nAudit log: artifacts/audit-log.jsonl`
);

await unloadModel({ modelId });
process.exit(0);
