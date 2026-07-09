# Gaffer Pool ⚽

**No house, no cloud, your keys — a football prediction game where the AI analyst, the money, and the network all run on your own device.**

> **Entering track:** **WDK (Wallets)** — for the 1,000 USD₮ track prize. Gaffer Pool genuinely uses **all three** tracks (QVAC + WDK + Pears), so it also competes for the 5,000 USD₮ **Cup Champion** (best across all tracks). WDK is our headline: the money layer is fully self-custodial and we broadcast a **real, verifiable USD₮ settlement on-chain** (Sepolia) — see "What's verifiable".
> **Nation:** Indonesia 🇮🇩 · **Repo:** https://github.com/PugarHuda/gaffer-pool · **Video:** _unlisted YouTube (add link on submit)_
> **Announcement (X):** https://x.com/BangDropID/status/2074995505982267850

## Elevator pitch

Friends predict football all the time — and today that means trusting a cloud app with your picks, a bookmaker with your pot, and a server with your data. Gaffer Pool needs none of them. It's a friendly group-tipping game where a private on-device AI analyst gives you the edge, self-custodial USDt stakes settle wallet-to-wallet among friends, and the pool syncs peer-to-peer with no operator in the middle. One football-native product that combines all **three** Tether tracks — QVAC, WDK, and Pears.

## Why football + the full Tether stack

Football is the perfect shape for the whole Tether stack, because the three things you want when friends predict a match map one-to-one onto three tracks — three parties you'd normally have to trust, replaced by three things you own:

- You want an **edge** — who's in form, who's injured, how the tactics match up → a private analyst that runs on your device. **QVAC.**
- You want to **stake** with mates without a bookmaker holding the pot → self-custodial wallets that settle wallet-to-wallet. **WDK.**
- You want the group's pool to **stay in sync** without a server → peers gossip state directly. **Pears.**

The AI is each player's private advisor, the money layer is self-custodial, the network layer has no operator. All three tracks, one product — that's the pitch.

## What we built, per track

### QVAC — the on-device analyst ("Gaffer")
`npm run demo:analyst` — Runs **Qwen3-4B** + **GTE-large** embeddings **100% locally** via `@qvac/sdk` (no cloud, no API keys). It does RAG over a local football corpus in `data/football/` and answers scouting questions grounded in — and **citing** — the source docs. A judge sees it ingest the corpus, then stream cited answers with per-answer stats, e.g. `[search 358 ms | TTFT 4559 ms | 228 tokens | 24.1 tok/s]` on a 6 GB GPU. There's also a web chat (`npm start`) and a standings dashboard (`/api/teams`). And every P2P peer can run its **own** on-device Gaffer (Qwen3-1.7B on CPU) via `--edge`.

### WDK — self-custodial stakes, no bookmaker
`npm run demo:pool` — Each player holds their own keys: a self-custodial WDK wallet (`@tetherto/wdk` → seed phrase → EVM account). Each player **signs their own stake** with their own key, and the pot settles **wallet-to-wallet in USDt** — a real ERC-20 `transfer`. A judge sees the two self-custody addresses, each signed pick, the result, and the settlement calldata (`0xa9059cbb…`). The twist: Gaffer turns its edge into **money** — its on-device probabilities set **fair, no-house odds** (a fixed-odds back/lay bet where the layer escrows liability = stake×(odds−1); e.g. `AWAY @ 5×` → the losing layer pays 40 USDt). The AI's read is the odds — back its favourite for safer odds, or take the underdog for a bigger payout; the price is the AI's honest number either way.

### Pears — P2P pool sync, no server
`npm run pool:p2p -- MATCH42 Alice AWAY --odds 5 --result AWAY --edge` (backs) + `npm run pool:p2p -- MATCH42 Bob AWAY --odds 5 --lay --edge` (lays) — The pool is a signed, append-only **Hypercore** log on disk — tamper-evident and it **survives restarts** (a resumed peer prints `resuming persistent Hypercore pool log — N entries`). It syncs between peers over **Hyperswarm** (a real Pears building block, not WebRTC): peers join a shared topic, no server. Each records a **signed** stake, and the match result is agreed by **2-of-2 co-signing** — no operator decides the outcome. A judge sees two peers discover each other over the DHT, exchange signed stakes, co-sign the result 2/2, and settle peer-to-peer.

## What's verifiable right now

- **Real on-chain USDt settlement (Sepolia):** the losing WDK wallet signs and broadcasts a USDt ERC-20 transfer to the winner — **the AI's odds set the amount**. A 5× back/lay settled for **40 USDt**: [tx `0x328726…`](https://sepolia.etherscan.io/tx/0x32872699055513e9eed579cfb667bae1634129ae9261bab174984f1387ad96b4), **Status: Success** (balances moved Alice +40 / Bob −40). No operator in the middle — the WDK key alone moved the money.
- **Trustless escrow (`contracts/PoolEscrow.sol`):** for stakes between strangers, both players lock their side into an on-chain escrow and the pot releases only on a **2-of-2 co-signed result** — the contract, not honour, holds the money. A `deadline` + `refund()` safety valve means no deposit can be locked forever if the two never agree. Settlement math self-checked (`npm run demo:escrow`); deploys + runs a full fund → co-sign → release cycle on Sepolia with `ESCROW_ONCHAIN=1`.
- **Persistent P2P pool:** restart a peer and it prints `resuming persistent Hypercore pool log — N entries` — the state lived on disk, not a server.
- **Cited on-device answers:** `demo:analyst` streams answers with `[doc: …]` citations and live TTFT/tokens/tok-s stats, all local.

