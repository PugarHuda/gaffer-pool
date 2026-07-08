// Gaffer desktop server: mobile web UI on the LAN + voice + ID/EN translation,
// optionally doubling as a QVAC P2P provider.
//
//   node src/server.js              -> HTTPS (if certs/gaffer.pfx exists) else HTTP
//   GAFFER_P2P=1 node src/server.js -> also start the P2P provider
import { createServer as createHttpServer } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { readFileSync, readdirSync, existsSync, writeFileSync, unlinkSync, mkdirSync } from "node:fs";
import { join, basename } from "node:path";
import { tmpdir, networkInterfaces } from "node:os";
import { startQVACProvider, loadModel, unloadModel, transcribe, WHISPER_LARGE_V3_TURBO } from "@qvac/sdk";
import { GafferEngine } from "./engine.js";
import { GafferAgent } from "./agent.js";
import { Translator } from "./translator.js";
import { loadTeams, loadPlayers } from "./football-data.js";
import { textToSpeech, TTS_EN_SUPERTONIC_Q8_0, ocr, OCR_LATIN_RECOGNIZER_1 } from "@qvac/sdk";
import QRCode from "qrcode";
import { wavHeader, int16ToBuffer } from "./audio-utils.js";
import WDK from "@tetherto/wdk";
import WalletManagerEvm, { WalletAccountEvm } from "@tetherto/wdk-wallet-evm";

// --- Gaffer Pool (fixed-odds bet, self-custodial WDK settlement) — mirrors demo-pool.js ---
const USDT = process.env.POOL_USDT || "0x7169D38820dfd117C3FA1f22a697dBA58d90BA06";
const USDT_DECIMALS = 6;
const unitsUsdt = (n) => BigInt(Math.round(n * 10 ** USDT_DECIMALS)).toString();
const OUTCOMES = { HOME: "Real Madrid win", DRAW: "Draw", AWAY: "Manchester City win" };
function parseProbs(text) {
  const g = (k) => { const m = new RegExp(`${k}\\s*=?\\s*(\\d{1,3})\\s*%`, "i").exec(text); return m ? +m[1] : null; };
  let p = { HOME: g("HOME"), DRAW: g("DRAW"), AWAY: g("AWAY") };
  const sum = (p.HOME ?? 0) + (p.DRAW ?? 0) + (p.AWAY ?? 0);
  if (!sum || Object.values(p).some((v) => v == null)) return { HOME: 1 / 3, DRAW: 1 / 3, AWAY: 1 / 3 };
  return { HOME: p.HOME / sum, DRAW: p.DRAW / sum, AWAY: p.AWAY / sum };
}

const PORT = Number(process.env.PORT ?? 8787);
const engine = new GafferEngine();

console.log("Starting Gaffer engine (Qwen3-4B + GTE-large, on-device)...");
await engine.start();

// Seed the workspace from the sample docs if it's empty (first run).
const probe = await engine.ask("tactics", { topK: 1, onToken: () => {} }).catch(() => null);
if (!probe || probe.hits.length === 0) {
  console.log("Workspace empty — ingesting football documents...");
  for (const f of readdirSync("data/football").filter((x) => x.endsWith(".txt"))) {
    await engine.ingestDocument({
      source: basename(f),
      text: readFileSync(join("data/football", f), "utf8"),
    });
  }
  await engine.reindex(); // IVF rebalance for more accurate retrieval
}

// Lazy singletons for optional capabilities.
// Optional models, loaded on demand. On a 6 GB GPU only ONE may be resident at a
// time alongside the always-on base (MedPsy-4B + GTE-large): loading two heavy
// optional models on top of the base can exceed VRAM and crash the Bare worker.
// Since these features are used one at a time, claimSlot() unloads the previously
// active optional model when you switch features.
let translator = null, sttId = null, ocrId = null, ttsId = null, agent = null;
let optActive = null;
async function claimSlot(key) {
  if (optActive === key) return;
  if (optActive) {
    try {
      if (optActive === "stt" && sttId) { await unloadModel({ modelId: sttId }); sttId = null; }
      else if (optActive === "ocr" && ocrId) { await unloadModel({ modelId: ocrId }); ocrId = null; }
      else if (optActive === "tts" && ttsId) { await unloadModel({ modelId: ttsId }); ttsId = null; }
      else if (optActive === "agent" && agent) { await agent.stop(); agent = null; }
      else if (optActive === "translator" && translator) { await translator.stop(); translator = null; }
      console.log(`[vram] unloaded optional model '${optActive}' (switching to '${key}')`);
    } catch (e) { console.warn(`[vram] unload '${optActive}' failed: ${e.message}`); }
  }
  optActive = key;
}

