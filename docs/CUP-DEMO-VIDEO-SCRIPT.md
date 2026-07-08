# Gaffer Pool — Demo Video Script (≤ 3:00)

**Format:** unlisted YouTube, solo builder, screen recording of a terminal. Voiceover over the terminal — no face needed. All output lines below are copied from real verified runs; the numbers are what actually printed on a 6 GB GPU, so quote them honestly (time-to-first-token is a few seconds, not milliseconds — that's on-device reality, and it's fine).

**Prep before recording:**
- Run each command once first so models are cached (first run downloads; would blow the time budget).
- Windows ready: **T1** analyst terminal, **T3 + T4** two P2P peer terminals side by side, **Browser tab A** the web app (`npm start` → https://localhost:8787, accept the cert once), **Browser tab B** the Etherscan tx (below).
- Large font. For the P2P beat, arrange T3/T4 split-screen so both peers are visible.
- The real on-chain USDt settlement to show — the **odds-driven back/lay one**: `https://sepolia.etherscan.io/tx/0x32872699055513e9eed579cfb667bae1634129ae9261bab174984f1387ad96b4` (a 5× back settled for **40 USDt** via WDK self-custody; balances moved Alice +40 / Bob −40)

---

## Beat sheet

| Time | On screen | Narration (voiceover) |
|------|-----------|-----------------------|
| **0:00–0:12** | Title card: **"Gaffer Pool — no house, no cloud, your keys."** Then a bare terminal. | "Friends predict football all the time. Today that means trusting a cloud app with your picks and a bookmaker with your money. Gaffer Pool needs neither — the AI, the money, and the network all run on your own device." |
| **0:12–0:55** | **T1:** `npm run demo:analyst`. Let one answer stream, ending on the stats line. Highlight the `[doc: …]` citations and the stats. | "First, your private analyst — Qwen3-4B and GTE-large, one hundred percent local through the QVAC SDK. It reads a local football corpus and answers grounded in it, citing the source doc for every claim. First token in about five seconds, then it streams — on-device, no network, no API key." |
| **0:55–1:05** | Freeze on the analyst answer + stats. | *(let it breathe — show the cited answer and `TTFT 4559 ms \| 228 tokens \| 24.1 tok/s`)* |
| **1:05–1:25** | **Browser tab A:** the web app. Flick through **💬 Chat** (a cited answer already on screen) and **📊 Table** (standings, form pills, top scorers). | "It's a real app, not just a terminal — chat with the analyst, and a standings dashboard parsed from the same local corpus. All of it served from your own machine." |
| **1:25–1:50** | Click **💰 Bet**. Let the odds tiles appear (~5 s, on-device), pick AWAY · Back · 10, hit **PLACE BET & SETTLE**; show the result card: signed commitments + the 40 USDt settlement + `0xa9059cbb…` calldata. | "Now the money. Gaffer prices the match on-device — City the favourite, the away side five-x — and that price *is* the bet: back it for ten and a win pays fifty. Both sides sign with their own self-custodial WDK wallet, and the settlement is a real ERC-20 USDt transfer — there's the calldata. No bookmaker anywhere." |
| **1:50–2:25** | **T3 + T4 split:** run both peers with `--edge`. Show each peer's own `Gaffer:` line, then `📥 … lays`, `✍️ co-signed`, `🏁 co-signed 2/2`, `🏆 … wins 40 USDt`. | "And the pool syncs peer-to-peer — no server. Each device runs its *own* on-device Gaffer, then they find each other over Hyperswarm — the real Pears building block — swap signed stakes, and co-sign the result two-of-two. No operator decides the outcome. Then they settle, directly." |
| **2:25–2:50** | **Browser tab B:** the Sepolia Etherscan tx — **Status: Success**, a **40 USDt** token transfer to the winner. | "And this isn't a mock. Here's that odds-driven settlement broadcast for real from a player's own WDK wallet — forty USDt on a five-x back, confirmed on Sepolia, no operator in the middle." |
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

**WDK fair odds + a back/lay bet** (`demo:pool`):
```
📊 Gaffer's fair odds (no house):  HOME 2×  DRAW 3.33×  AWAY 5×
   (from on-device probabilities HOME 50% / DRAW 30% / AWAY 20%)

💸 A fixed-odds bet on AWAY (Manchester City win) at Gaffer's 5× — each side signs:
  Alice backs AWAY @ 5× — stakes 10 USDt to win 50 USDt  · sig 0x40140bfc…
  Bob   lays  AWAY @ 5× — escrows 40 USDt against it       · sig 0xc195c625…
```

**WDK settlement** — the odds set the amount; real ERC-20 `transfer` calldata:
```
🏁 Result: AWAY. Alice wins the bet — collects 50 USDt (stake 10 + 40 at 5×).
🤝 Bob → Alice: 40 USDt — signed ERC-20 transfer:
     to(token) 0xd7e2…  data 0xa9059cbb0000000000000000…
```

**Pears + per-peer QVAC** (`pool:p2p … --edge`, two peers):
```
🧠 asking Gaffer on this device (Qwen3-1.7B, CPU)…
   Gaffer: I lean towards a home win for Real Madrid …
🔗 announced on the pool topic — waiting for the other player…
♻️  resuming persistent Hypercore pool log — 1 entries on disk
📥 Bob lays AWAY @ 5× (10 USDt)  (0x5c80386B…)
✍️  Alice co-signed result = AWAY
📥 Bob co-signed result = AWAY
🏁 Result AWAY (Manchester City win) — co-signed 2/2.
🏆 Alice wins 40 USDt from Bob at Gaffer's 5× — paid directly, keys never left the device.
```

> The demo backs **AWAY at 5×** — the AI's *underdog*, so a win pays big. You can back the AI's favourite for safer odds, or take the underdog for a bigger payout — the odds are the AI's honest price either way.

**Real on-chain proof** (browser tab B): Sepolia Etherscan, USDt settlement tx `0x328726…`, **Status: Success** — the odds-driven **40 USDt** back/lay settlement, broadcast by the loser's own WDK wallet (balances moved Alice +40 / Bob −40).

## Commands (paste-ready)
```bash
# T1
npm run demo:analyst
# Browser tab A (chat / table / bet views)
npm start          # then open https://localhost:8787 (accept the cert once)
# T3 (backs AWAY at 5×)
npm run pool:p2p -- MATCH42 Alice AWAY --odds 5 --result AWAY --edge
# T4 (lays it)
npm run pool:p2p -- MATCH42 Bob AWAY --odds 5 --lay --edge
```

## Closing line (verbatim)

> "Three Tether tracks, one football product — no house, no cloud, your keys."

---

*Spoken words ≈ 300 — comfortable under three minutes at a natural pace. If long, trim the middle of the streamed analyst answer; keep every track's beat and the Etherscan proof. Honesty note: don't claim millisecond latency — TTFT is ~5 s on a 6 GB GPU; the point is it runs on-device at all.*
