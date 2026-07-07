# Gaffer Pool — Demo Video Script (≤ 3:00)

**Format:** unlisted YouTube, solo builder, screen recording of a terminal. Two-to-three `npm` commands. Voiceover over the terminal — no face needed.

**Prep before recording:** run `npm run demo:analyst` once so models are cached (first run downloads ~2.5 GB and would blow the time budget). Have three terminal tabs ready: analyst, pool, and (if wired) `pool:p2p`. Keep font large.

---

## Beat sheet

| Time | On screen | Narration (voiceover) |
|------|-----------|-----------------------|
| **0:00–0:15** | Title card: **"Gaffer Pool — no house, no cloud, your keys."** Then a bare terminal. | "Friends bet on football all the time. But today that means trusting a cloud app with your picks, and a bookmaker with your money. Gaffer Pool needs neither — the AI, the money, and the network all run on your own device." |
| **0:15–0:20** | Type `npm run demo:analyst`, hit enter. | "First, your private analyst. This is Qwen3-4B and GTE-large embeddings running one hundred percent locally through the QVAC SDK." |
| **0:20–1:05** | Ingest lines scroll (`Ingesting player-bellingham.txt... ok`), then an answer streams token by token, ending with the stats line `[search … ms | TTFT … ms | … tokens | … tok/s]`. Let one full answer stream. | "It reads a local football corpus — club and player profiles, a match report, tactics — and answers scouting questions grounded in those docs. Watch it stream on-device: time-to-first-token in milliseconds, tokens counted, no network call, no API key. This is your edge, and it never leaves the machine." |
| **1:05–1:15** | New tab. Type `npm run demo:pool`, enter. | "Now the money. No bookmaker holds the pot. Each player has their own self-custodial wallet — a seed phrase to an EVM account, via Tether's WDK." |
| **1:15–1:40** | Highlight the two addresses: `Alice  0x…` / `Bob  0x…`, then the signed commitments `Alice: HOME — sig 0x…`. | "Two players, two addresses, two sets of keys — held by their owners, not by any server. Each one signs their own stake commitment with their own key. Nobody signs on their behalf." |
| **1:40–2:10** | Scroll to the settlement block. Highlight the ERC-20 calldata: `to(token) 0x…  data 0xa9059cbb…` and the closing line "Keys stayed with their owners; nothing left the devices." | "When the result's in, the losers pay the winner directly, wallet to wallet, in USDt. That's a real ERC-20 transfer — there's the calldata, `0xa9059cbb`. No house takes a cut. Flip on the on-chain flag with funded testnet wallets and it broadcasts to Sepolia for real; by default it prints the signed intent so it runs anywhere, no faucet." |
| **2:10–2:35** | Third tab: `npm run pool:p2p`. Show a peer node starting and a "peer connected" / Hyperswarm topic line. *(If not yet wired, hold on the pool tab and say the line as roadmap.)* | "And the pool itself syncs peer-to-peer — no server in the middle. Devices join a shared Hyperswarm topic and gossip the pool state directly to each other. That's the real Pears building block, coming online now." |
| **2:35–3:00** | Back to title card, three logos/words: **QVAC · WDK · Pears**. | "So that's Gaffer Pool: your analyst runs on-device with QVAC, your stakes are self-custodial with WDK, and your pool syncs peer-to-peer with Pears. Three Tether tracks, one football product — no house, no cloud, your keys. Thanks for watching." |

---

## Key output lines to make sure land on camera

- **QVAC:** `[search 41 ms | TTFT 380 ms | 512 tokens | 24.3 tok/s]` — the on-device proof.
- **WDK addresses:** `Alice  0x…` / `Bob  0x…` — two owners, two keys.
- **WDK signatures:** `Alice: HOME — sig 0x…` — each signs their own stake.
- **WDK settlement:** `data 0xa9059cbb…` — real ERC-20 `transfer` calldata.
- **Pears:** peer-connected line on a shared Hyperswarm topic.

## Closing line (verbatim)

> "Three Tether tracks, one football product — no house, no cloud, your keys."

---

*Total spoken words ≈ 290 — comfortably under three minutes at a natural pace. If running long, trim the middle of the streamed analyst answer rather than any track's beat; each track needs its moment on screen.*
