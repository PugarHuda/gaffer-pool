// Gaffer Pool — P2P peer node (Pears track).
//   Pool state syncs between devices over Hyperswarm (a real Pears building
//   block, not WebRTC). No server holds the pool: each player is a peer that
//   holds their own keys (WDK), broadcasts a SIGNED stake, and the match result
//   is agreed by 2-of-2 co-signing — then losers pay the winner directly in
//   USDt from their own wallet. No house, no cloud.
//
// Run two peers (two terminals / two devices), same pool code:
//   node src/pool-p2p.js <poolCode> Alice AWAY --result AWAY
//   node src/pool-p2p.js <poolCode> Bob   HOME
// The peer passed --result <R> proposes it once both have staked; both peers
// co-sign, then settle. Reuse the same POOL_SEED_A/B for stable demo wallets.
import Hyperswarm from "hyperswarm";
import crypto from "hypercore-crypto";
import b4a from "b4a";
import WDK from "@tetherto/wdk";
import WalletManagerEvm, { WalletAccountEvm } from "@tetherto/wdk-wallet-evm";
import { loadModel, completion, QWEN3_1_7B_INST_Q4 } from "@qvac/sdk";
import { AuditLogger } from "./audit-logger.js";

const [poolCode, name, pick] = process.argv.slice(2);
const resultFlagIdx = process.argv.indexOf("--result");
const proposedResult = resultFlagIdx > -1 ? process.argv[resultFlagIdx + 1] : null;
const wantEdge = process.argv.includes("--edge");
if (!poolCode || !name || !pick) {
  console.error("Usage: node src/pool-p2p.js <poolCode> <name> <HOME|DRAW|AWAY> [--result <R>]");
  process.exit(1);
}

const OUTCOMES = { HOME: "Real Madrid win", DRAW: "Draw", AWAY: "Manchester City win" };
const MATCH = "Real Madrid vs Manchester City — Champions League 2nd leg";
const STAKE = 10, USDT_DECIMALS = 6;
const USDT = process.env.POOL_USDT || "0x7169D38820dfd117C3FA1f22a697dBA58d90BA06";
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

const stakeMsg = () => `Gaffer Pool | ${MATCH} | pick=${pick} | stake=${STAKE} USDt | ${myAddress}`;
const resultMsg = (r) => `Gaffer Pool RESULT | ${MATCH} | result=${r}`;

console.log(`\n⚽ ${name} joined Gaffer Pool  (${MATCH})`);
console.log(`   wallet ${myAddress}  ·  pick ${pick} (${OUTCOMES[pick]})  ·  stake ${STAKE} USDt`);
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
  stakes.set(myAddress, { name, address: myAddress, pick, stake: STAKE });
  return { t: "stake", name, address: myAddress, pick, stake: STAKE, sig };
}

async function attest(result) {
  if (attested) return;
  attested = true;
  const sig = await account.sign(resultMsg(result));
  resultSigs.set(name, { result, sig });
  broadcast({ t: "result", by: name, result, sig });
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
  settled = true;

  const players = [...stakes.values()];
  const pot = players.length * STAKE;
  const winners = players.filter((p) => p.pick === result);
  console.log(`\n🏁 Result ${result} (${OUTCOMES[result]}) — co-signed 2/2. Pot ${pot} USDt.`);
  if (!winners.length) { console.log("No winner — stakes roll over."); return finish(); }
  const winner = winners[0];

  // Trustless settlement: if I lost, I pay the winner directly from my wallet.
  if (winner.address !== myAddress) {
    const opts = { token: USDT, recipient: winner.address, amount: units(STAKE) };
    if (process.env.POOL_ONCHAIN === "1") {
      const tx = await account.transfer(opts);
      console.log(`🤝 ${name} → ${winner.name}: ${STAKE} USDt (tx ${tx?.hash ?? tx})`);
      log.record({ event: "settlement", from: name, to: winner.name, usdt: STAKE, tx: tx?.hash ?? String(tx), onchain: true });
    } else {
      const tx = await WalletAccountEvm._getTransferTransaction(opts);
      console.log(`🤝 ${name} pays ${winner.name} ${STAKE} USDt — signed ERC-20 transfer ready:`);
      console.log(`     to(token) ${tx.to}  data ${tx.data.slice(0, 26)}…  (set POOL_ONCHAIN=1 to broadcast)`);
      log.record({ event: "settlement", from: name, to: winner.name, usdt: STAKE, tokenTx: tx, onchain: false });
    }
  } else {
    console.log(`🏆 ${winner.name} wins the ${pot} USDt pot — paid directly by peers, keys never left the device.`);
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

      if (msg.t === "stake" && !stakes.has(msg.address)) {
        stakes.set(msg.address, { name: msg.name, address: msg.address, pick: msg.pick, stake: msg.stake });
        console.log(`📥 ${msg.name} staked ${msg.stake} USDt on ${msg.pick}  (${msg.address.slice(0, 10)}…)`);
        log.record({ event: "peer-stake", name: msg.name, address: msg.address, pick: msg.pick, stake: msg.stake });
        // Once both are in, the proposer kicks off the co-signed result.
        if (stakes.size >= 2 && proposedResult) await attest(proposedResult);
      } else if (msg.t === "result") {
        resultSigs.set(msg.by, { result: msg.result, sig: msg.sig });
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
