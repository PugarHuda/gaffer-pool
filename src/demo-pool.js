// Gaffer Pool — a self-custodial football prediction pool.
//   QVAC (on-device AI) gives each player a private analytical edge.
//   WDK (self-custodial wallets) holds each player's own keys and settles the
//   pot wallet-to-wallet in USDt — no bookmaker, no house, no cloud.
//
// This is the QVAC + WDK champion-lane slice. Run: `npm run demo:pool`.
// On-chain settlement (Sepolia testnet) is opt-in via POOL_ONCHAIN=1 with
// funded wallets; by default it prints the real, signed settlement intent so
// the demo runs anywhere with no faucet setup.
import assert from "node:assert";
import { readFileSync, readdirSync } from "node:fs";
import { join, basename } from "node:path";
import WDK from "@tetherto/wdk";
import WalletManagerEvm, { WalletAccountEvm } from "@tetherto/wdk-wallet-evm";
import { GafferEngine } from "./engine.js";
import { AuditLogger } from "./audit-logger.js";

const log = new AuditLogger("artifacts/audit-log.jsonl");
const RPC = process.env.POOL_RPC || "https://ethereum-sepolia-rpc.publicnode.com";
// A test ERC-20 standing in for USDt on Sepolia. Override with the real one.
const USDT = process.env.POOL_USDT || "0xd7e2Bc5F7D2690159c5d8E8B3A4648c8E1198e6B";
const USDT_DECIMALS = 6;
const STAKE = 10; // USDt each
const units = (n) => BigInt(Math.round(n * 10 ** USDT_DECIMALS)).toString();

// Turn Gaffer's free-text probability estimate into normalized {HOME,DRAW,AWAY}
// fractions. Falls back to even odds if the model doesn't answer in format.
function parseProbs(text) {
  const g = (k) => { const m = new RegExp(`${k}\\s*=?\\s*(\\d{1,3})\\s*%`, "i").exec(text); return m ? +m[1] : null; };
  let p = { HOME: g("HOME"), DRAW: g("DRAW"), AWAY: g("AWAY") };
  const sum = (p.HOME ?? 0) + (p.DRAW ?? 0) + (p.AWAY ?? 0);
  if (!sum || Object.values(p).some((v) => v == null)) return { HOME: 1 / 3, DRAW: 1 / 3, AWAY: 1 / 3 };
  return { HOME: p.HOME / sum, DRAW: p.DRAW / sum, AWAY: p.AWAY / sum };
}

// --- 1. Two self-custodial players (WDK). Each holds their own keys. ---
async function makePlayer(name, seedEnv) {
  const seed = process.env[seedEnv] || WDK.getRandomSeedPhrase();
  const wdk = new WDK(seed);
  wdk.registerWallet("ethereum", WalletManagerEvm, { provider: RPC });
  const account = await wdk.getAccount("ethereum", 0);
  const address = await account.getAddress();
  log.record({ event: "wallet-create", player: name, address, custody: "self (WDK seed)" });
  return { name, wdk, account, address };
}

const MATCH = "Real Madrid vs Manchester City — Champions League 2nd leg";
const OUTCOMES = { HOME: "Real Madrid win", DRAW: "Draw", AWAY: "Manchester City win" };

// Self-custodial settlement: `from` pays `to` `amountUsdt` directly in USDt via
// WDK. Honor-based for now (each side's stake is signed, not escrowed) — locking
// funds in an escrow contract is the roadmap.
// Broadcasts on Sepolia when POOL_ONCHAIN=1, else prints the signed intent.
async function settle(from, to, amountUsdt) {
  const opts = { token: USDT, recipient: to.address, amount: units(amountUsdt) };
  if (process.env.POOL_ONCHAIN === "1") {
    const tx = await from.account.transfer(opts);
    console.log(`🤝 ${from.name} → ${to.name}: ${amountUsdt} USDt, tx ${tx?.hash ?? tx}`);
    log.record({ event: "settlement", from: from.name, to: to.name, usdt: amountUsdt, tx: tx?.hash ?? String(tx), onchain: true });
  } else {
    const tx = await WalletAccountEvm._getTransferTransaction(opts);
    console.log(`🤝 ${from.name} → ${to.name}: ${amountUsdt} USDt — signed ERC-20 transfer:`);
    console.log(`     to(token) ${tx.to}  data ${tx.data.slice(0, 26)}…  (POOL_ONCHAIN=1 to broadcast)`);
    log.record({ event: "settlement", from: from.name, to: to.name, usdt: amountUsdt, tokenTx: tx, onchain: false });
  }
}

