// Gaffer Pool — P2P peer node (Pears track).
//   The pool is a signed, append-only Hypercore log on disk (a Pears building
//   block) — so it's tamper-evident and survives restarts — synced between peers
//   over Hyperswarm (another Pears block, not WebRTC). No server holds the pool:
//   each player is a peer that holds their own keys (WDK), records a SIGNED stake
//   in the log, and the match result is agreed by 2-of-2 co-signing — then the
//   losing side pays the winner directly in USDt from their own wallet. No cloud.
//
// Run two peers (two terminals / two devices), same pool code:
//   node src/pool-p2p.js <poolCode> Alice AWAY --result AWAY
//   node src/pool-p2p.js <poolCode> Bob   HOME
// The peer passed --result <R> proposes it once both have staked; both peers
// co-sign, then settle. Reuse the same POOL_SEED_A/B for stable demo wallets.
import Hyperswarm from "hyperswarm";
import Corestore from "corestore";
import crypto from "hypercore-crypto";
import b4a from "b4a";
import { join } from "node:path";
import WDK from "@tetherto/wdk";
import WalletManagerEvm, { WalletAccountEvm } from "@tetherto/wdk-wallet-evm";
import { loadModel, completion, QWEN3_1_7B_INST_Q4 } from "@qvac/sdk";
import { AuditLogger } from "./audit-logger.js";

const [poolCode, name, outcome] = process.argv.slice(2);
const role = process.argv.includes("--lay") ? "lay" : "back";
const oddsIdx = process.argv.indexOf("--odds");
const odds = oddsIdx > -1 ? Number(process.argv[oddsIdx + 1]) : NaN;
const resultFlagIdx = process.argv.indexOf("--result");
const proposedResult = resultFlagIdx > -1 ? process.argv[resultFlagIdx + 1] : null;
const wantEdge = process.argv.includes("--edge");

const OUTCOMES = { HOME: "Real Madrid win", DRAW: "Draw", AWAY: "Manchester City win" };
if (!poolCode || !name || !OUTCOMES[outcome] || !(odds > 1)) {
  console.error("Usage: node src/pool-p2p.js <poolCode> <name> <HOME|DRAW|AWAY> --odds <N> [--lay] [--result <R>] [--edge]");
  console.error("  A fixed-odds bet: one peer BACKS the outcome, the other LAYS it (both pass the same outcome & odds).");
  console.error("  Backer: MATCH1 Alice AWAY --odds 5 --result AWAY   |   Layer: MATCH1 Bob AWAY --odds 5 --lay");
  process.exit(1);
}
const MATCH = "Real Madrid vs Manchester City — Champions League 2nd leg";
const STAKE = 10, USDT_DECIMALS = 6;
const USDT = process.env.POOL_USDT || "0xd7e2Bc5F7D2690159c5d8E8B3A4648c8E1198e6B";
const RPC = process.env.POOL_RPC || "https://ethereum-sepolia-rpc.publicnode.com";
const units = (n) => BigInt(Math.round(n * 10 ** USDT_DECIMALS)).toString();
const log = new AuditLogger("artifacts/audit-log.jsonl");

// --- Self-custody wallet (WDK) ---
const seed = process.env[`POOL_SEED_${name[0].toUpperCase()}`] || WDK.getRandomSeedPhrase();
const wdk = new WDK(seed);
wdk.registerWallet("ethereum", WalletManagerEvm, { provider: RPC });
const account = await wdk.getAccount("ethereum", 0);
const myAddress = await account.getAddress();

const stakes = new Map();   // address -> { name, address, pick, stake }
const resultSigs = new Map(); // signer name -> { result, sig }
let attested = false, settled = false;

// --- Persistent pool log: a signed, append-only Hypercore on disk (a Pears
// building block). Every stake/result is recorded here, so the pool survives a
// restart and is tamper-evident; Hyperswarm below syncs it between peers. ---
const store = new Corestore(join(".gaffer-pool", `${poolCode}-${name.toLowerCase()}`));
const poolLog = store.get({ name: "pool", valueEncoding: "json" });
await poolLog.ready();
const seen = new Set();
const evKey = (ev) => ev.t === "stake" ? `s:${ev.address}` : ev.t === "result" ? `r:${ev.by}` : `x:${ev.by}`;
async function persist(ev) {           // append once; dedupe by event key
  if (seen.has(evKey(ev))) return;
  seen.add(evKey(ev));
  await poolLog.append(ev);
}
function absorb(ev) {                   // fold one event into in-memory state
  if (ev.t === "stake") stakes.set(ev.address, { name: ev.name, address: ev.address, role: ev.role, outcome: ev.outcome, odds: ev.odds, stake: ev.stake });
  else if (ev.t === "result") { resultSigs.set(ev.by, { result: ev.result, sig: ev.sig }); if (ev.by === name) attested = true; }
  else if (ev.t === "settled") settled = true;   // so a restart never re-settles (no double-pay)
}
if (poolLog.length > 0) {              // resume: replay the durable log from disk
  for (let i = 0; i < poolLog.length; i++) { const ev = await poolLog.get(i); seen.add(evKey(ev)); absorb(ev); }
  console.log(`♻️  resuming persistent Hypercore pool log — ${poolLog.length} entries on disk`);
  if (settled) { console.log("   this bet is already settled (recorded on disk) — nothing to do."); process.exit(0); }
}

