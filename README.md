# Gaffer Pool ⚽

**A football prediction game where the AI analyst, the money, and the network all run on your own device — no house, no cloud, your keys.**

Gaffer Pool is a Tether Developers Cup entry that combines **three** Tether tracks in one football-native product: an on-device match analyst (QVAC), self-custodial USDt stakes among friends (WDK), and peer-to-peer pool sync (Pears).

---

## The problem — and why the full Tether stack fits football

Friends already predict match results and put a little money on it. Today that means handing your picks to a cloud app, your money to a bookmaker, and your data to whoever runs the servers. Three parties you have to trust, none of them you.

Football is the perfect shape for the whole Tether stack because the three problems map one-to-one onto three tracks:

- You want an **edge** (who's in form, who's injured, how the tactics match up) → a private on-device analyst. **QVAC.**
- You want to **stake** with friends without a bookmaker holding the pot → self-custodial wallets that settle wallet-to-wallet. **WDK.**
- You want the group's pool to **stay in sync** without a server → peers gossip state directly. **Pears.**

The AI is each player's private advisor, the money layer is self-custodial, the network layer is peer-to-peer. That trio — all three tracks in one product — is the pitch.

---

## The three tracks, and how each is really used

### 1. QVAC — the on-device analyst ("Gaffer")

Runs **Qwen3-4B** (general LLM) + **GTE-large** embeddings **100% locally** via the `@qvac/sdk`. No cloud, no API keys. It does RAG over a local football corpus in `data/football/` (club and player profiles, a match report, tactics, set-pieces) and answers analyst questions grounded in — and citing — those source docs.

```bash
npm run demo:analyst
```

You'll see it ingest the corpus, then answer three scouting questions with live token streaming and per-answer stats:

```
[search 41 ms | TTFT 380 ms | 512 tokens | 24.3 tok/s]
```

### 2. WDK — self-custodial stakes, no bookmaker

Each player holds their **own** keys — a self-custodial WDK wallet (`@tetherto/wdk` + `@tetherto/wdk-wallet-evm`: seed phrase → EVM account). Each player **signs their own stake commitment** with their own key, and the pot settles **wallet-to-wallet in USDt** via a real ERC-20 transfer. No bookmaker, no house, no cloud holds the money.

```bash
npm run demo:pool
```

Prints each player's self-custody address, their signed commitment, the winner, and the settlement — a real ERC-20 `transfer` calldata (`0xa9059cbb…`):

```
Alice  0x…
Bob    0x…
  Alice: HOME — sig 0x…
  Bob:   AWAY — sig 0x…
🤝 Settlement — losers pay the winner directly (no house):
     to(token) 0x…  data 0xa9059cbb…
```

Gaffer also turns its edge into **money**: it estimates each outcome's probability on-device and the pool shows the **fair, no-house odds** (e.g. `AWAY 5×`), so a pick's payout reflects the AI's read.

On-chain broadcast is **opt-in**: set `POOL_ONCHAIN=1` with funded Sepolia wallets to broadcast for real. By default it prints the signed settlement intent, so it runs **anywhere with no faucet**. `npm run pool:wallet` prints the wallets to fund and the exact runbook.

