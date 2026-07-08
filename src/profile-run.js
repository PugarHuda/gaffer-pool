// Official evidence run: executes a standard RAG Q&A with the QVAC SDK
// profiler enabled and exports the SDK's own metrics (server breakdown,
// load/download gauges, per-op aggregates) to artifacts/profiler-export.json.
// Complements our audit logger with first-party SDK telemetry.
import { writeFileSync } from "node:fs";
import { profiler } from "@qvac/sdk";
import { GafferEngine } from "./engine.js";

profiler.enable({ mode: "verbose", includeServerBreakdown: true });
console.log("QVAC profiler enabled:", profiler.isEnabled());

const engine = new GafferEngine();
await engine.start();

const question = "How has Budi's blood sugar changed over his last tests?";
console.log(`\nQ: ${question}\n`);
const { stats } = await engine.ask(question, {
  onToken: (tok) => process.stdout.write(tok),
});
console.log(`\n\n[search ${stats.searchMs} ms | TTFT ${stats.ttftMs} ms | ${stats.tokenCount} tokens]`);

await engine.stop();

console.log("\n=== QVAC Profiler Summary ===");
console.log(profiler.exportSummary());
console.log(profiler.exportTable());

const json = profiler.exportJSON();
writeFileSync("artifacts/profiler-export.json", JSON.stringify(json, null, 2));
console.log(
  `\nExported ${json.recentEvents?.length ?? 0} events / ` +
    `${Object.keys(json.aggregates ?? {}).length} aggregate metrics -> artifacts/profiler-export.json`
);

profiler.disable();
process.exit(0);