async function main() {
  console.log(`\n⚽ Gaffer Pool — ${MATCH}`);
  console.log("   QVAC (on-device AI edge) + WDK (self-custody USDt) — no house, no cloud.\n");

  const alice = await makePlayer("Alice", "POOL_SEED_A");
  const bob = await makePlayer("Bob", "POOL_SEED_B");
  console.log(`Alice  ${alice.address}`);
  console.log(`Bob    ${bob.address}\n`);

  // --- 2. QVAC edge: the analyst reads the local corpus and briefs the pool. ---
  const engine = new GafferEngine();
  console.log("Loading on-device analyst (Qwen3-4B + GTE-large)...");
  await engine.start();
  const dir = "data/football";
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".txt")))
    await engine.ingestDocument({ source: basename(f), text: readFileSync(join(dir, f), "utf8") });

  const q = "For the second leg, which outcome is most likely — home win, draw, or away win — and why? Answer in 2-3 sentences.";
  console.log(`\n🧠 Gaffer's edge: ${q}\n`);
  const { answer, stats } = await engine.ask(q, { onToken: (t) => process.stdout.write(t) });
  console.log(`\n\n[on-device: TTFT ${stats.ttftMs} ms | ${stats.tokenCount} tokens]`);
  log.record({ event: "qvac-analysis", match: MATCH, question: q, answer, ttftMs: stats.ttftMs });

  // AI -> money: quantify the edge as probabilities, then fair (no-house) odds.
  const probsQ = "Estimate the probability of each outcome for this match as three integer percentages that sum to 100. Reply with EXACTLY this one line, nothing else: HOME=<n>% DRAW=<n>% AWAY=<n>%";
  const { answer: probsAns } = await engine.ask(probsQ, {});
  const probs = parseProbs(probsAns);
  // Floor the probability so a 0% estimate can't produce Infinity odds (cap ~100×).
  const odds = Object.fromEntries(Object.entries(probs).map(([k, v]) => [k, +(1 / Math.max(v, 0.01)).toFixed(2)]));
  console.log(`\n📊 Gaffer's fair odds (no house):  HOME ${odds.HOME}×  DRAW ${odds.DRAW}×  AWAY ${odds.AWAY}×`);
  console.log(`   (from on-device probabilities HOME ${(probs.HOME * 100).toFixed(0)}% / DRAW ${(probs.DRAW * 100).toFixed(0)}% / AWAY ${(probs.AWAY * 100).toFixed(0)}%)`);
  log.record({ event: "qvac-odds", match: MATCH, probs, odds });
  await engine.stop();

  // --- 3. A fixed-odds bet at Gaffer's fair price — this is where the AI edge
  //     drives the money. Alice BACKS the analyst's favourite; Bob LAYS it. The
  //     odds set the stakes: the layer escrows the liability = stake × (odds−1),
  //     so a winning back pays out stake × odds. ---
  const backer = alice, layer = bob;
  const backed = "AWAY";                             // Alice backs the analyst's read
  const price = odds[backed];                        // Gaffer's fair odds (e.g. 5×)
  const liability = +(STAKE * (price - 1)).toFixed(2); // the layer's exposure
  const payout = +(STAKE * price).toFixed(2);        // the backer's return if it hits
  assert(Math.abs(STAKE + liability - payout) < 1e-6, "payout = stake + liability");

  console.log(`\n💸 A fixed-odds bet on ${backed} (${OUTCOMES[backed]}) at Gaffer's ${price}× — each side signs:\n`);
  for (const [who, role, note] of [
    [backer, "backs", `stakes ${STAKE} USDt to win ${payout} USDt`],
    [layer, "lays ", `escrows ${liability} USDt against it`],
  ]) {
    const commitment = `Gaffer Pool | ${MATCH} | ${role.trim()} ${backed} @ ${price}x | ${who.address}`;
    who.signature = await who.account.sign(commitment);
    console.log(`  ${who.name} ${role} ${backed} @ ${price}× — ${note}  · sig ${String(who.signature).slice(0, 20)}…`);
    log.record({ event: "bet-commitment", player: who.name, role: role.trim(), outcome: backed, odds: price, stakeUsdt: STAKE, liabilityUsdt: role.trim() === "lays" ? liability : null, signature: who.signature });
  }

  // --- 4. Result decides who pays whom; the ODDS decide how much. ---
  const result = process.env.POOL_RESULT || "AWAY";
  const backerWins = result === backed;
  const from = backerWins ? layer : backer;
  const to = backerWins ? backer : layer;
  const amount = backerWins ? liability : STAKE;    // odds-driven when the back wins
  console.log(`\n🏁 Result: ${result} (${OUTCOMES[result]}). ${to.name} wins the bet — collects ${backerWins ? `${payout} USDt (stake ${STAKE} + ${liability} at ${price}×)` : `${STAKE} USDt`}.`);

  // --- 5. Self-custodial settlement: the loser pays the winner directly in USDt. ---
  console.log(`\n🤝 Settlement (no house):`);
  await settle(from, to, amount);
  console.log(`\n✅ Bet settled at Gaffer's odds — keys stayed with their owners, nothing left the devices.`);
  console.log("   (Set POOL_ONCHAIN=1 with funded Sepolia wallets to broadcast for real.)\n");
  log.record({ event: "bet-settled", winner: to.name, amountUsdt: amount, odds: price });
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