// Optional: each peer runs its OWN on-device Gaffer edge before staking. Small
// model on CPU so two peers can share one GPU. Non-fatal — the pool works without it.
async function gafferEdge() {
  const ctx = `Match: Real Madrid vs Manchester City (2nd leg).
Man City: last-5 W W W D W, xG 12.1, single pivot Rodri available (their build-up depends on him).
Real Madrid: last-5 W W D W L, xG 9.8, right-back injury doubt, high line — dangerous on the counter via Bellingham.`;
  const id = await loadModel({
    modelSrc: QWEN3_1_7B_INST_Q4,
    modelType: "llm",
    modelConfig: { gpu_layers: 0, ctx_size: 2048, reasoning_budget: 0, system_prompt: "You are Gaffer, a concise on-device football analyst." },
  });
  const res = completion({
    modelId: id,
    history: [{ role: "user", content: `${ctx}\n\nIn ONE sentence, which outcome (home win / draw / away win) do you lean to, and why?` }],
    stream: true,
  });
  let raw = ""; for await (const t of res.tokenStream) raw += t;
  // ponytail: keep the model resident — unloading here tears down the QVAC worker
  // and interferes with the Hyperswarm init that follows in the same process.
  return raw.replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/^[\s\S]*?<\/think>/i, "").replace(/<\/?think>/gi, "").trim();
}

const stakeMsg = () => `Gaffer Pool | ${MATCH} | ${role} ${outcome} @ ${odds}x | stake=${STAKE} USDt | ${myAddress}`;
const resultMsg = (r) => `Gaffer Pool RESULT | ${MATCH} | result=${r}`;

console.log(`\n⚽ ${name} joined Gaffer Pool  (${MATCH})`);
console.log(`   wallet ${myAddress}  ·  ${role.toUpperCase()} ${outcome} (${OUTCOMES[outcome]}) @ ${odds}×  ·  stake ${STAKE} USDt`);
console.log(`   syncing over Hyperswarm (Pears) — no server…\n`);

if (wantEdge) {
  try {
    process.stdout.write("🧠 asking Gaffer on this device (Qwen3-1.7B, CPU)… ");
    const edge = await gafferEdge();
    console.log(`\n   Gaffer: ${edge}\n`);
    log.record({ event: "qvac-edge", player: name, edge });
  } catch (e) {
    console.log(`(edge skipped: ${e.message})\n`);
  }
}

const swarm = new Hyperswarm();
const conns = new Set();
const topic = crypto.hash(b4a.from(`gaffer-pool:${poolCode}`)); // 32-byte discovery topic

function broadcast(obj) {
  const line = JSON.stringify(obj) + "\n";
  for (const c of conns) { try { c.write(line); } catch {} }
}

async function recordMyStake() {
  const sig = await account.sign(stakeMsg());
  const ev = { t: "stake", name, address: myAddress, role, outcome, odds, stake: STAKE, sig };
  stakes.set(myAddress, { name, address: myAddress, role, outcome, odds, stake: STAKE });
  await persist(ev);                   // durable, signed record on disk
  return ev;
}

async function attest(result) {
  if (attested) return;
  attested = true;
  const sig = await account.sign(resultMsg(result));
  const ev = { t: "result", by: name, result, sig };
  resultSigs.set(name, { result, sig });
  await persist(ev);                   // durable, signed record on disk
  broadcast(ev);
  console.log(`✍️  ${name} co-signed result = ${result}`);
  log.record({ event: "result-attest", by: name, result, sig });
  maybeSettle(result);
}

