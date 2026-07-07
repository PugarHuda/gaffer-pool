// Gaffer Pool — a trustless P2P football prediction pool.
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
import { SehatEngine } from "./engine.js";
import { AuditLogger } from "./audit-logger.js";

const log = new AuditLogger("artifacts/audit-log.jsonl");
const RPC = process.env.POOL_RPC || "https://ethereum-sepolia-rpc.publicnode.com";
// A test ERC-20 standing in for USDt on Sepolia. Override with the real one.
const USDT = process.env.POOL_USDT || "0x7169D38820dfd117C3FA1f22a697dBA58d90BA06";
const USDT_DECIMALS = 6;
const STAKE = 10; // USDt each
const units = (n) => BigInt(Math.round(n * 10 ** USDT_DECIMALS)).toString();

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

async function main() {
  console.log(`\n⚽ Gaffer Pool — ${MATCH}`);
  console.log("   QVAC (on-device AI edge) + WDK (self-custody USDt) — no house, no cloud.\n");

  const alice = await makePlayer("Alice", "POOL_SEED_A");
  const bob = await makePlayer("Bob", "POOL_SEED_B");
  console.log(`Alice  ${alice.address}`);
  console.log(`Bob    ${bob.address}\n`);

  // --- 2. QVAC edge: the analyst reads the local corpus and briefs the pool. ---
  const engine = new SehatEngine();
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
  await engine.stop();

  // --- 3. Each player picks and SIGNS their stake with their own key. ---
  // Alice trusts the analyst (away/City); Bob takes the home side.
  const picks = [
    { player: alice, outcome: "AWAY" },
    { player: bob, outcome: "HOME" },
  ];
  console.log(`\n💸 Each stakes ${STAKE} USDt and signs the commitment with their own key:\n`);
  for (const p of picks) {
    const commitment = `Gaffer Pool | ${MATCH} | pick=${p.outcome} (${OUTCOMES[p.outcome]}) | stake=${STAKE} USDt | ${p.player.address}`;
    const signature = await p.player.account.sign(commitment);
    p.signature = signature;
    console.log(`  ${p.player.name}: ${p.outcome} — sig ${String(signature).slice(0, 24)}…`);
    log.record({ event: "stake-commitment", player: p.player.name, outcome: p.outcome, stakeUsdt: STAKE, signature });
  }

  // --- 4. Result → winner takes the pot. ---
  const result = process.env.POOL_RESULT || "AWAY";
  const winners = picks.filter((p) => p.outcome === result);
  const losers = picks.filter((p) => p.outcome !== result);
  const pot = picks.length * STAKE;
  console.log(`\n🏁 Result: ${result} (${OUTCOMES[result]}). Pot = ${pot} USDt.`);
  assert(winners.length + losers.length === picks.length);

  if (!winners.length) {
    console.log("No winner this round — stakes roll over.");
    return;
  }
  const winner = winners[0].player;
  const share = pot / winners.length;

  // --- 5. Trustless settlement: losers pay the winner directly in USDt. ---
  //     No escrow, no operator — a real WDK-built ERC-20 transfer per loser.
  console.log(`\n🤝 Settlement — losers pay ${winner.name} directly (no house):`);
  for (const l of losers) {
    const opts = { token: USDT, recipient: winner.address, amount: units(STAKE) };
    if (process.env.POOL_ONCHAIN === "1") {
      const tx = await l.player.account.transfer(opts); // broadcasts on Sepolia
      console.log(`  ${l.player.name} → ${winner.name}: ${STAKE} USDt, tx ${tx?.hash ?? tx}`);
      log.record({ event: "settlement", from: l.player.name, to: winner.name, usdt: STAKE, tx: tx?.hash ?? String(tx), onchain: true });
    } else {
      // Build the exact ERC-20 transfer this wallet would sign & broadcast.
      const tx = await WalletAccountEvm._getTransferTransaction(opts);
      console.log(`  ${l.player.name} → ${winner.name}: ${STAKE} USDt`);
      console.log(`     to(token) ${tx.to}  data ${tx.data.slice(0, 26)}…`);
      log.record({ event: "settlement", from: l.player.name, to: winner.name, usdt: STAKE, tokenTx: tx, onchain: false });
    }
  }
  console.log(`\n✅ ${winner.name} wins ${share} USDt. Keys stayed with their owners; nothing left the devices.`);
  console.log("   (Set POOL_ONCHAIN=1 with funded Sepolia wallets to broadcast for real.)\n");
  log.record({ event: "pool-settled", winner: winner.name, potUsdt: pot });
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