async function getTranslator() {
  await claimSlot("translator");
  if (!translator) {
    console.log("Loading Bergamot ID<->EN translator...");
    translator = new Translator();
    await translator.start();
  }
  return translator;
}

async function getStt() {
  await claimSlot("stt");
  if (!sttId) {
    console.log("Loading Whisper STT (large-v3-turbo, auto-detect)...");
    sttId = await loadModel({
      modelSrc: WHISPER_LARGE_V3_TURBO, // highest-accuracy multilingual STT
      modelType: "whisper",
      modelConfig: {
        strategy: "greedy",
        language: "", // empty = whisper auto-detects the spoken language (ID, EN, …)
        translate: false, // keep the spoken language; don't force-translate to English
        temperature: 0.0,
        suppress_blank: true,
        contextParams: { use_gpu: true, flash_attn: true, gpu_device: 0 },
      },
    });
  }
  return sttId;
}

async function getOcr() {
  await claimSlot("ocr");
  if (!ocrId) {
    console.log("Loading OCR...");
    ocrId = await loadModel({
      modelSrc: OCR_LATIN_RECOGNIZER_1,
      modelType: "ocr",
      modelConfig: { langList: ["en"], useGPU: true, defaultRotationAngles: [90, 180, 270], magRatio: 1.5, contrastRetry: true, lowConfidenceThreshold: 0.5 },
    });
  }
  return ocrId;
}

async function getTts() {
  await claimSlot("tts");
  if (!ttsId) {
    console.log("Loading Supertonic TTS...");
    ttsId = await loadModel({
      modelSrc: TTS_EN_SUPERTONIC_Q8_0.src ?? TTS_EN_SUPERTONIC_Q8_0,
      modelType: "tts",
      modelConfig: { ttsEngine: "supertonic", language: "en", voice: "F1", ttsSpeed: 1.0 },
    });
  }
  return ttsId;
}

async function getAgent() {
  await claimSlot("agent");
  if (!agent) {
    console.log("Loading Qwen3 orchestrator for agent mode...");
    agent = new GafferAgent({ engine }); // shares the already-loaded Qwen specialist
    await agent.start();
  }
  return agent;
}

// One inference at a time; later requests queue up.
let queue = Promise.resolve();
let p2pKey = null; // set when started as a P2P provider (GAFFER_P2P=1)

const html = readFileSync("public/index.html");
const STATIC = {
  "/manifest.json": ["application/manifest+json", readFileSync("public/manifest.json")],
  "/sw.js": ["text/javascript", readFileSync("public/sw.js")],
  "/icon-192.png": ["image/png", readFileSync("public/icon-192.png")],
  "/icon-512.png": ["image/png", readFileSync("public/icon-512.png")],
};

// Optional access PIN: set GAFFER_PIN=1234 to require it on every /api/* call.
// Empty = open (LAN trust). The app page itself always loads so it can prompt.
const GAFFER_PIN = process.env.GAFFER_PIN || "";