async function maybeSettle(result) {
  if (settled) return;
  // Need both stakes and a 2-of-2 co-signed result that agree.
  const sigs = [...resultSigs.values()];
  const agreed = sigs.length >= 2 && sigs.every((s) => s.result === result);
  if (stakes.size < 2 || !agreed) return;
  settled = true;   // in-memory re-entry guard (stops a double maybeSettle within one run)

  // A fixed-odds bet: one back + one lay on the same outcome & odds. The odds
  // set the money — a winning back is paid the layer's liability = stake×(odds−1).
  const players = [...stakes.values()];
  const backer = players.find((p) => p.role === "back");
  const layer = players.find((p) => p.role === "lay");
  if (!backer || !layer || backer.outcome !== layer.outcome || backer.odds !== layer.odds) {
    console.log("\n⚠ Bet terms don't match — need one BACK and one LAY on the same outcome & odds. Void.");
    return finish();
  }
  const price = backer.odds, stake = backer.stake;
  const liability = +(stake * (price - 1)).toFixed(2);
  const backerWins = result === backer.outcome;
  const winner = backerWins ? backer : layer;
  const loser = backerWins ? layer : backer;
  const amount = backerWins ? liability : stake;   // odds-driven when the back wins
  console.log(`\n🏁 Result ${result} (${OUTCOMES[result]}) — co-signed 2/2.`);
  console.log(`   Bet: back ${backer.outcome} @ ${price}× for ${stake} USDt → ${winner.name} wins ${backerWins ? `${stake + liability} USDt (stake ${stake} + ${liability})` : `${stake} USDt`}.`);

  // Durable "settled" marker is written BEFORE broadcasting the transfer so a
  // restart can never pay twice. ponytail: this trades an irrecoverable double-pay
  // for a possible settled-but-unpaid if the transfer itself crashes/reverts
  // (recoverable — inspect the log and pay manually, or use the on-chain escrow).
  await persist({ t: "settled", by: name });

  // Self-custodial settlement: if I lost, I pay the winner the odds-driven amount
  // directly (honor-based — stakes are signed, not escrowed; escrow is contracts/PoolEscrow.sol).
  if (loser.address === myAddress) {
    const opts = { token: USDT, recipient: winner.address, amount: units(amount) };
    if (process.env.POOL_ONCHAIN === "1") {
      const tx = await account.transfer(opts);
      console.log(`🤝 ${name} → ${winner.name}: ${amount} USDt (tx ${tx?.hash ?? tx})`);
      log.record({ event: "settlement", from: name, to: winner.name, usdt: amount, odds: price, tx: tx?.hash ?? String(tx), onchain: true });
    } else {
      const tx = await WalletAccountEvm._getTransferTransaction(opts);
      console.log(`🤝 ${name} pays ${winner.name} ${amount} USDt — signed ERC-20 transfer ready:`);
      console.log(`     to(token) ${tx.to}  data ${tx.data.slice(0, 26)}…  (set POOL_ONCHAIN=1 to broadcast)`);
      log.record({ event: "settlement", from: name, to: winner.name, usdt: amount, odds: price, tokenTx: tx, onchain: false });
    }
  } else {
    console.log(`🏆 ${winner.name} wins ${amount} USDt from ${loser.name} at Gaffer's ${price}× — paid directly, keys never left the device.`);
  }
  finish();
}

function finish() {
  console.log("\n✅ Pool settled peer-to-peer. Nothing left your device.\n");
  setTimeout(() => { swarm.destroy(); process.exit(0); }, 500);
}

swarm.on("connection", async (conn) => {
  conns.add(conn);
  conn.on("error", () => {});
  conn.on("close", () => conns.delete(conn));

  // Greet the new peer with my stake.
  conn.write(JSON.stringify(await recordMyStake()) + "\n");

  let buf = "";
  conn.on("data", async (data) => {
    buf += b4a.toString(data);
    let nl;
    while ((nl = buf.indexOf("\n")) > -1) {
      const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
      if (!line.trim()) continue;
      let msg; try { msg = JSON.parse(line); } catch { continue; }

      if (msg.t === "stake" && msg.address === myAddress && msg.name !== name) {
        console.warn(`⚠ ${msg.name} shares your wallet address — give each player a distinct POOL_SEED_*.`);
        continue;
      }
      if (msg.t === "stake" && !stakes.has(msg.address)) {
        stakes.set(msg.address, { name: msg.name, address: msg.address, role: msg.role, outcome: msg.outcome, odds: msg.odds, stake: msg.stake });
        await persist(msg);            // record the peer's signed stake on disk
        console.log(`📥 ${msg.name} ${msg.role}s ${msg.outcome} @ ${msg.odds}× (${msg.stake} USDt)  (${msg.address.slice(0, 10)}…)`);
        log.record({ event: "peer-stake", name: msg.name, address: msg.address, role: msg.role, outcome: msg.outcome, odds: msg.odds, stake: msg.stake });
        // Once both are in, the proposer kicks off the co-signed result.
        if (stakes.size >= 2 && proposedResult) await attest(proposedResult);
      } else if (msg.t === "result") {
        resultSigs.set(msg.by, { result: msg.result, sig: msg.sig });
        await persist(msg);            // record the peer's co-signature on disk
        console.log(`📥 ${msg.by} co-signed result = ${msg.result}`);
        await attest(msg.result);        // counter-sign, then settle if 2/2
        await maybeSettle(msg.result);
      }
    }
  });
});

await recordMyStake();               // seed my own stake locally
swarm.join(topic, { server: true, client: true });
await swarm.flush();
console.log("🔗 announced on the pool topic — waiting for the other player…");

// Safety: don't hang forever if the peer never shows.
setTimeout(() => { if (!settled) { console.log("\n⌛ No settlement (peer/result missing). Exiting."); swarm.destroy(); process.exit(0); } }, 120000);
