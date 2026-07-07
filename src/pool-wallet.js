// Funding helper for a real on-chain Gaffer Pool settlement (WDK, Sepolia).
// Prints the players' self-custodial addresses and a runbook so you can fund
// them from a faucet, then run the pool with POOL_ONCHAIN=1 to broadcast a real
// USDt transfer. Run: `npm run pool:wallet`.
import WDK from "@tetherto/wdk";
import WalletManagerEvm from "@tetherto/wdk-wallet-evm";

const RPC = process.env.POOL_RPC || "https://ethereum-sepolia-rpc.publicnode.com";
const USDT = process.env.POOL_USDT || "0x7169D38820dfd117C3FA1f22a697dBA58d90BA06";

async function addr(name, envKey) {
  const provided = process.env[envKey];
  const seed = provided || WDK.getRandomSeedPhrase();
  const wdk = new WDK(seed);
  wdk.registerWallet("ethereum", WalletManagerEvm, { provider: RPC });
  const account = await wdk.getAccount("ethereum", 0);
  const address = await account.getAddress();
  return { name, envKey, address, seed, generated: !provided };
}

const players = [await addr("Alice", "POOL_SEED_A"), await addr("Bob", "POOL_SEED_B")];

console.log("\n🔑 Gaffer Pool wallets (self-custody, WDK):\n");
for (const p of players) {
  console.log(`  ${p.name}  ${p.address}`);
  if (p.generated) console.log(`     ⚠ no ${p.envKey} set — generated seed (save it or the address changes):\n     ${p.envKey}="${p.seed}"`);
}

console.log(`\n💧 To broadcast a real settlement on Sepolia testnet:`);
console.log(`  1. Save the seeds above as POOL_SEED_A / POOL_SEED_B (stable addresses).`);
console.log(`  2. Fund the LOSER's wallet with Sepolia ETH (gas) + test USDt:`);
console.log(`       ETH faucet:  https://sepolia-faucet.pk910.de  or  https://www.alchemy.com/faucets/ethereum-sepolia`);
console.log(`       USDt token:  ${USDT}  (or set POOL_USDT to your test token)`);
console.log(`  3. Run the pool on-chain:`);
console.log(`       POOL_ONCHAIN=1 POOL_SEED_A="…" POOL_SEED_B="…" npm run demo:pool`);
console.log(`     (or the P2P version: POOL_ONCHAIN=1 npm run pool:p2p -- <code> <name> <pick> [--result R])\n`);
process.exit(0);