**Verified on-chain (Sepolia): a real USDt settlement.** The loser's self-custodial WDK wallet signed and broadcast a **USDt ERC-20 transfer** to the winner —
[settlement tx `0xf11cdb…`](https://sepolia.etherscan.io/tx/0xf11cdbeb3c722c29553f64e0b0d2ff1b468f3c3ddd450462af65ef572a2afdfc) (status: success). After it, on-chain balances read Alice 10 USDt / Bob 10 USDt. Token: [`0xd7e2Bc5F…198e6B`](https://sepolia.etherscan.io/token/0xd7e2Bc5F7D2690159c5d8E8B3A4648c8E1198e6B) (a test USDt we deployed for the demo, 6 decimals). No operator in the middle — the WDK key alone moved the money.

### 3. Pears — P2P pool sync

Each peer keeps the pool as a **signed, append-only Hypercore log on disk** (a Pears building block) — tamper-evident and it **survives a restart** (a restarted peer prints `resuming persistent Hypercore pool log — N entries` and won't re-settle). Peers discover each other over **Hyperswarm** (another Pears block, not WebRTC) on a shared topic — no server — and sync events into their logs. Each peer holds its own keys, records a **signed** stake, and the match result is agreed by **2-of-2 co-signing** — so no operator decides the outcome. The losing side then pays the winner directly in USDt from their own wallet (honor-based today; an escrow contract is on the roadmap). *(True multi-writer replication via Autobase, and running under `pear run` / pear-runtime, are the next Pears steps.)*

Run two peers (two terminals or two devices), same pool code:

```bash
npm run pool:p2p -- MATCH42 Alice AWAY --odds 5 --result AWAY --edge   # BACKS AWAY at 5×
npm run pool:p2p -- MATCH42 Bob   AWAY --odds 5 --lay --edge           # LAYS it
```

It's the same fixed-odds bet as `demo:pool`: one peer **backs** the outcome at Gaffer's odds, the other **lays** it, and the losing side pays the odds-driven amount (a winning back at 5× collects `stake × 5`). With `--edge`, each peer first runs its **own** on-device Gaffer (Qwen3-1.7B on CPU, so two peers share one GPU) and prints its read before staking — the AI edge lives inside every peer, not on a server.

They discover each other over the Hyperswarm DHT, exchange signed stakes, co-sign the result 2/2, and settle peer-to-peer:

```
📥 Bob lays AWAY @ 5× (10 USDt)  (0x5c80386B…)
✍️  Alice co-signed result = AWAY
📥 Bob co-signed result = AWAY
🏁 Result AWAY — co-signed 2/2.
   Bet: back AWAY @ 5× for 10 USDt → Alice wins 50 USDt (stake 10 + 40).
🏆 Alice wins 40 USDt from Bob at Gaffer's 5× — paid directly, keys never left the device.
```

---

## Architecture

```
On-device AI edge        Self-custody stakes         P2P sync
(QVAC / Qwen3-4B +   →   (WDK: your seed, your   →   (Pears / Hyperswarm:
 GTE-large, RAG over      key, USDt wallet-to-        peers gossip pool
 local corpus)            wallet, no house)           state, no server)
```

Everything runs on the player's device. The AI never phones home, the keys never leave the owner, and the network has no operator in the middle.

---

## Real use of tracks

| Track | Rule | How Gaffer Pool really uses it |
|-------|------|--------------------------------|
| **QVAC / Local-AI** | Genuine on-device inference | Qwen3-4B + GTE-large via `@qvac/sdk`, RAG over a local corpus, no cloud/API keys. `npm run demo:analyst`. |
| **WDK / Wallets** | Self-custodial, real transactions | Per-player seed→EVM wallets, each signs its own stake, settlement is a real USDt ERC-20 `transfer` (`0xa9059cbb…`). `npm run demo:pool`. |
| **Pears / P2P** | Real P2P building blocks | Pool state is a signed, append-only **Hypercore** log (persists across restarts) synced over **Hyperswarm** — no server. `npm run pool:p2p`. |

Combining all three is the Cup Champion angle: one football product, three tracks, no trusted middle.

---

## Setup & run

Requires **Node ≥ 22**. Windows/PowerShell friendly.

```bash
npm install
npm run demo:analyst     # QVAC: on-device cited analysis
npm run demo:pool        # WDK: self-custody stakes, AI fair-odds + USDt settlement
npm run pool:p2p -- <code> <name> <HOME|DRAW|AWAY> --odds <N> [--lay] [--result R]   # Pears: peer sync
npm run pool:wallet      # print wallets to fund + on-chain runbook
npm start                # on-device Gaffer chat web UI (https://localhost:8787)
```

Models auto-download once via the QVAC SDK, then cache (~2.5 GB for Qwen). Runs on a 6 GB GPU (the embedder is placed on CPU for VRAM headroom).

Useful env knobs:

- `MODEL=medgemma|medpsy` — swap the local LLM.
- `POOL_ONCHAIN=1` — broadcast settlement on Sepolia (needs funded wallets).
- `POOL_SEED_A` / `POOL_SEED_B` — stable demo wallets.
- `POOL_RESULT`, `POOL_USDT`, `POOL_RPC` — set the result, token, and RPC.

---

## Status / what's next

- **QVAC analyst** — working. `npm run demo:analyst` verified.
- **WDK stakes + settlement** — working. `npm run demo:pool` verified; a real **USDt** settlement was broadcast on Sepolia via WDK self-custody ([tx](https://sepolia.etherscan.io/tx/0xf11cdbeb3c722c29553f64e0b0d2ff1b468f3c3ddd450462af65ef572a2afdfc)).
- **Pears P2P sync** — working. `npm run pool:p2p` verified: the pool is a signed Hypercore log on disk (survives restarts), two peers discover over Hyperswarm, exchange signed stakes, co-sign the result 2/2, and settle peer-to-peer with no server.
- **Corpus** — `data/football/` is synthetic demo data (profiles, a match report, tactics), not live feeds.
- **Desktop/web UI** — `npm start` serves the on-device Gaffer chat (football corpus, cited answers) on the LAN; verified. Some deeper panels from the reused infrastructure are hidden pending a fuller reskin.

---

## License

Apache-2.0. Public repo, open source. See [`LICENSE`](LICENSE).