async function handler(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === "GET" && url.pathname === "/") {
    // no-store so phones always get the latest UI (avoids stale cached client).
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    return res.end(readFileSync("public/index.html")); // re-read so edits show on refresh
  }

  // PIN gate for API routes (when enabled).
  if (GAFFER_PIN && url.pathname.startsWith("/api/")) {
    const given = req.headers["x-gaffer-pin"] || url.searchParams.get("pin") || "";
    if (given !== GAFFER_PIN) {
      res.writeHead(401, { "content-type": "application/json" });
      return res.end(JSON.stringify({ error: "pin required" }));
    }
  }

  if (req.method === "GET" && STATIC[url.pathname]) {
    const [type, body] = STATIC[url.pathname];
    res.writeHead(200, { "content-type": type });
    return res.end(body);
  }

  if (req.method === "GET" && url.pathname === "/api/ask") {
    const question = (url.searchParams.get("q") ?? "").slice(0, 2000).trim();
    const lang = url.searchParams.get("lang") === "id" ? "id" : "en";
    if (!question) {
      res.writeHead(400);
      return res.end("missing q");
    }
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });
    const send = (event, data) =>
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

    const mode = url.searchParams.get("mode") === "agent" ? "agent" : "chat";

    queue = queue
      .then(async () => {
        if (mode === "agent") {
          const ag = await getAgent();
          const t0 = performance.now();
          const { answer, toolTrace } = await ag.run(question, {
            onToken: (tok) => send("token", tok),
          });
          send("done", {
            stats: { ttftMs: null, durationMs: Math.round(performance.now() - t0), tokenCount: answer.length >> 2 },
            sources: toolTrace.map((t) => `🔧 ${t.tool}`),
          });
          return;
        }
        let asked = question;
        if (lang === "id") {
          const tr = await getTranslator();
          asked = (await tr.toEnglish(question)).trim();
          send("token", `🔁 ${asked}\n\n`);
        }
        const { answer, hits, stats } = await engine.ask(asked, {
          userName: (url.searchParams.get("me") || "").slice(0, 40) || undefined,
          onToken: lang === "en" ? (tok) => send("token", tok) : undefined,
          onReset: lang === "en" ? () => send("reset", 1) : undefined,
        });
        if (lang === "id") {
          const tr = await getTranslator();
          const indo = await tr.toIndonesian(answer.replace(/\[doc:[^\]]*\]/g, "").trim());
          send("token", indo.trim());
        }
        const sources = [
          ...new Set(
            hits.map((h) => /\[source: ([^\]]+)\]/.exec(h.content)?.[1]).filter(Boolean)
          ),
        ];
        send("done", { stats, sources });

        // Auto-capture: if the message REPORTED new measurements, save them as a
        // record (real-time) and tell the UI. Disable with &autosave=0.
        if (url.searchParams.get("autosave") !== "0") {
          try {
            const meName = (url.searchParams.get("me") || "You").slice(0, 40);
            const rec = await engine.extractRecord(question, new Date().toISOString().slice(0, 10), meName);
            if (rec) {
              const safe = `chat-${rec.member}-${Date.now()}`.replace(/[^a-z0-9._-]+/gi, "-");
              mkdirSync("data/records", { recursive: true });
              writeFileSync(join("data/records", `${safe}.txt`), rec.docText);
              await engine.ingestDocument({ source: safe, text: rec.docText });
              send("saved", { summary: rec.summary, member: rec.member });
            }
          } catch { /* extraction is best-effort */ }
        }
      })
      .catch((err) => send("error", String(err?.message ?? err)))
      .finally(() => res.end());
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/voice") {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", async () => {
      const wav = Buffer.concat(chunks);
      if (wav.length < 1000) {
        res.writeHead(400, { "content-type": "application/json" });
        return res.end(JSON.stringify({ error: "audio too short" }));
      }
      const tmp = join(tmpdir(), `gaffer-voice-${Date.now()}.wav`);
      writeFileSync(tmp, wav);
      try {
        const modelId = await getStt();
        const heard = await transcribe({ modelId, audioChunk: tmp });
        // Whisper may return a string, a {text}, or an array of segments.
        let text = "";
        if (typeof heard === "string") text = heard;
        else if (Array.isArray(heard)) text = heard.map((s) => s.text ?? "").join("");
        else text = heard?.text ?? "";
        text = text.replace(/\[(BLANK_AUDIO|.*?)\]/g, "").trim();
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ text }));
      } catch (err) {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: String(err?.message ?? err) }));
      } finally {
        try { unlinkSync(tmp); } catch {}
      }
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/info") {
    // Prefer real home-LAN IPs (192.168.x / 10.x) over virtual adapters (172.x Hyper-V/WSL).
    const score = (ip) => (ip.startsWith("192.168.") ? 0 : ip.startsWith("10.") ? 1 : 2);
    const ips = lanIps().sort((a, b) => score(a) - score(b));
    const httpUrls = ips.map((ip) => `http://${ip}:${HTTP_PORT}`);
    // HTTPS URLs are only reachable when TLS is actually on (mic/voice needs them).
    const httpsUrls = useTls ? ips.map((ip) => `https://${ip}:${PORT}`) : [];
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify({ joinUrls: httpUrls, httpsUrls, https: useTls, httpsPort: PORT, httpPort: HTTP_PORT, p2pKey }));
  }

  if (req.method === "GET" && url.pathname === "/api/teams") {
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify({ teams: loadTeams(), players: loadPlayers() }));
  }

  // Gaffer Pool: on-device fair odds from the analyst (mirrors demo-pool.js).
  if (req.method === "GET" && url.pathname === "/api/odds") {
    const probsQ = "Estimate the probability of each outcome for this match as three integer percentages that sum to 100. Reply with EXACTLY this one line, nothing else: HOME=<n>% DRAW=<n>% AWAY=<n>%";
    queue = queue
      .then(async () => {
        const { answer } = await engine.ask(probsQ, {});
        const probs = parseProbs(answer);
        const odds = Object.fromEntries(Object.entries(probs).map(([k, v]) => [k, +(1 / Math.max(v, 0.01)).toFixed(2)]));
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ match: "Real Madrid vs Manchester City — 2nd leg", probs, odds }));
      })
      .catch((e) => { res.writeHead(500); res.end(String(e?.message ?? e)); });
    return;
  }

  // Gaffer Pool: place a fixed-odds bet & settle it self-custodially (mirrors demo-pool.js).
  if (req.method === "POST" && url.pathname === "/api/bet") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", async () => {
      try {
        const { outcome, role, stake, odds, result } = JSON.parse(body);
        if (!OUTCOMES[outcome] || !OUTCOMES[result]) throw new Error("outcome/result must be one of HOME, DRAW, AWAY");
        if (role !== "back" && role !== "lay") throw new Error("role must be back or lay");
        const price = Number(odds), stakeAmt = Number(stake);
        if (!Number.isFinite(stakeAmt) || stakeAmt <= 0) throw new Error("stake must be a positive number");
        if (!Number.isFinite(price) || price <= 1) throw new Error("odds must be a number greater than 1");
        const backerIsUser = role === "back";
        const wallets = {};
        for (const who of ["user", "counterparty"]) {
          const wdk = new WDK(WDK.getRandomSeedPhrase());
          wdk.registerWallet("ethereum", WalletManagerEvm, { provider: process.env.POOL_RPC || "https://ethereum-sepolia-rpc.publicnode.com" });
          const acct = await wdk.getAccount("ethereum", 0);
          wallets[who] = { account: acct, address: await acct.getAddress() };
        }
        const backer = backerIsUser ? wallets.user : wallets.counterparty;
        const layer = backerIsUser ? wallets.counterparty : wallets.user;
        const liability = +(stakeAmt * (price - 1)).toFixed(2);
        const payout = +(stakeAmt * price).toFixed(2);
        const backerSig = await backer.account.sign(`Gaffer Pool | back ${outcome} @ ${price}x | ${backer.address}`);
        const layerSig = await layer.account.sign(`Gaffer Pool | lay ${outcome} @ ${price}x | ${layer.address}`);
        const backerWins = result === outcome;
        const from = backerWins ? layer : backer;
        const to = backerWins ? backer : layer;
        const amount = backerWins ? liability : stakeAmt;
        const tx = await WalletAccountEvm._getTransferTransaction({ token: USDT, recipient: to.address, amount: unitsUsdt(amount) });
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({
          outcome, role, odds: price, stake: stakeAmt, liability, payout, result,
          backer: backer.address, layer: layer.address, backerSig, layerSig,
          winnerIsUser: to === wallets.user, from: from.address, to: to.address,
          amount, token: USDT, calldata: tx.data,
        }));
      } catch (err) {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: String(err?.message ?? err) }));
      }
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/stop") {
    await engine.cancelCurrent();
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify({ ok: true }));
  }

  if (req.method === "GET" && url.pathname === "/api/speak") {
    const text = (url.searchParams.get("text") ?? "").slice(0, 800);
    if (!text) { res.writeHead(400); return res.end("missing text"); }
    queue = queue
      .then(async () => {
        const id = await getTts();
        const out = textToSpeech({ modelId: id, text, inputType: "text", stream: false });
        const samples = await out.buffer;
        const data = int16ToBuffer(samples);
        res.writeHead(200, { "content-type": "audio/wav" });
        res.end(Buffer.concat([wavHeader(data.length, 44100), data]));
      })
      .catch((err) => { res.writeHead(500); res.end(String(err?.message ?? err)); });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/import-csv") {
    const member = (url.searchParams.get("member") || "").slice(0, 40);
    const relation = url.searchParams.get("relation") === "self" ? "self" : "family";
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", async () => {
      try {
        if (!member) throw new Error("member query param required");
        // CSV rows: date,metric,value (header optional). metric in glucose|hba1c|ldl|chol|bp
        const map = { glucose: "Fasting glucose", hba1c: "HbA1c", ldl: "LDL", chol: "Total cholesterol", bp: "Blood pressure" };
        const unit = { glucose: "mg/dL", hba1c: "%", ldl: "mg/dL", chol: "mg/dL", bp: "mmHg" };
        const byDate = {};
        for (const line of body.split(/\r?\n/)) {
          const parts = line.split(",").map((s) => s.trim());
          if (parts.length < 3) continue;
          const [date, metricRaw, value] = parts;
          if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue; // skips header
          const metric = metricRaw.toLowerCase();
          if (!map[metric]) continue;
          (byDate[date] ??= []).push(`${map[metric]}: ${value} ${unit[metric]}`);
        }
        const dates = Object.keys(byDate);
        if (!dates.length) throw new Error("no valid rows (expected: date,metric,value)");
        let count = 0;
        for (const date of dates) {
          const docText = [`Patient: ${member}`, `Date: ${date}`, relation === "self" ? "Relation: self" : null, ...byDate[date]].filter(Boolean).join("\n");
          const safe = `csv-${member}-${date}`.replace(/[^a-z0-9._-]+/gi, "-");
          mkdirSync("data/records", { recursive: true });
          writeFileSync(join("data/records", `${safe}.txt`), docText);
          await engine.ingestDocument({ source: safe, text: docText });
          count++;
        }
        await engine.reindex();
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true, imported: count, dates }));
      } catch (err) {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: String(err?.message ?? err) }));
      }
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/upload-image") {
    const member = (url.searchParams.get("member") || "").slice(0, 40);
    const relation = url.searchParams.get("relation") === "self" ? "self" : "family";
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", async () => {
      const img = Buffer.concat(chunks);
      if (img.length < 200) { res.writeHead(400, { "content-type": "application/json" }); return res.end(JSON.stringify({ ok: false, error: "image too small" })); }
      const ext = (req.headers["content-type"] || "").includes("png") ? "png" : "jpg";
      const tmp = join(tmpdir(), `gaffer-upload-${Date.now()}.${ext}`);
      writeFileSync(tmp, img);
      queue = queue
        .then(async () => {
          const id = await getOcr();
          const { blocks } = ocr({ modelId: id, image: tmp, options: { paragraph: false } });
          const result = await blocks;
          const text = result.map((b) => b.text).join("\n");
          if (!text.trim()) throw new Error("no text found in image");
          // Attribute to a member: explicit param, else a "Patient:" line in the OCR.
          const who = member || /Patient:\s*([A-Za-z]+)/.exec(text)?.[1] || /Pasien:\s*([A-Za-z]+)/.exec(text)?.[1] || "Document";
          let doc = `Patient: ${who}\nScanned document (OCR ${new Date().toISOString().slice(0, 10)}).\n${text}`;
          if (relation === "self") doc = `Relation: self\n${doc}`;
          const safe = `photo-${who}-${Date.now()}`.replace(/[^a-z0-9._-]+/gi, "-");
          mkdirSync("data/records", { recursive: true });
          writeFileSync(join("data/records", `${safe}.txt`), doc);
          await engine.ingestDocument({ source: safe, text: doc });
          await engine.reindex();
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ ok: true, member: who, chars: text.length, preview: text.slice(0, 160) }));
        })
        .catch((err) => { res.writeHead(400, { "content-type": "application/json" }); res.end(JSON.stringify({ ok: false, error: String(err?.message ?? err) })); })
        .finally(() => { try { unlinkSync(tmp); } catch {} });
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/delete-record") {
    const raw = url.searchParams.get("source") || "";
    const safe = raw.replace(/[\\/]/g, ""); // no path traversal
    res.writeHead(200, { "content-type": "application/json" });
    if (!safe.endsWith(".txt")) return res.end(JSON.stringify({ ok: false, error: "invalid source" }));
    const p = join("data/records", safe);
    if (!existsSync(p)) return res.end(JSON.stringify({ ok: false, error: "not a removable record (sample docs are read-only)" }));
    queue = queue
      .then(async () => {
        unlinkSync(p);
        await engine.reseed(); // rebuild RAG so the deleted doc isn't retrievable
        res.end(JSON.stringify({ ok: true }));
      })
      .catch((err) => res.end(JSON.stringify({ ok: false, error: String(err?.message ?? err) })));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/ingest") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", async () => {
      try {
        const { source, text, member, relation } = JSON.parse(body);
        if (!source || !text) throw new Error("source and text required");
        // If a member name is given, ensure the doc is attributable on the
        // dashboard (it parses "Patient: <name>").
        let body2 = String(text).slice(0, 50_000);
        if (member && !/Patient:/i.test(body2)) body2 = `Patient: ${String(member).slice(0, 40)}\n${body2}`;
        if (relation === "self" && !/Relation:/i.test(body2)) body2 = `Relation: self\n${body2}`;
        const safe = String(source).slice(0, 80).replace(/[^a-z0-9._-]+/gi, "-");
        // Persist to data/records so the dashboard + chat both see it (real-time).
        mkdirSync("data/records", { recursive: true });
        writeFileSync(join("data/records", safe.endsWith(".txt") ? safe : `${safe}.txt`), body2);
        // Index into the RAG workspace for Q&A.
        await engine.ingestDocument({ source: safe, text: body2 });
        await engine.reindex();
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      } catch (err) {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: String(err?.message ?? err) }));
      }
    });
    return;
  }

  res.writeHead(404);
  res.end("not found");
}

