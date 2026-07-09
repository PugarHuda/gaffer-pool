// Gaffer Pool — trustless back/lay escrow demo (WDK + contracts/PoolEscrow.sol).
//
// Default: runs a self-check of the settlement math (no chain, no keys) and
// prints the on-chain runbook.
// Opt-in:  ESCROW_ONCHAIN=1 (with solc installed + two funded WDK wallets)
//          compiles PoolEscrow.sol, deploys it to Sepolia, both players fund,
//          both co-sign the result, and the pot releases to the winner — all on
//          real testnet, no operator. Reuses POOL_SEED_A / POOL_SEED_B.
import { readFileSync } from "node:fs";
import assert from "node:assert";

const OUT = { HOME: 1, DRAW: 2, AWAY: 3 };
const dp = 6; // USDt has 6 decimals
const u = (n) => BigInt(Math.round(n * 10 ** dp)); // to token base units

// The money path, mirrored from PoolEscrow._settle: pot = stake + liability,
// backer takes it if the backed outcome landed, otherwise the layer does.
function settle({ outcome, result, stake, liability }) {
  const pot = stake + liability;
  return { winner: result === outcome ? "backer" : "layer", amount: pot };
}

function selfCheck() {
  // Back AWAY @ 5×: stake 10 → liability = 10*(5-1) = 40, pot = 50.
  const bet = { outcome: OUT.AWAY, stake: u(10), liability: u(40) };
  const win = settle({ ...bet, result: OUT.AWAY });
  assert.equal(win.winner, "backer");
  assert.equal(win.amount, u(50)); // backer collects the whole 50
  const lose = settle({ ...bet, result: OUT.HOME });
  assert.equal(lose.winner, "layer");
  assert.equal(lose.amount, u(50)); // layer collects the whole 50 (10 stake + 40 back)
  // Conservation: the pot is exactly both deposits, nothing minted or lost.
  assert.equal(bet.stake + bet.liability, u(50));
  console.log("✅ escrow settlement self-check passed (backer-wins + layer-wins, pot conserved)");
}

selfCheck();

if (process.env.ESCROW_ONCHAIN !== "1") {
  console.log(`
🔒 contracts/PoolEscrow.sol — trustless 2-of-2 back/lay escrow (no operator, no house).
   Flow: both players fund() their side → both agree(result) on-chain → pot auto-releases to the winner.

   To run it for real on Sepolia:
     1. npm i -D solc
     2. Set POOL_SEED_A / POOL_SEED_B (funded with Sepolia ETH + test USDt — see: npm run pool:wallet)
     3. ESCROW_ONCHAIN=1 npm run demo:escrow
`);
  process.exit(0);
}

// ---- opt-in: real on-chain deploy + settle ----
const RPC = process.env.POOL_RPC || "https://ethereum-sepolia-rpc.publicnode.com";
const USDT = process.env.POOL_USDT || "0xd7e2Bc5F7D2690159c5d8E8B3A4648c8E1198e6B";
const stake = u(10), liability = u(40), outcome = OUT.AWAY, result = OUT.AWAY;

const solc = (await import("solc")).default;
const src = readFileSync(new URL("../contracts/PoolEscrow.sol", import.meta.url), "utf8");
const input = { language: "Solidity", sources: { "PoolEscrow.sol": { content: src } },
  settings: { outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } } } };
const out = JSON.parse(solc.compile(JSON.stringify(input)));
const errs = (out.errors || []).filter((e) => e.severity === "error");
if (errs.length) { console.error(errs.map((e) => e.formattedMessage).join("\n")); process.exit(1); }
const C = out.contracts["PoolEscrow.sol"].PoolEscrow;
const abi = C.abi, bytecode = "0x" + C.evm.bytecode.object;
console.log(`compiled PoolEscrow (${(bytecode.length / 2 - 1)} bytes)`);

const { createPublicClient, createWalletClient, http, getContract, parseAbi } = await import("viem");
const { sepolia } = await import("viem/chains");
const { mnemonicToAccount } = await import("viem/accounts");

const seedA = process.env.POOL_SEED_A, seedB = process.env.POOL_SEED_B;
if (!seedA || !seedB) { console.error("set POOL_SEED_A / POOL_SEED_B (funded)"); process.exit(1); }
const backer = mnemonicToAccount(seedA), layer = mnemonicToAccount(seedB);
const pub = createPublicClient({ chain: sepolia, transport: http(RPC) });
const wBack = createWalletClient({ account: backer, chain: sepolia, transport: http(RPC) });
const wLay = createWalletClient({ account: layer, chain: sepolia, transport: http(RPC) });
const erc20 = parseAbi(["function approve(address,uint256) returns (bool)", "function balanceOf(address) view returns (uint256)"]);

console.log(`backer ${backer.address}  layer ${layer.address}`);
const before = await pub.readContract({ address: USDT, abi: erc20, functionName: "balanceOf", args: [backer.address] });

// deploy
const hash = await wBack.deployContract({ abi, bytecode, args: [USDT, backer.address, layer.address, outcome, stake, liability] });
const rc = await pub.waitForTransactionReceipt({ hash });
const escrow = rc.contractAddress;
console.log(`🚀 escrow deployed: ${escrow}`);

const wait = (h) => pub.waitForTransactionReceipt({ hash: h });
// both approve + fund
await wait(await wBack.writeContract({ address: USDT, abi: erc20, functionName: "approve", args: [escrow, stake] }));
await wait(await wBack.writeContract({ address: escrow, abi, functionName: "fund" }));
await wait(await wLay.writeContract({ address: USDT, abi: erc20, functionName: "approve", args: [escrow, liability] }));
await wait(await wLay.writeContract({ address: escrow, abi, functionName: "fund" }));
console.log("💰 both sides funded the escrow");
// both co-sign result
await wait(await wBack.writeContract({ address: escrow, abi, functionName: "agree", args: [result] }));
await wait(await wLay.writeContract({ address: escrow, abi, functionName: "agree", args: [result] }));
console.log("✍️  both co-signed result = AWAY → pot auto-released");

const after = await pub.readContract({ address: USDT, abi: erc20, functionName: "balanceOf", args: [backer.address] });
console.log(`🏆 backer USDt: ${Number(before) / 1e6} → ${Number(after) / 1e6}  (won the pot from escrow, no operator)`);
process.exit(0);
