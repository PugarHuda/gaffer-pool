# Gaffer Pool — Demo Video Script (≤ 3:00)

**Format:** unlisted YouTube, solo builder, screen recording of a terminal. Voiceover over the terminal — no face needed. All output lines below are copied from real verified runs; the numbers are what actually printed on a 6 GB GPU, so quote them honestly (time-to-first-token is a few seconds, not milliseconds — that's on-device reality, and it's fine).

**Prep before recording:**
- Run each command once first so models are cached (first run downloads; would blow the time budget).
- Terminals ready: **T1** analyst, **T2** pool, **T3 + T4** two P2P peers side by side, **Browser** open to the Sepolia Etherscan tx (below).
- Large font. For the P2P beat, arrange T3/T4 split-screen so both peers are visible.
- The real on-chain USDt settlement to show: `https://sepolia.etherscan.io/tx/0xf11cdbeb3c722c29553f64e0b0d2ff1b468f3c3ddd450462af65ef572a2afdfc` (a USDt ERC-20 transfer, WDK self-custody; after it, Alice holds 10 USDt on-chain)

---

## Beat sheet

| Time | On screen | Narration (voiceover) |
|------|-----------|-----------------------|
| **0:00–0:12** | Title card: **"Gaffer Pool — no house, no cloud, your keys."** Then a bare terminal. | "Friends predict football all the time. Today that means trusting a cloud app with your picks and a bookmaker with your money. Gaffer Pool needs neither — the AI, the money, and the network all run on your own device." |
| **0:12–0:55** | **T1:** `npm run demo:analyst`. Let one answer stream, ending on the stats line. Highlight the `[doc: …]` citations and the stats. | "First, your private analyst — Qwen3-4B and GTE-large, one hundred percent local through the QVAC SDK. It reads a local football corpus and answers grounded in it, citing the source doc for every claim. First token in about five seconds, then it streams — on-device, no network, no API key." |
| **0:55–1:05** | Freeze on the analyst answer + stats. | *(let it breathe — show the cited answer and `TTFT 4559 ms \| 228 tokens \| 24.1 tok/s`)* |
| **1:05–1:15** | **T2:** `npm run demo:pool`. Highlight the two addresses. | "Now the money. No bookmaker holds the pot. Each player has a self-custodial wallet — a seed phrase to an EVM account, via Tether's WDK." |
| **1:15–1:35** | Highlight the fair-odds line, then the two signed picks. | "Gaffer turns its read into fair, no-house odds — here it makes City fifty percent, so backing them pays two-x, the underdog five-x. Each player signs their own stake with their own key. Nobody signs for them." |
| **1:35–1:55** | Scroll to settlement. Highlight `data 0xa9059cbb…`. | "When the result's in, the loser pays the winner directly, wallet to wallet, in USDt — a real ERC-20 transfer, there's the calldata, `0xa9059cbb`. No house takes a cut." |
| **1:55–2:30** | **T3 + T4 split:** run both peers with `--edge`. Show each peer's own `Gaffer:` line, then `📥 … staked`, `✍️ co-signed`, `🏁 co-signed 2/2`, `🏆 … wins the pot`. | "And the pool syncs peer-to-peer — no server. Each device runs its *own* on-device Gaffer, then they find each other over Hyperswarm — the real Pears building block — swap signed stakes, and co-sign the result two-of-two. No operator decides the outcome. Then they settle, directly." |
| **2:30–2:50** | **Browser:** the Sepolia Etherscan tx page — **Status: Success**, a **USDt** token transfer to the winner. | "And this isn't a mock. Here's a real USDt settlement broadcast from a player's own WDK wallet, on-chain on Sepolia — confirmed, no operator in the middle." |
| **2:50–3:00** | Title card: **QVAC · WDK · Pears**. | "Your analyst on-device with QVAC, your stakes self-custodial with WDK, your pool peer-to-peer with Pears. Three Tether tracks, one football product — no house, no cloud, your keys." |

---

## Real output lines to make sure land on camera

**QVAC analyst** (`demo:analyst`) — cited, on-device:
```
To neutralise Rodri, deploy a forward or advanced 8 to cut the first line of
build-up [doc: player-rodri.txt] … Real Madrid's Bellingham is a key threat due
to his timing and runs beyond the striker [doc: player-bellingham.txt].
[search 358 ms | TTFT 4559 ms | 228 tokens | 24.1 tok/s]
```

**WDK fair odds + signed stakes** (`demo:pool`):
```
📊 Gaffer's fair odds (no house):  HOME 2×  DRAW 3.33×  AWAY 5×
   (from on-device probabilities HOME 50% / DRAW 30% / AWAY 20%)
  Alice: AWAY @ 5× (fair payout 50.0 USDt) — sig 0xff78aefe…
  Bob:   HOME @ 2× (fair payout 20.0 USDt) — sig 0x066d74fb…
```

**WDK settlement** — real ERC-20 `transfer` calldata:
```
🤝 Settlement — losers pay Alice directly (no house):
  Bob → Alice: 10 USDt
     to(token) 0x7169…  data 0xa9059cbb0000000000000000…
```

**Pears + per-peer QVAC** (`pool:p2p … --edge`, two peers):
```
🧠 asking Gaffer on this device (Qwen3-1.7B, CPU)…
   Gaffer: I lean towards a home win for Real Madrid …
🔗 announced on the pool topic — waiting for the other player…
📥 Bob staked 10 USDt on HOME  (0xcF2Bd59b…)
✍️  Alice co-signed result = AWAY
📥 Bob co-signed result = AWAY
🏁 Result AWAY (Manchester City win) — co-signed 2/2. Pot 20 USDt.
🏆 Alice wins the 20 USDt pot — paid directly by peers, keys never left the device.
```

**Real on-chain proof** (browser): Sepolia Etherscan, USDt settlement tx `0xf11cdb…`, **Status: Success** — a WDK self-custody USDt transfer that actually happened (Alice ends holding 10 USDt on-chain).

## Commands (paste-ready)
```bash
# T1
npm run demo:analyst
# T2
npm run demo:pool
# T3 (proposer)
npm run pool:p2p -- MATCH42 Alice AWAY --result AWAY --edge
# T4 (other player)
npm run pool:p2p -- MATCH42 Bob HOME --edge
```

## Closing line (verbatim)

> "Three Tether tracks, one football product — no house, no cloud, your keys."

---

*Spoken words ≈ 300 — comfortable under three minutes at a natural pace. If long, trim the middle of the streamed analyst answer; keep every track's beat and the Etherscan proof. Honesty note: don't claim millisecond latency — TTFT is ~5 s on a 6 GB GPU; the point is it runs on-device at all.*