## How to run it

Requires **Node ≥ 22** (Windows/PowerShell friendly). Public repo: [github.com/PugarHuda/gaffer-pool](https://github.com/PugarHuda/gaffer-pool) (Apache-2.0).

```bash
npm install
npm run demo:analyst   # QVAC: on-device cited analysis
npm run demo:pool      # WDK: self-custody stakes, AI fair-odds + USDt settlement
npm run demo:escrow    # WDK: trustless 2-of-2 on-chain escrow (self-check; ESCROW_ONCHAIN=1 to deploy)
npm run pool:p2p -- <code> <name> <OUTCOME> --odds <N> [--lay] [--result R] [--edge]   # Pears: peer sync
npm run pool:wallet    # print wallets to fund + on-chain runbook
npm start              # on-device Gaffer chat web UI
```

Models auto-download once via the QVAC SDK, then cache (~2.5 GB for Qwen). Runs on a 6 GB GPU (embedder placed on CPU for headroom).

## Honest limitations / what's next

- The football corpus in `data/football/` is **synthetic demo data** (profiles, a match report, tactics), not live feeds.
- The on-chain proof uses a **test USDt we deployed ourselves** (6 decimals) — Tether doesn't issue test-USDt on Sepolia, so we're honest about that; the mechanism is **identical** to real USDt.
- The P2P demo runs **two peers on one machine** over the real Hyperswarm DHT — the network is real, the two devices are simulated side by side.
- The **per-peer edge** uses a smaller **Qwen3-1.7B on CPU** so two peers can share one GPU; the standalone analyst uses the full Qwen3-4B.
- P2P settlement defaults to **honor-based** (each side's stake is *signed*, not escrowed). For stakes between strangers, the on-chain **escrow contract (`contracts/PoolEscrow.sol`) now locks both sides and auto-releases the pot on a 2-of-2 co-signed result** (`npm run demo:escrow`; `ESCROW_ONCHAIN=1` to deploy on Sepolia). Still clearly next: true multi-writer replication via **Autobase**, and running under `pear run` / **pear-runtime**.

## Reused work (disclosure)

Per the Cup rules, here's what predates the event: the **on-device QVAC plumbing** (the `@qvac/sdk` engine wrapper, model loading, the RAG ingest/search pipeline, the audit logger, and the Electron/web server shell) is **reused from our own earlier project** — a health assistant. Everything that makes this **Gaffer Pool** was **built during the event**: the football corpus and analyst persona, the standings dashboard and `/api/teams`, the entire **WDK** money layer (wallets, fixed-odds back/lay, USDt settlement, the on-chain deploy/mint/settle), the **Pears** pool (Hypercore log + Hyperswarm sync + 2-of-2 co-signing), the per-peer edge, and all the removal of the old health surface. Judge the event-window commits.

## Dependencies & third-party parts

- **AI (on-device):** `@qvac/sdk`; models Qwen3-4B, Qwen3-1.7B, GTE-large (and Whisper/Supertonic/OCR for the optional voice path) — all run locally, no cloud AI.
- **Wallet:** `@tetherto/wdk`, `@tetherto/wdk-wallet-evm`.
- **P2P:** `hyperswarm`, `hypercore`, `corestore`, `hypercore-crypto`, `b4a`.
- **Chain (testnet only):** a public Sepolia RPC (`ethereum-sepolia-rpc.publicnode.com`) for broadcasting; a **test USDt ERC-20 we deployed ourselves**. `viem` + `solc` are **dev-only** (not shipped deps): used to deploy/mint the test token, and imported at runtime by `demo:escrow` under `ESCROW_ONCHAIN=1` to compile and deploy the escrow contract.
- **Misc:** `qrcode`, Electron/electron-forge (desktop shell). Language: Node ≥22, plain browser JS (no build step).

## Real use of tracks

- **QVAC / Local-AI** — genuine on-device inference: Qwen3-4B + GTE-large via `@qvac/sdk`, RAG over a local corpus, cited answers, zero cloud/API keys.
- **WDK / Wallets** — self-custodial, real transactions: per-player seed→EVM wallets, each signs its own stake, settlement is a real USDt ERC-20 `transfer` — verified on-chain on Sepolia.
- **Pears / P2P** — real building blocks: pool state is a signed, persistent **Hypercore** log synced over **Hyperswarm**, 2-of-2 co-signed results, no server.

Combining all three in one football product — no trusted middle anywhere — is the Cup Champion angle. **No house, no cloud, your keys.**
