// Gaffer demo: ingest the football scouting corpus, then answer analyst
// questions over it with Qwen3-4B + GTE-large — fully local, with audit logging.
import { readFileSync, readdirSync } from "node:fs";
import { join, basename } from "node:path";
import { SehatEngine } from "./engine.js";

const engine = new SehatEngine();
console.log("Starting Gaffer engine (Qwen3-4B + GTE-large, on-device)...");
await engine.start();

const sampleDir = "data/football";
for (const file of readdirSync(sampleDir).filter((f) => f.endsWith(".txt"))) {
  process.stdout.write(`Ingesting ${file}... `);
  await engine.ingestDocument({
    source: basename(file),
    text: readFileSync(join(sampleDir, file), "utf8"),
  });
  console.log("ok");
}

const questions = [
  "How should a team set up to break down a deep low block, and which of these two sides is more vulnerable on the counter?",
  "Compare Bellingham and Rodri: what does each do for their team, and how do you neutralise them?",
  "Based on recent form, xG and injuries, who goes into the second leg as favourite and why?",
];

for (const q of questions) {
  console.log(`\n\n=== Q: ${q}\n`);
  const { stats } = await engine.ask(q, {
    onToken: (t) => process.stdout.write(t),
  });
  console.log(
    `\n[search ${stats.searchMs} ms | TTFT ${stats.ttftMs} ms | ` +
      `${stats.tokenCount} tokens | ${(stats.tokenCount / (stats.durationMs / 1000)).toFixed(1)} tok/s]`
  );
}

await engine.stop();
console.log("\nDone. Audit log: artifacts/audit-log.jsonl");
process.exit(0);
