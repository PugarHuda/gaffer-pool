// Deterministic, rule-based extraction of team & player analytics from the
// football corpus (data/football/*.txt). No LLM — numbers/form are exact, never
// hallucinated. Powers the /api/teams standings dashboard; the chat RAG path is
// separate and untouched.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const NUM = (re, s) => { const m = re.exec(s); return m ? Number(m[1]) : null; };
const STR = (re, s) => { const m = re.exec(s); return m ? m[1].trim() : null; };

// A wrapped multi-line field: label → text up to the next blank line, whitespace collapsed.
function block(label, s) {
  const m = new RegExp(label + "\\s*([\\s\\S]*?)(?:\\n\\s*\\n|$)", "i").exec(s);
  return m ? m[1].replace(/\s+/g, " ").trim() : null;
}

// The lines belonging to one club's `Name:` heading (until the next whole-line heading).
function clubSection(text, club) {
  const isHead = (raw) => /^[A-Z][^:\n]*:\s*$/.test(raw.trim());
  let inSec = false;
  const out = [];
  for (const raw of text.split(/\r?\n/)) {
    if (isHead(raw)) { inSec = raw.trim().toLowerCase() === club.toLowerCase() + ":"; continue; }
    if (inSec) out.push(raw);
  }
  return out.join("\n");
}

// "- foo\n  wrapped" bullets; a blank line closes a bullet (so trailing prose isn't glued on).
function bullets(sectionText) {
  const out = [];
  let open = false;
  for (const raw of sectionText.split(/\r?\n/)) {
    const t = raw.trim();
    if (!t) { open = false; continue; }
    if (/^-\s+/.test(t)) { out.push(t.replace(/^-\s+/, "")); open = true; }
    else if (open) out[out.length - 1] += " " + t;
  }
  return out;
}

export function loadTeams(dir = "data/football") {
  if (!existsSync(dir)) return [];
  const read = (name) => existsSync(join(dir, name)) ? readFileSync(join(dir, name), "utf8") : "";
  const injuryText = read("form-injury-update-2026-06.txt");
  const setPieceText = read("set-pieces-analysis.txt");

  const teams = [];
  for (const f of readdirSync(dir).filter((x) => x.startsWith("club-") && x.endsWith(".txt"))) {
    const s = readFileSync(join(dir, f), "utf8");
    const name = STR(/^Club:\s*(.+)$/mi, s);
    if (!name) continue;

    const formStr = STR(/Recent form[^:]*:\s*([WDL\s]+)/i, s);
    const form = formStr ? formStr.trim().split(/\s+/).filter((x) => /^[WDL]$/.test(x)) : [];
    const wins = form.filter((x) => x === "W").length;
    const draws = form.filter((x) => x === "D").length;
    const losses = form.filter((x) => x === "L").length;
    const gf = NUM(/Goals scored last 5:\s*(\d+)/i, s);
    const ga = NUM(/Goals conceded last 5:\s*(\d+)/i, s);
    const sp = clubSection(setPieceText, name);

    teams.push({
      name,
      form,
      played: form.length,
      wins, draws, losses,
      points: wins * 3 + draws,
      gf, ga,
      gd: gf != null && ga != null ? gf - ga : null,
      xg: NUM(/xG last 5:\s*([\d.]+)/i, s),
      style: block("Style of play:", s),
      keyPlayers: block("Key players:", s),
      injuries: bullets(clubSection(injuryText, name)).filter((b) => /^injury concern/i.test(b)),
      setPieces: {
        scored: NUM(/Set-piece goals this season:\s*(\d+)\s*scored/i, sp),
        conceded: NUM(/Set-piece goals this season:\s*\d+\s*scored,\s*(\d+)\s*conceded/i, sp),
      },
    });
  }
  // League-table order: points, then goal difference.
  teams.sort((a, b) => b.points - a.points || (b.gd ?? 0) - (a.gd ?? 0));
  return teams;
}

export function loadPlayers(dir = "data/football") {
  if (!existsSync(dir)) return [];
  const players = readdirSync(dir)
    .filter((x) => x.startsWith("player-") && x.endsWith(".txt"))
    .map((f) => {
      const s = readFileSync(join(dir, f), "utf8");
      return {
        name: STR(/^Player:\s*(.+)$/mi, s),
        club: STR(/^Club:\s*(.+)$/mi, s),
        position: STR(/^Position:\s*(.+)$/mi, s),
        goals: NUM(/^Goals:\s*(\d+)/mi, s),
        assists: NUM(/^Assists:\s*(\d+)/mi, s),
        xg: NUM(/^xG:\s*([\d.]+)/mi, s),
        xa: NUM(/^xA:\s*([\d.]+)/mi, s),
      };
    })
    .filter((p) => p.name);
  players.sort((a, b) => (b.goals ?? 0) - (a.goals ?? 0));
  return players;
}

// ponytail: rule-based-parse self-check — runs only on `node src/football-data.js`,
// not on import (so the /api/teams path and the verify import stay quiet).
if (process.argv[1] && process.argv[1].replace(/\\/g, "/").endsWith("football-data.js")) {
  const t = loadTeams();
  const p = loadPlayers();
  console.assert(t.length >= 2, "expected >=2 teams");
  console.assert(t.every((x) => x.played === x.wins + x.draws + x.losses), "W/D/L must sum to played");
  console.assert(t.every((x) => x.points === x.wins * 3 + x.draws), "points = 3W+D");
  console.assert(t.some((x) => x.xg > 0 && x.injuries.length), "xG + injuries parsed");
  console.assert(p.length && (p[0].goals ?? 0) >= (p[p.length - 1].goals ?? 0), "players sorted by goals desc");
  console.log(JSON.stringify({ teams: t, players: p }, null, 2));
}