const PFX = "certs/gaffer.pfx";
const useTls = existsSync(PFX) && process.env.GAFFER_HTTP !== "1";
const HTTP_PORT = PORT + 1; // plain-HTTP fallback (8788): no cert prompt; mic disabled

const lanIps = () =>
  Object.values(networkInterfaces())
    .flat()
    .filter((i) => i && i.family === "IPv4" && !i.internal)
    .map((i) => i.address);

if (useTls) {
  // Primary HTTPS (enables the phone mic) ...
  createHttpsServer({ pfx: readFileSync(PFX), passphrase: "sehat-lan" }, handler).listen(PORT, "0.0.0.0");
  // ... plus a plain-HTTP fallback on PORT+1 for phones that reject the
  // self-signed cert. Chat/dashboard/alerts work over it; only mic needs HTTPS.
  createHttpServer(handler).listen(HTTP_PORT, "0.0.0.0");
} else {
  createHttpServer(handler).listen(PORT, "0.0.0.0");
}

console.log("\n=== Gaffer is up ===");
for (const ip of lanIps()) {
  if (useTls) {
    console.log(`Phone (full, mic):   https://${ip}:${PORT}   (accept the cert warning once)`);
    console.log(`Phone (easy, no mic): http://${ip}:${HTTP_PORT}`);
  } else {
    console.log(`Open on your phone:  http://${ip}:${PORT}`);
  }
}
console.log(`Local:               ${useTls ? "https" : "http"}://localhost:${PORT}`);
if (GAFFER_PIN) console.log(`🔒 Access PIN required (GAFFER_PIN set).`);

if (process.env.GAFFER_P2P === "1") {
  startQVACProvider({}).then((p) => {
    if (p.success) { p2pKey = p.publicKey; console.log(`\nP2P provider public key (remote family node):\n${p.publicKey}`); }
  });
}
