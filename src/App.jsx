import { useState, useEffect, useRef } from "react";

const C = {
  bg: "#0b0d13", card: "#13161f", accent: "#7c6aef", accentL: "#a99ff5",
  success: "#2ed8a3", warn: "#f5c542", danger: "#ef6461", text: "#e2e6ea",
  dim: "#5a6270", border: "#252a35", breathing: "#00d2c6", reading: "#3b82f6",
  language: "#8b5cf6", math: "#ef6461", flashcard: "#f5c542", brain: "#ec4899",
  news: "#2ed8a3", custom: "#5a6270"
};

const ACTIVITIES = [
  { id: "breathing", name: "Breathing / Mindfulness", icon: "🧘", color: C.breathing, weight: 10 },
  { id: "reading", name: "Reading / Learning", icon: "📖", color: C.reading, weight: 14 },
  { id: "language", name: "Language Practice", icon: "🌍", color: C.language, weight: 12 },
  { id: "math", name: "Math / Logic Puzzles", icon: "🧩", color: C.math, weight: 13 },
  { id: "flashcard", name: "Flashcard Review", icon: "🃏", color: C.flashcard, weight: 11 },
  { id: "brain", name: "Brain Training Games", icon: "🧠", color: C.brain, weight: 14 },
  { id: "news", name: "News / Knowledge Burst", icon: "📰", color: C.news, weight: 10 },
];

function todayStr() { return new Date().toISOString().slice(0, 10); }

function fmtTime(s) {
  return `${Math.floor(s / 60).toString().padStart(2, "0")}:${(s % 60).toString().padStart(2, "0")}`;
}

function sty(color, full) {
  return {
    padding: "10px 24px", background: full ? color : (color + "20"),
    color: full ? "#fff" : color, border: `1px solid ${color}55`,
    borderRadius: 10, cursor: "pointer", fontSize: 14, fontWeight: 600
  };
}

/* ═══════════════════════════════════════
   API — proxied through Cloudflare Worker
   ═══════════════════════════════════════ */

/* ═══════════════════════════════════════
   CONTENT HISTORY — no repeats for 1 year
   ═══════════════════════════════════════ */

async function loadHistory() {
  try {
    const raw = localStorage.getItem("steadydose_history");
    if (raw) return JSON.parse(raw);
  } catch (e) { /* ignore */ }
  return {};
}

async function saveHistory(history) {
  try {
    localStorage.setItem("steadydose_history", JSON.stringify(history));
  } catch (e) { /* ignore */ }
}

function pruneHistory(history) {
  const cutoff = Date.now() - 365 * 24 * 60 * 60 * 1000;
  const pruned = {};
  for (const key in history) {
    pruned[key] = (history[key] || []).filter(e => e.ts > cutoff);
    if (pruned[key].length === 0) delete pruned[key];
  }
  return pruned;
}

function getUsedKeys(history, actId) {
  return (history[actId] || []).map(e => e.key);
}

function addToHistory(history, actId, keys) {
  if (!history[actId]) history[actId] = [];
  const ts = Date.now();
  keys.forEach(k => history[actId].push({ key: k, ts }));
  return history;
}

function extractKeys(actId, data) {
  if (!data) return [];
  if (actId === "breathing") return [data.name || ""];
  if (actId === "reading") return [data.title || ""];
  if (actId === "language") {
    const lang = data.lang || "";
    const words = (data.words || []).map(w => w.w || "");
    return [lang + ": " + words.join(", ")];
  }
  if (actId === "math") return (data.puzzles || []).map(p => p.q || "");
  if (actId === "flashcard") return [data.topic || ""];
  if (actId === "news") return [data.topic || ""];
  return [];
}

function buildExclusion(used) {
  if (!used.length) return "";
  const list = used.slice(-50).join("\n- ");
  return `\nDo NOT repeat any of these:\n- ${list}`;
}

/* ═══════════════════════════════════════
   PROMPTS
   ═══════════════════════════════════════ */

const PROMPTS = {
  breathing: (used) =>
    `Breathing exercise with creative name. JSON: {"name":"str","inhale":2-8,"hold1":0-8,"exhale":2-10,"hold2":0-4,"desc":"1-sentence","tip":"mindfulness tip"}. Not box/478.` + buildExclusion(used),

  reading: (used) =>
    `Educational article (250-300 words) on a surprising topic from science/psychology/history/tech. JSON: {"title":"str","text":"str 250-300 words","questions":[{"q":"str","a":"str"}],"keyTerms":[{"term":"str","definition":"str"}],"furtherThinking":"str"}. 4 questions, 3 key terms.` + buildExclusion(used),

  language: (lang, used) =>
    `10 vocabulary words in ${lang || "a random language (Spanish/Japanese/French/German/Italian/Korean/Mandarin/Arabic/Hindi)"}. JSON: {"lang":"str","words":[{"w":"native script","pronunciation":"romanized if non-Latin","m":"meaning","ex":"example sentence","exEn":"English translation","difficulty":"beginner|intermediate|advanced","usage":"when to use"}]}. 10 words.` + buildExclusion(used),

  math: (used) =>
    `6 math/logic puzzles (lateral thinking, probability, sequences, geometry, combinatorics). JSON: {"puzzles":[{"q":"str","a":"answer with explanation","hint":"str","category":"type","difficulty":"medium|hard"}]}. 6 puzzles, original.` + buildExclusion(used),

  flashcard: (used) =>
    `12 flashcards on a PRACTICAL topic (first aid/negotiation/logical fallacies/cooking science/personal finance/body language/mental models/digital security/legal rights/memory techniques/nutrition/sleep science). JSON: {"topic":"str","why":"str","cards":[{"f":"front","b":"back 2-3 sentences","example":"real-world use"}]}. 12 cards. Different topic from before.` + buildExclusion(used),

  news: (used) =>
    `Knowledge burst on a fascinating topic. JSON: {"topic":"str","intro":"1-sentence hook","facts":[{"fact":"str","source":"field"}],"connections":[{"from":0,"to":1,"link":"str"}],"insight":"str","actionable":"str"}. 8 facts, 2-3 connections. Different topic.` + buildExclusion(used)
};

function buildBatchPrompt(activityIds, langPref, history) {
  const parts = [];
  activityIds.forEach(id => {
    const used = getUsedKeys(history, id);
    let prompt;
    if (id === "language") prompt = PROMPTS.language(langPref, used);
    else prompt = PROMPTS[id](used);
    parts.push(`### ${id}\n${prompt}`);
  });
  return `Generate content for these activities. Return a single JSON object with activity IDs as keys. Each value must match the schema described.\n\n${parts.join("\n\n")}`;
}

async function fetchAllContent(activityIds, langPref, history) {
  const prompt = buildBatchPrompt(activityIds, langPref, history);
  const r = await fetch("/api/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 4000,
      system: "You are a content generator. Respond ONLY with valid JSON. No markdown, no backticks, no preamble. Return one JSON object with activity IDs as keys.",
      messages: [{ role: "user", content: prompt }]
    })
  });
  if (!r.ok) {
    const errText = await r.text();
    throw new Error(`API ${r.status}: ${errText.slice(0, 200)}`);
  }
  const d = await r.json();
  if (d.error) throw new Error(d.error.message || JSON.stringify(d.error));
  const txt = (d.content || []).map(b => b.text || "").join("");
  if (!txt) throw new Error("Empty response");
  return JSON.parse(txt.replace(/```json|```/g, "").trim());
}

/* ═══════════════════════════════════════
   BRAIN GAMES
   ═══════════════════════════════════════ */

const WORDS_LIST = [
  "algorithm", "synapse", "paradigm", "catalyst", "molecule", "gradient",
  "spectrum", "protocol", "metaphor", "variable", "sequence", "abstract",
  "function", "dynamics", "topology", "rhetoric", "momentum", "entropy",
  "fractal", "lattice", "paradox", "theorem", "quantum", "polygon",
  "synthesis", "cognition", "heuristic", "dexterity", "labyrinth", "resonance",
  "symbiosis", "ephemeral", "archipelago", "serendipity", "ubiquitous"
];

function scrambleWord(w) {
  let a = w.split("");
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.join("") === w ? a.reverse().join("") : a.join("");
}

function SequenceGame({ onScore }) {
  const [seq, setSeq] = useState([]);
  const [input, setInput] = useState("");
  const [phase, setPhase] = useState("show");
  const [level, setLevel] = useState(3);
  const [score, setScore] = useState(0);
  const [best, setBest] = useState(0);

  useEffect(() => { newRound(level); }, []);

  const newRound = (len) => {
    const s = Array.from({ length: len }, () => Math.floor(Math.random() * 10));
    setSeq(s); setPhase("show"); setInput("");
    setTimeout(() => setPhase("input"), len * 600 + 500);
  };

  const check = () => {
    if (input === seq.join("")) {
      const ns = score + 1;
      setScore(ns);
      if (ns > best) setBest(ns);
      if (onScore) onScore("level reached", ns + 1, ns + 1);
      setLevel(level + 1);
      newRound(level + 1);
    } else {
      if (onScore) onScore("level reached", score, score);
      setPhase("result");
    }
  };

  return (
    <div style={{ textAlign: "center" }}>
      <h3 style={{ color: C.accentL }}>Number Memory — Level {level - 2}</h3>
      <p style={{ color: C.dim, fontSize: 13 }}>Best: {best}</p>
      {phase === "show" && (
        <div style={{ fontSize: 44, fontWeight: 700, color: C.text, letterSpacing: 10, marginTop: 40 }}>
          {seq.join("")}
        </div>
      )}
      {phase === "input" && (
        <div style={{ marginTop: 32 }}>
          <p style={{ color: C.dim }}>Type the sequence:</p>
          <input value={input} onChange={e => setInput(e.target.value.replace(/\D/g, ""))}
            autoFocus onKeyDown={e => e.key === "Enter" && check()}
            style={{ padding: "12px 20px", fontSize: 26, letterSpacing: 8, textAlign: "center", borderRadius: 10, border: `1px solid ${C.border}`, background: C.card, color: C.text, width: 220, outline: "none" }} />
          <br />
          <button onClick={check} style={{ ...sty(C.accent), marginTop: 14 }}>Submit</button>
        </div>
      )}
      {phase === "result" && (
        <div style={{ marginTop: 32 }}>
          <p style={{ color: C.danger, fontSize: 18 }}>It was <b>{seq.join("")}</b></p>
          <p style={{ color: C.text, fontSize: 22 }}>Score: {score}</p>
          <button onClick={() => { setLevel(3); setScore(0); newRound(3); }} style={sty(C.accent)}>Retry</button>
        </div>
      )}
      {phase !== "result" && <p style={{ color: C.dim, marginTop: 16 }}>Score: {score}</p>}
    </div>
  );
}

function ReactionGame({ onScore }) {
  const [state, setState] = useState("waiting");
  const [st, setSt] = useState(0);
  const [times, setTimes] = useState([]);
  const tr = useRef();

  const start = () => {
    setState("ready");
    tr.current = setTimeout(() => { setState("go"); setSt(Date.now()); }, 1500 + Math.random() * 3000);
  };

  const click = () => {
    if (state === "ready") { clearTimeout(tr.current); setState("tooEarly"); return; }
    if (state === "go") {
      const t = Date.now() - st;
      const nt = [...times, t];
      setTimes(nt);
      setState("done");
      const best = Math.min(...nt);
      if (onScore) onScore("best ms", best, nt.length);
    }
  };

  const avg = times.length ? Math.round(times.reduce((a, b) => a + b, 0) / times.length) : 0;
  const best = times.length ? Math.min(...times) : 0;

  return (
    <div style={{ textAlign: "center" }}>
      <h3 style={{ color: C.accentL }}>Reaction Time</h3>
      {times.length > 0 && <p style={{ color: C.dim, fontSize: 13 }}>Best: {best}ms · Avg: {avg}ms · {times.length} tries</p>}
      <div onClick={(state === "ready" || state === "go") ? click : undefined}
        style={{
          width: 220, height: 220, borderRadius: "50%", margin: "24px auto",
          display: "flex", alignItems: "center", justifyContent: "center",
          cursor: (state === "ready" || state === "go") ? "pointer" : "default",
          background: state === "go" ? C.success : state === "ready" ? C.danger : state === "tooEarly" ? "#c0392b" : C.card,
          transition: "background .1s", border: `2px solid ${C.border}`
        }}>
        <span style={{ color: "#fff", fontSize: 15, fontWeight: 600, textAlign: "center", padding: 16 }}>
          {state === "waiting" ? "Press Start" : state === "ready" ? "Wait for green..." : state === "go" ? "TAP!" : state === "tooEarly" ? "Too early!" : times.length ? `${times[times.length - 1]}ms` : ""}
        </span>
      </div>
      {(state === "waiting" || state === "done" || state === "tooEarly") && (
        <button onClick={start} style={sty(C.accent)}>{times.length ? "Again" : "Start"}</button>
      )}
    </div>
  );
}

function WordScrambleGame({ onScore }) {
  const ws = useRef([...WORDS_LIST].sort(() => Math.random() - .5).slice(0, 10));
  const sc = useRef(ws.current.map(scrambleWord));
  const [idx, setIdx] = useState(0);
  const [input, setInput] = useState("");
  const [score, setScore] = useState(0);
  const [fb, setFb] = useState("");
  const [done, setDone] = useState(false);

  const check = () => {
    const ok = input.toLowerCase().trim() === ws.current[idx];
    const ns = ok ? score + 1 : score;
    if (ok) setScore(ns);
    if (onScore) onScore("correct", ns, 10);
    setFb(ok ? "✓ Correct!" : `✗ "${ws.current[idx]}"`);
    setTimeout(() => {
      if (idx < 9) { setIdx(idx + 1); setInput(""); setFb(""); }
      else { setDone(true); }
    }, 1000);
  };

  const reset = () => {
    ws.current = [...WORDS_LIST].sort(() => Math.random() - .5).slice(0, 10);
    sc.current = ws.current.map(scrambleWord);
    setIdx(0); setScore(0); setFb(""); setDone(false);
  };

  if (done) {
    return (
      <div style={{ textAlign: "center" }}>
        <h3 style={{ color: C.success }}>Done!</h3>
        <p style={{ color: C.text, fontSize: 24 }}>{score}/10</p>
        <button onClick={reset} style={sty(C.accent)}>New Round</button>
      </div>
    );
  }

  return (
    <div style={{ textAlign: "center" }}>
      <h3 style={{ color: C.accentL }}>Unscramble — {idx + 1}/10</h3>
      <div style={{ fontSize: 34, fontWeight: 700, color: C.text, letterSpacing: 6, margin: "20px 0" }}>
        {(sc.current[idx] || "").toUpperCase()}
      </div>
      <input value={input} onChange={e => setInput(e.target.value)}
        onKeyDown={e => e.key === "Enter" && check()} placeholder="Type the word..."
        style={{ padding: "10px 16px", borderRadius: 10, border: `1px solid ${C.border}`, background: C.card, color: C.text, fontSize: 18, textAlign: "center", outline: "none", width: 220 }} />
      <br />
      <button onClick={check} style={{ ...sty(C.accent), marginTop: 12 }}>Submit</button>
      {fb && <p style={{ color: fb.startsWith("✓") ? C.success : C.danger, marginTop: 12, fontSize: 18 }}>{fb}</p>}
      <p style={{ color: C.dim, marginTop: 8 }}>Score: {score}</p>
    </div>
  );
}

function SpeedMathGame({ onScore }) {
  const gen = () => {
    const ops = ["+", "-", "×"];
    const op = ops[Math.floor(Math.random() * 3)];
    let a, b;
    if (op === "×") { a = Math.floor(Math.random() * 12) + 2; b = Math.floor(Math.random() * 12) + 2; }
    else { a = Math.floor(Math.random() * 90) + 10; b = Math.floor(Math.random() * 90) + 10; }
    return { q: `${a} ${op} ${b}`, a: op === "+" ? a + b : op === "-" ? a - b : a * b };
  };

  const probs = useRef(Array.from({ length: 20 }, gen));
  const [idx, setIdx] = useState(0);
  const [input, setInput] = useState("");
  const [score, setScore] = useState(0);
  const [t0] = useState(Date.now());
  const [done, setDone] = useState(false);

  const check = () => {
    const correct = parseInt(input) === probs.current[idx].a;
    const ns = correct ? score + 1 : score;
    if (correct) setScore(ns);
    if (onScore) onScore("correct", ns, 20);
    if (idx >= 19) setDone(true);
    else { setIdx(idx + 1); setInput(""); }
  };

  if (done) {
    const el = ((Date.now() - t0) / 1000).toFixed(1);
    return (
      <div style={{ textAlign: "center" }}>
        <h3 style={{ color: C.accentL }}>Done!</h3>
        <p style={{ color: C.text, fontSize: 24 }}>{score}/20 in {el}s</p>
        <p style={{ color: C.dim }}>~{(el / 20).toFixed(1)}s each</p>
        <button onClick={() => { probs.current = Array.from({ length: 20 }, gen); setIdx(0); setScore(0); setDone(false); setInput(""); }} style={sty(C.accent)}>New Round</button>
      </div>
    );
  }

  return (
    <div style={{ textAlign: "center" }}>
      <h3 style={{ color: C.accentL }}>Speed Math — {idx + 1}/20</h3>
      <div style={{ fontSize: 42, fontWeight: 700, color: C.text, margin: "20px 0" }}>{probs.current[idx].q}</div>
      <input value={input} onChange={e => setInput(e.target.value.replace(/[^0-9-]/g, ""))}
        onKeyDown={e => e.key === "Enter" && check()} autoFocus
        style={{ padding: "10px 16px", borderRadius: 10, border: `1px solid ${C.border}`, background: C.card, color: C.text, fontSize: 24, textAlign: "center", outline: "none", width: 160 }} />
      <br />
      <button onClick={check} style={{ ...sty(C.accent), marginTop: 12 }}>Submit</button>
      <p style={{ color: C.dim, marginTop: 8 }}>Score: {score}/{idx}</p>
    </div>
  );
}

function ColorMatchGame({ onScore }) {
  const colors = [
    { name: "RED", hex: "#ef4444" }, { name: "BLUE", hex: "#3b82f6" },
    { name: "GREEN", hex: "#22c55e" }, { name: "YELLOW", hex: "#eab308" },
    { name: "PURPLE", hex: "#a855f7" }, { name: "ORANGE", hex: "#f97316" }
  ];
  const [score, setScore] = useState(0);
  const [total, setTotal] = useState(0);
  const [round, setRound] = useState(null);

  const gen = () => {
    const w = colors[Math.floor(Math.random() * colors.length)];
    const c = colors[Math.floor(Math.random() * colors.length)];
    setRound({ word: w.name, color: c.hex, match: w.name === c.name });
  };

  useEffect(() => { gen(); }, []);

  const answer = (yes) => {
    const correct = (yes && round.match) || (!yes && !round.match);
    const ns = correct ? score + 1 : score;
    const nt = total + 1;
    if (correct) setScore(ns);
    setTotal(nt);
    if (onScore) onScore("correct", ns, nt);
    gen();
  };

  if (!round) return null;

  return (
    <div style={{ textAlign: "center" }}>
      <h3 style={{ color: C.accentL }}>Color Match — Stroop Test</h3>
      <p style={{ color: C.dim, fontSize: 13 }}>Does the <b>ink color</b> match the <b>word</b>?</p>
      <div style={{ fontSize: 56, fontWeight: 900, color: round.color, margin: "32px 0", userSelect: "none" }}>
        {round.word}
      </div>
      <div style={{ display: "flex", gap: 16, justifyContent: "center" }}>
        <button onClick={() => answer(true)} style={{ ...sty(C.success, true), padding: "14px 36px", fontSize: 18 }}>Match</button>
        <button onClick={() => answer(false)} style={{ ...sty(C.danger, true), padding: "14px 36px", fontSize: 18 }}>No Match</button>
      </div>
      <p style={{ color: C.dim, marginTop: 16 }}>
        {score}/{total} correct{total > 0 ? ` (${Math.round(score / total * 100)}%)` : ""}
      </p>
    </div>
  );
}

function SimonGame({ onScore }) {
  const cols = ["#ef4444", "#3b82f6", "#22c55e", "#eab308"];
  const [seq, setSeq] = useState([]);
  const [input, setInput] = useState([]);
  const [phase, setPhase] = useState("idle");
  const [score, setScore] = useState(0);
  const [active, setActive] = useState(-1);

  const play = async (s) => {
    setPhase("showing");
    for (let i = 0; i < s.length; i++) {
      await new Promise(r => setTimeout(r, 400));
      setActive(s[i]);
      await new Promise(r => setTimeout(r, 500));
      setActive(-1);
    }
    setPhase("input");
    setInput([]);
  };

  const start = () => {
    const s = [Math.floor(Math.random() * 4)];
    setSeq(s); setScore(0); play(s);
  };

  const tap = (i) => {
    if (phase !== "input") return;
    const ni = [...input, i];
    setInput(ni);
    if (ni[ni.length - 1] !== seq[ni.length - 1]) {
      setPhase("fail");
      if (onScore) onScore("rounds", score, score);
      return;
    }
    if (ni.length === seq.length) {
      const ns = score + 1;
      setScore(ns);
      if (onScore) onScore("rounds", ns, ns);
      const nseq = [...seq, Math.floor(Math.random() * 4)];
      setSeq(nseq);
      setTimeout(() => play(nseq), 600);
    }
  };

  return (
    <div style={{ textAlign: "center" }}>
      <h3 style={{ color: C.accentL }}>Simon Says</h3>
      <p style={{ color: C.dim, fontSize: 13 }}>Score: {score}</p>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, width: 220, margin: "20px auto" }}>
        {cols.map((c, i) => (
          <div key={i} onClick={() => tap(i)} style={{
            width: 100, height: 100, borderRadius: 16,
            background: active === i ? c : c + "44",
            cursor: phase === "input" ? "pointer" : "default",
            transition: "all .15s", border: `3px solid ${c}66`
          }} />
        ))}
      </div>
      {phase === "idle" && <button onClick={start} style={sty(C.accent)}>Start</button>}
      {phase === "showing" && <p style={{ color: C.warn }}>Watch the pattern...</p>}
      {phase === "input" && <p style={{ color: C.success }}>Your turn! ({input.length}/{seq.length})</p>}
      {phase === "fail" && (
        <div>
          <p style={{ color: C.danger }}>Wrong! Score: {score}</p>
          <button onClick={start} style={sty(C.accent)}>Retry</button>
        </div>
      )}
    </div>
  );
}

function BrainHub({ onScore }) {
  const games = [
    { id: "sequence", name: "Number Memory", desc: "Recall growing sequences", icon: "🔢" },
    { id: "reaction", name: "Reaction Time", desc: "Tap when green", icon: "⚡" },
    { id: "scramble", name: "Word Unscramble", desc: "Decode scrambled words", icon: "🔤" },
    { id: "speed", name: "Speed Math", desc: "Fast arithmetic", icon: "➕" },
    { id: "color", name: "Color Match (Stroop)", desc: "Ink color vs word", icon: "🎨" },
    { id: "simon", name: "Simon Says", desc: "Remember the pattern", icon: "🟢" },
  ];
  const [g, setG] = useState(null);

  if (!g) {
    return (
      <div style={{ textAlign: "center" }}>
        <h3 style={{ color: C.accentL, marginBottom: 4 }}>Brain Training Games</h3>
        <p style={{ color: C.dim, fontSize: 13, marginBottom: 16 }}>Pick a game — play as many rounds as you want</p>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, maxWidth: 400, margin: "0 auto" }}>
          {games.map(gm => (
            <button key={gm.id} onClick={() => setG(gm.id)} style={{ ...sty(C.brain), textAlign: "left", padding: "16px", borderRadius: 14, display: "flex", gap: 10, alignItems: "center" }}>
              <span style={{ fontSize: 24 }}>{gm.icon}</span>
              <div>
                <div style={{ fontWeight: 600, fontSize: 14 }}>{gm.name}</div>
                <div style={{ fontSize: 11, opacity: .7, marginTop: 2 }}>{gm.desc}</div>
              </div>
            </button>
          ))}
        </div>
      </div>
    );
  }

  const BackBtn = () => (
    <button onClick={() => setG(null)} style={{ ...sty(C.dim), padding: "6px 14px", fontSize: 12, marginBottom: 16 }}>← All Games</button>
  );

  let GameComp = null;
  if (g === "sequence") GameComp = SequenceGame;
  else if (g === "reaction") GameComp = ReactionGame;
  else if (g === "scramble") GameComp = WordScrambleGame;
  else if (g === "speed") GameComp = SpeedMathGame;
  else if (g === "color") GameComp = ColorMatchGame;
  else GameComp = SimonGame;

  return (
    <div>
      <BackBtn />
      <GameComp onScore={onScore} />
    </div>
  );
}

/* ═══════════════════════════════════════
   CONTENT VIEWS
   ═══════════════════════════════════════ */

function BreathingView({ data, onScore }) {
  const [phase, setPhase] = useState("ready");
  const [counter, setCounter] = useState(0);
  const [cycles, setCycles] = useState(0);
  const pR = useRef("ready");
  const cR = useRef(0);
  const cyclesRef = useRef(0);

  useEffect(() => {
    if (phase === "ready") return;
    const iv = setInterval(() => {
      cR.current -= 1;
      if (cR.current <= 0) {
        const ps = [];
        if (data.inhale > 0) ps.push(["inhale", data.inhale]);
        if (data.hold1 > 0) ps.push(["hold", data.hold1]);
        if (data.exhale > 0) ps.push(["exhale", data.exhale]);
        if (data.hold2 > 0) ps.push(["hold2", data.hold2]);
        const idx = ps.findIndex(p => p[0] === pR.current);
        const nx = (idx + 1) % ps.length;
        if (nx === 0) {
          cyclesRef.current += 1;
          setCycles(cyclesRef.current);
          onScore("cycles", cyclesRef.current, cyclesRef.current);
        }
        pR.current = ps[nx][0];
        cR.current = ps[nx][1];
        setPhase(ps[nx][0]);
      }
      setCounter(cR.current);
    }, 1000);
    return () => clearInterval(iv);
  }, [phase !== "ready"]);

  const start = () => {
    pR.current = "inhale"; cR.current = data.inhale;
    setPhase("inhale"); setCounter(data.inhale);
  };

  const label = phase === "hold2" ? "HOLD" : phase.toUpperCase();
  const scale = phase === "inhale" ? 1.5 : phase === "exhale" ? .65 : 1.05;
  const pc = phase === "inhale" ? "#00d2c6" : phase === "exhale" ? "#8b5cf6" : "#f5c542";

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 16 }}>
      <h3 style={{ color: C.text, margin: 0 }}>{data.name}</h3>
      <p style={{ color: C.dim, margin: 0, textAlign: "center", maxWidth: 440, fontSize: 14, lineHeight: 1.5 }}>{data.desc}</p>
      {data.tip && <p style={{ color: C.accentL, fontSize: 13, fontStyle: "italic", margin: 0, textAlign: "center", maxWidth: 400 }}>{"💡 " + data.tip}</p>}
      {phase === "ready" ? (
        <button onClick={start} style={{ ...sty(C.accent, true), padding: "16px 56px", fontSize: 18, marginTop: 20, borderRadius: 14 }}>Begin</button>
      ) : (
        <>
          <div style={{ position: "relative", width: 200, height: 200, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <div style={{
              width: 150 * scale, height: 150 * scale, borderRadius: "50%",
              background: `radial-gradient(circle, ${pc}30, ${pc}08)`,
              border: `3px solid ${pc}`, transition: "all 1s ease-in-out",
              display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column"
            }}>
              <div style={{ fontSize: 38, fontWeight: 700, color: pc }}>{counter}</div>
              <div style={{ fontSize: 13, color: pc, letterSpacing: 3 }}>{label}</div>
            </div>
          </div>
          <div style={{ color: C.dim, fontSize: 13 }}>Cycles: {cycles}</div>
        </>
      )}
    </div>
  );
}

function ReadingView({ data, onScore }) {
  const [qIdx, setQIdx] = useState(-1);
  const [showA, setShowA] = useState(false);
  const [termIdx, setTermIdx] = useState(-1);
  const [answered, setAnswered] = useState(0);
  const totalQ = (data.questions || []).length;

  const revealAnswer = () => {
    setShowA(true);
    const na = answered + 1;
    setAnswered(na);
    onScore("questions reviewed", na, totalQ);
  };

  return (
    <div style={{ maxWidth: 640, margin: "0 auto" }}>
      <h3 style={{ color: C.accentL, margin: "0 0 16px" }}>{data.title}</h3>
      <div style={{ color: C.text, lineHeight: 1.8, fontSize: 15, whiteSpace: "pre-wrap" }}>{data.text}</div>
      {data.keyTerms && data.keyTerms.length > 0 && (
        <div style={{ marginTop: 20, display: "flex", gap: 8, flexWrap: "wrap" }}>
          {data.keyTerms.map((t, i) => (
            <button key={i} onClick={() => setTermIdx(termIdx === i ? -1 : i)}
              style={{ ...sty(C.reading), padding: "6px 14px", fontSize: 12, borderRadius: 20 }}>{t.term}</button>
          ))}
        </div>
      )}
      {termIdx >= 0 && data.keyTerms && data.keyTerms[termIdx] && (
        <div style={{ marginTop: 8, padding: 12, background: C.card, borderRadius: 10, border: `1px solid ${C.border}` }}>
          <span style={{ color: C.reading, fontWeight: 600 }}>{data.keyTerms[termIdx].term}: </span>
          <span style={{ color: C.text }}>{data.keyTerms[termIdx].definition}</span>
        </div>
      )}
      <div style={{ marginTop: 24, borderTop: `1px solid ${C.border}`, paddingTop: 16 }}>
        <p style={{ color: C.dim, fontSize: 13, marginBottom: 12 }}>Comprehension Check</p>
        {(data.questions || []).map((q, i) => (
          <div key={i} style={{ marginBottom: 12 }}>
            <button onClick={() => { setQIdx(qIdx === i ? -1 : i); setShowA(false); }}
              style={{ ...sty(i <= qIdx ? C.success : C.reading), padding: "8px 16px", fontSize: 13, width: "100%", textAlign: "left" }}>
              <span style={{ opacity: .6, marginRight: 8 }}>Q{i + 1}</span>{q.q}
            </button>
            {qIdx === i && (
              <div style={{ padding: "8px 16px", marginTop: 4 }}>
                {!showA ? (
                  <button onClick={revealAnswer} style={{ ...sty(C.success), padding: "6px 16px", fontSize: 12 }}>Show Answer</button>
                ) : (
                  <p style={{ color: C.success, margin: 0 }}>{q.a}</p>
                )}
              </div>
            )}
          </div>
        ))}
        {data.furtherThinking && (
          <div style={{ marginTop: 16, padding: 16, background: C.accent + "15", borderRadius: 12, color: C.accentL, fontSize: 14 }}>
            {"🤔 " + data.furtherThinking}
          </div>
        )}
      </div>
    </div>
  );
}

function LanguageView({ data, onScore }) {
  const [idx, setIdx] = useState(0);
  const [rev, setRev] = useState(false);
  const [known, setKnown] = useState(0);

  const words = data.words || [];
  const w = words[idx];

  const markKnown = () => {
    const nk = known + 1;
    setKnown(nk);
    onScore("recalled", nk, words.length);
    setIdx(idx + 1); setRev(false);
  };

  const markUnknown = () => {
    onScore("recalled", known, words.length);
    setIdx(idx + 1); setRev(false);
  };

  if (!w || idx >= words.length) {
    return (
      <div style={{ textAlign: "center" }}>
        <h3 style={{ color: C.success }}>Done!</h3>
        <p style={{ color: C.text, fontSize: 20 }}>{known}/{words.length} recalled</p>
      </div>
    );
  }

  return (
    <div style={{ textAlign: "center" }}>
      <h3 style={{ color: C.accentL }}>{data.lang} — {idx + 1}/{words.length}</h3>
      <div style={{ background: C.card, borderRadius: 16, padding: 32, margin: "16px auto", maxWidth: 440, border: `1px solid ${C.border}` }}>
        <div style={{ fontSize: 26, fontWeight: 700, color: C.text, marginBottom: 4 }}>{w.w}</div>
        {w.pronunciation && <div style={{ fontSize: 14, color: C.dim, marginBottom: 8 }}>{w.pronunciation}</div>}
        {w.difficulty && (
          <span style={{
            fontSize: 11, padding: "2px 10px", borderRadius: 10,
            background: w.difficulty === "beginner" ? C.success + "22" : w.difficulty === "intermediate" ? C.warn + "22" : C.danger + "22",
            color: w.difficulty === "beginner" ? C.success : w.difficulty === "intermediate" ? C.warn : C.danger
          }}>{w.difficulty}</span>
        )}
        {rev ? (
          <div style={{ marginTop: 16 }}>
            <div style={{ fontSize: 18, color: C.success, marginBottom: 8 }}>{w.m}</div>
            <div style={{ fontSize: 14, color: C.dim, fontStyle: "italic" }}>{w.ex}</div>
            {w.exEn && <div style={{ fontSize: 13, color: C.dim, marginTop: 4 }}>→ {w.exEn}</div>}
            {w.usage && <div style={{ fontSize: 12, color: C.accentL, marginTop: 8, padding: "6px 12px", background: C.accent + "12", borderRadius: 8 }}>Usage: {w.usage}</div>}
            <div style={{ display: "flex", gap: 10, justifyContent: "center", marginTop: 16 }}>
              <button onClick={markUnknown} style={sty(C.danger)}>Didn't Know</button>
              <button onClick={markKnown} style={sty(C.success)}>Got It ✓</button>
            </div>
          </div>
        ) : (
          <button onClick={() => setRev(true)} style={{ ...sty(C.language), marginTop: 16 }}>Reveal</button>
        )}
      </div>
      <p style={{ color: C.dim, fontSize: 13 }}>Recalled: {known}/{idx}</p>
    </div>
  );
}

function MathView({ data, onScore }) {
  const [idx, setIdx] = useState(0);
  const [hint, setHint] = useState(false);
  const [ans, setAns] = useState(false);
  const [input, setInput] = useState("");
  const [solved, setSolved] = useState(0);

  const puzzles = data.puzzles || [];
  const p = puzzles[idx];

  if (!p || idx >= puzzles.length) {
    return (
      <div style={{ textAlign: "center" }}>
        <h3 style={{ color: C.success }}>All Puzzles Done!</h3>
        <p style={{ color: C.text, fontSize: 20 }}>{solved}/{puzzles.length} solved</p>
      </div>
    );
  }

  const next = () => {
    if (!ans) {
      const ns = solved + 1;
      setSolved(ns);
      onScore("solved", ns, puzzles.length);
    } else {
      onScore("solved", solved, puzzles.length);
    }
    setIdx(idx + 1); setHint(false); setAns(false); setInput("");
  };

  return (
    <div style={{ textAlign: "center", maxWidth: 540, margin: "0 auto" }}>
      <h3 style={{ color: C.accentL }}>Puzzle {idx + 1}/{puzzles.length}</h3>
      <div style={{ display: "flex", gap: 8, justifyContent: "center", marginBottom: 12 }}>
        {p.category && <span style={{ fontSize: 11, padding: "2px 10px", borderRadius: 10, background: C.accent + "22", color: C.accentL }}>{p.category}</span>}
        {p.difficulty && <span style={{ fontSize: 11, padding: "2px 10px", borderRadius: 10, background: p.difficulty === "hard" ? C.danger + "22" : C.warn + "22", color: p.difficulty === "hard" ? C.danger : C.warn }}>{p.difficulty}</span>}
      </div>
      <p style={{ color: C.text, fontSize: 17, lineHeight: 1.6, margin: "16px 0" }}>{p.q}</p>
      <input value={input} onChange={e => setInput(e.target.value)} placeholder="Your answer..."
        style={{ padding: "10px 16px", borderRadius: 10, border: `1px solid ${C.border}`, background: C.card, color: C.text, fontSize: 16, width: 240, textAlign: "center", outline: "none" }} />
      <div style={{ display: "flex", gap: 10, justifyContent: "center", marginTop: 14, flexWrap: "wrap" }}>
        {!hint && <button onClick={() => setHint(true)} style={sty(C.warn)}>Hint</button>}
        {!ans && <button onClick={() => setAns(true)} style={sty(C.success)}>Answer</button>}
        <button onClick={next} style={sty(C.accent)}>Next →</button>
      </div>
      {hint && <p style={{ color: C.warn, marginTop: 12 }}>{"💡 " + p.hint}</p>}
      {ans && <p style={{ color: C.success, marginTop: 10, fontSize: 16, lineHeight: 1.5 }}>{p.a}</p>}
    </div>
  );
}

function FlashcardView({ data, onScore }) {
  const [idx, setIdx] = useState(0);
  const [flip, setFlip] = useState(false);
  const [known, setKnown] = useState(0);

  const cards = data.cards || [];
  const c = cards[idx];

  const markKnown = () => {
    const nk = known + 1;
    setKnown(nk);
    onScore("knew", nk, cards.length);
    setIdx(idx + 1); setFlip(false);
  };

  const markUnknown = () => {
    onScore("knew", known, cards.length);
    setIdx(idx + 1); setFlip(false);
  };

  if (!c || idx >= cards.length) {
    return (
      <div style={{ textAlign: "center" }}>
        <h3 style={{ color: C.success }}>Deck Complete!</h3>
        <p style={{ color: C.text, fontSize: 22 }}>{known}/{cards.length} knew</p>
      </div>
    );
  }

  return (
    <div style={{ textAlign: "center" }}>
      <h3 style={{ color: C.accentL }}>{data.topic}</h3>
      {data.why && <p style={{ color: C.dim, fontSize: 13, margin: "0 0 12px" }}>{data.why}</p>}
      <p style={{ color: C.dim, fontSize: 12 }}>{idx + 1}/{cards.length}</p>
      <div onClick={() => setFlip(!flip)} style={{
        background: flip ? C.success + "14" : C.card, borderRadius: 16,
        padding: "32px 28px", margin: "12px auto", maxWidth: 460, minHeight: 130,
        display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer",
        border: `2px solid ${flip ? C.success : C.border}`, transition: "all .3s",
        flexDirection: "column", gap: 12
      }}>
        {!flip ? (
          <p style={{ fontSize: 19, color: C.text, fontWeight: 600, margin: 0, lineHeight: 1.5 }}>{c.f}</p>
        ) : (
          <>
            <p style={{ fontSize: 15, color: C.success, margin: 0, lineHeight: 1.6 }}>{c.b}</p>
            {c.example && <p style={{ fontSize: 13, color: C.dim, margin: 0, fontStyle: "italic" }}>Example: {c.example}</p>}
          </>
        )}
      </div>
      <p style={{ color: C.dim, fontSize: 11 }}>Tap to flip</p>
      {flip && (
        <div style={{ display: "flex", gap: 12, justifyContent: "center", marginTop: 6 }}>
          <button onClick={markUnknown} style={sty(C.danger)}>Didn't Know</button>
          <button onClick={markKnown} style={sty(C.success)}>Knew It ✓</button>
        </div>
      )}
      <p style={{ color: C.dim, marginTop: 10, fontSize: 13 }}>Score: {known}/{idx + (flip ? 1 : 0)}</p>
    </div>
  );
}

function NewsView({ data, onScore }) {
  const [rev, setRev] = useState(1);
  const [showConn, setShowConn] = useState(false);
  const facts = data.facts || [];
  const connections = data.connections || [];

  const revealNext = () => {
    const nr = rev + 1;
    setRev(nr);
    onScore("facts explored", nr, facts.length);
  };

  return (
    <div style={{ maxWidth: 540, margin: "0 auto" }}>
      <h3 style={{ color: C.accentL }}>{"📰 " + data.topic}</h3>
      {data.intro && <p style={{ color: C.text, fontSize: 15, lineHeight: 1.6, margin: "8px 0 16px" }}>{data.intro}</p>}
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {facts.slice(0, rev).map((f, i) => {
          const fact = typeof f === "string" ? f : f.fact;
          const src = typeof f === "object" ? f.source : null;
          return (
            <div key={i} style={{ background: C.card, borderRadius: 12, padding: 16, borderLeft: `3px solid ${C.success}`, color: C.text, fontSize: 15, lineHeight: 1.5 }}>
              {fact}
              {src && <div style={{ fontSize: 11, color: C.dim, marginTop: 4 }}>— {src}</div>}
            </div>
          );
        })}
      </div>
      {rev < facts.length ? (
        <button onClick={revealNext} style={{ ...sty(C.news), marginTop: 14 }}>Next Fact ({rev}/{facts.length})</button>
      ) : (
        <div style={{ marginTop: 16 }}>
          {connections.length > 0 && !showConn && (
            <button onClick={() => setShowConn(true)} style={{ ...sty(C.accent), marginBottom: 12 }}>Show Connections</button>
          )}
          {showConn && connections.map((cn, i) => (
            <div key={i} style={{ padding: 10, background: C.accent + "12", borderRadius: 10, color: C.accentL, fontSize: 13, marginBottom: 6 }}>
              Fact {(cn.from || 0) + 1} ↔ Fact {(cn.to || 0) + 1}: {cn.link}
            </div>
          ))}
          {data.insight && <div style={{ marginTop: 12, padding: 16, background: C.success + "14", borderRadius: 12, color: C.success, fontStyle: "italic" }}>{"💭 " + data.insight}</div>}
          {data.actionable && <div style={{ marginTop: 8, padding: 14, background: C.warn + "14", borderRadius: 12, color: C.warn, fontSize: 14 }}>{"🎯 Try this: " + data.actionable}</div>}
        </div>
      )}
    </div>
  );
}

function CustomView({ name }) {
  const [notes, setNotes] = useState("");
  return (
    <div style={{ textAlign: "center", maxWidth: 500, margin: "0 auto" }}>
      <h3 style={{ color: C.accentL }}>{name}</h3>
      <textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Notes..."
        style={{ width: "100%", minHeight: 180, padding: 16, borderRadius: 12, border: `1px solid ${C.border}`, background: C.card, color: C.text, fontSize: 15, outline: "none", resize: "vertical", boxSizing: "border-box", marginTop: 12 }} />
    </div>
  );
}

function Dots({ color }) {
  const [d, setD] = useState("");
  useEffect(() => {
    const iv = setInterval(() => setD(x => x.length >= 3 ? "" : x + "."), 400);
    return () => clearInterval(iv);
  }, []);
  return (<span style={{ color }}>{d}</span>);
}

/* ═══════════════════════════════════════
   MAIN APP
   ═══════════════════════════════════════ */

const V = { HOME: 0, BUILD: 1, LOAD: 2, SESSION: 3, REFLECT: 4 };

export default function App() {
  const [view, setView] = useState(V.HOME);
  const [selected, setSelected] = useState([]);
  const [customs, setCustoms] = useState([]);
  const [customIn, setCustomIn] = useState("");
  const [langPref, setLangPref] = useState("");
  const [content, setContent] = useState({});
  const [loadProg, setLoadProg] = useState({ done: 0, total: 0, cur: "" });
  const [curPhase, setCurPhase] = useState(0);
  const curPhaseRef = useRef(0);
  const selectedRef = useRef([]);
  const [sessionStart, setSessionStart] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [phaseTimes, setPhaseTimes] = useState([]);
  const phaseStartMs = useRef(0);
  const [scores, setScores] = useState({});
  const [streak, setStreak] = useState({ count: 0, lastDate: "" });
  const [sessions, setSessions] = useState(0);
  const [note, setNote] = useState("");
  const [rating, setRating] = useState(0);
  const [init, setInit] = useState(true);
  const timerRef = useRef();

  // ── Load persisted data ──
  useEffect(() => {
    try {
      const raw = localStorage.getItem("steadydose_data");
      if (raw) {
        const d = JSON.parse(raw);
        setStreak(d.streak || { count: 0, lastDate: "" });
        setSessions(d.sessions || 0);
      }
    } catch (e) { /* ignore */ }
    setInit(false);
  }, []);

  const save = async (s, sc) => {
    try {
      localStorage.setItem("steadydose_data", JSON.stringify({ streak: s, sessions: sc }));
    } catch (e) { /* ignore */ }
  };

  const reportScore = (actId, label, got, total) => {
    setScores(prev => ({
      ...prev,
      [actId]: {
        label, got, total,
        isFraction: total > 0 && label !== "best ms" && label !== "rounds" && label !== "level reached" && label !== "cycles"
      }
    }));
  };

  const allActs = [
    ...ACTIVITIES,
    ...customs.map(n => ({ id: "c_" + n, name: n, icon: "✨", color: C.custom, weight: 10 }))
  ];

  const toggle = (id) => {
    if (selected.includes(id)) {
      const ns = selected.filter(s => s !== id);
      setSelected(ns);
      selectedRef.current = ns;
    } else if (selected.length < 5) {
      const ns = [...selected, id];
      setSelected(ns);
      selectedRef.current = ns;
    }
  };

  const addCustom = () => {
    const v = customIn.trim();
    if (v && !customs.includes(v)) { setCustoms([...customs, v]); setCustomIn(""); }
  };

  // ── Generate content ──
  const startGen = async () => {
    if (selected.length < 2) return;
    const toFetch = selected.filter(id => !id.startsWith("c_") && id !== "brain");
    setLoadProg({ done: 0, total: 1, cur: "Generating all content" });
    setView(V.LOAD);

    let history = pruneHistory(await loadHistory());
    let loaded = {};

    if (toFetch.length > 0) {
      try {
        const batchResult = await fetchAllContent(toFetch, langPref, history);
        for (const id of toFetch) {
          if (batchResult[id]) {
            loaded[id] = batchResult[id];
            history = addToHistory(history, id, extractKeys(id, batchResult[id]));
          } else {
            loaded[id] = null;
          }
        }
      } catch (e) {
        console.error("Batch fetch failed:", e.message);
        setLoadProg({ done: 0, total: 1, cur: "⚠ " + e.message.slice(0, 80) });
        // Fallback: try individually
        for (let i = 0; i < toFetch.length; i++) {
          const id = toFetch[i];
          const nm = (allActs.find(a => a.id === id) || {}).name || id;
          setLoadProg({ done: i, total: toFetch.length, cur: nm + " (fallback)" });
          try {
            const used = getUsedKeys(history, id);
            let prompt = id === "language" ? PROMPTS.language(langPref, used) : PROMPTS[id](used);
            const r = await fetch("/api/generate", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                model: "claude-haiku-4-5-20251001",
                max_tokens: 1500,
                system: "You are a content generator. Respond ONLY with valid JSON. No markdown, no backticks, no preamble.",
                messages: [{ role: "user", content: prompt }]
              })
            });
            const d = await r.json();
            if (d.error) throw new Error(d.error.message);
            const txt = (d.content || []).map(b => b.text || "").join("");
            const result = JSON.parse(txt.replace(/```json|```/g, "").trim());
            loaded[id] = result;
            history = addToHistory(history, id, extractKeys(id, result));
          } catch (err) {
            console.error(`Fallback failed for ${id}:`, err.message);
            loaded[id] = null;
          }
        }
      }
    }

    await saveHistory(history);
    setContent(loaded);
    setLoadProg({ done: 1, total: 1, cur: "Ready!" });
    setCurPhase(0);
    curPhaseRef.current = 0;
    selectedRef.current = selected;
    const now = Date.now();
    setSessionStart(now);
    phaseStartMs.current = now;
    setElapsed(0);
    setPhaseTimes([]);
    setScores({});
    setTimeout(() => setView(V.SESSION), 600);
  };

  // ── Elapsed timer ──
  useEffect(() => {
    if (view !== V.SESSION) return;
    timerRef.current = setInterval(() => {
      setElapsed(Math.floor((Date.now() - sessionStart) / 1000));
    }, 1000);
    return () => clearInterval(timerRef.current);
  }, [view, sessionStart]);

  const nextPhase = () => {
    const now = Date.now();
    const sel = selectedRef.current;
    const cp = curPhaseRef.current;
    const dur = Math.floor((now - phaseStartMs.current) / 1000);
    setPhaseTimes(prev => [...prev, { id: sel[cp], duration: dur }]);
    if (cp >= sel.length - 1) {
      finish();
      return;
    }
    const next = cp + 1;
    curPhaseRef.current = next;
    setCurPhase(next);
    phaseStartMs.current = now;
  };

  const finish = async () => {
    clearInterval(timerRef.current);
    const today = todayStr();
    let ns = { ...streak };
    const y = new Date();
    y.setDate(y.getDate() - 1);
    const ys = y.toISOString().slice(0, 10);
    if (streak.lastDate === today) { /* already done */ }
    else if (streak.lastDate === ys) ns = { count: streak.count + 1, lastDate: today };
    else ns = { count: 1, lastDate: today };
    const sc = sessions + 1;
    setStreak(ns);
    setSessions(sc);
    await save(ns, sc);
    setView(V.REFLECT);
  };

  const renderContent = (id) => {
    if (id === "brain") return (<BrainHub onScore={(l, g, t) => reportScore(id, l, g, t)} />);
    if (id.startsWith("c_")) {
      const nm = (allActs.find(a => a.id === id) || {}).name || "Custom";
      return (<CustomView name={nm} />);
    }
    const d = content[id];
    if (!d) return (<div style={{ textAlign: "center", color: C.dim, padding: 32 }}>Content could not load. Use this time for self-directed practice.</div>);
    if (id === "breathing") return (<BreathingView data={d} onScore={(l, g, t) => reportScore(id, l, g, t)} />);
    if (id === "reading") return (<ReadingView data={d} onScore={(l, g, t) => reportScore(id, l, g, t)} />);
    if (id === "language") return (<LanguageView data={d} onScore={(l, g, t) => reportScore(id, l, g, t)} />);
    if (id === "math") return (<MathView data={d} onScore={(l, g, t) => reportScore(id, l, g, t)} />);
    if (id === "flashcard") return (<FlashcardView data={d} onScore={(l, g, t) => reportScore(id, l, g, t)} />);
    if (id === "news") return (<NewsView data={d} onScore={(l, g, t) => reportScore(id, l, g, t)} />);
    return null;
  };

  if (init) {
    return (<div style={{ background: C.bg, minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", color: C.text, fontFamily: "system-ui" }}>Loading...</div>);
  }

  // ═══ HOME ═══
  if (view === V.HOME) {
    return (
      <div style={{ background: C.bg, minHeight: "100vh", padding: 24, fontFamily: "system-ui, -apple-system, sans-serif" }}>
        <div style={{ maxWidth: 520, margin: "0 auto", textAlign: "center" }}>
          <div style={{ fontSize: 52, marginBottom: 8 }}>💊</div>
          <h1 style={{ color: C.text, fontSize: 28, margin: "0 0 4px", fontWeight: 700 }}>SteadyDose</h1>
          <p style={{ color: C.dim, margin: "0 0 32px", fontSize: 15 }}>One hour. Every day. Everything changes.</p>
          <div style={{ display: "flex", gap: 16, justifyContent: "center", marginBottom: 32 }}>
            <div style={{ background: C.card, borderRadius: 16, padding: "20px 32px", border: `1px solid ${C.border}` }}>
              <div style={{ fontSize: 34, fontWeight: 700, color: C.accentL }}>{streak.count}</div>
              <div style={{ color: C.dim, fontSize: 13, marginTop: 4 }}>🔥 Streak</div>
            </div>
            <div style={{ background: C.card, borderRadius: 16, padding: "20px 32px", border: `1px solid ${C.border}` }}>
              <div style={{ fontSize: 34, fontWeight: 700, color: C.success }}>{sessions}</div>
              <div style={{ color: C.dim, fontSize: 13, marginTop: 4 }}>Sessions</div>
            </div>
          </div>
          {streak.lastDate === todayStr() && (
            <div style={{ background: C.success + "16", border: `1px solid ${C.success}40`, borderRadius: 12, padding: 14, marginBottom: 24, color: C.success, fontSize: 14 }}>
              ✓ Today's dose taken — streak safe
            </div>
          )}
          <button onClick={() => setView(V.BUILD)}
            style={{ padding: "16px 48px", background: `linear-gradient(135deg, ${C.accent}, ${C.brain})`, color: "#fff", border: "none", borderRadius: 14, fontSize: 18, fontWeight: 600, cursor: "pointer", width: "100%" }}>
            Build Today's Dose →
          </button>
          <p style={{ color: C.dim, fontSize: 12, marginTop: 24 }}>
            {new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}
          </p>
        </div>
      </div>
    );
  }

  // ═══ BUILD ═══
  if (view === V.BUILD) {
    return (
      <div style={{ background: C.bg, minHeight: "100vh", padding: 24, fontFamily: "system-ui, -apple-system, sans-serif" }}>
        <div style={{ maxWidth: 560, margin: "0 auto" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
            <button onClick={() => setView(V.HOME)} style={{ background: "none", border: "none", color: C.dim, cursor: "pointer", fontSize: 14 }}>← Back</button>
            <h2 style={{ color: C.text, margin: 0, fontSize: 20 }}>Mix Your Dose</h2>
            <div style={{ width: 48 }} />
          </div>

          <div style={{ background: C.card, borderRadius: 12, padding: 14, marginBottom: 20, textAlign: "center", border: `1px solid ${C.border}` }}>
            <span style={{ color: C.text, fontSize: 15 }}>{selected.length} selected</span>
            {selected.length >= 2 && <span style={{ color: C.dim, fontSize: 13 }}> · Go at your own pace</span>}
            {selected.length > 0 && selected.length < 2 && <span style={{ color: C.warn, fontSize: 13 }}> · Pick at least 2</span>}
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
            {allActs.map(act => {
              const sel = selected.includes(act.id);
              return (
                <div key={act.id} onClick={() => toggle(act.id)}
                  style={{ background: sel ? act.color + "12" : C.card, borderRadius: 12, padding: "14px 16px", border: `1px solid ${sel ? act.color + "44" : C.border}`, cursor: "pointer", transition: "all .2s", display: "flex", alignItems: "center", gap: 12 }}>
                  <span style={{ fontSize: 22 }}>{act.icon}</span>
                  <span style={{ color: C.text, flex: 1, fontWeight: sel ? 600 : 400, fontSize: 15 }}>{act.name}</span>
                  <span style={{ color: sel ? act.color : C.dim, fontWeight: 700, fontSize: 18 }}>{sel ? "✓" : "+"}</span>
                </div>
              );
            })}
          </div>

          {selected.includes("language") && (
            <div style={{ background: C.card, borderRadius: 12, padding: 14, marginBottom: 12, border: `1px solid ${C.border}` }}>
              <input value={langPref} onChange={e => setLangPref(e.target.value)}
                placeholder="Preferred language (or blank = random)"
                style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: `1px solid ${C.border}`, background: C.bg, color: C.text, outline: "none", fontSize: 14, boxSizing: "border-box" }} />
            </div>
          )}

          <div style={{ background: C.card, borderRadius: 12, padding: 14, marginBottom: 20, border: `1px solid ${C.border}` }}>
            <div style={{ display: "flex", gap: 8 }}>
              <input value={customIn} onChange={e => setCustomIn(e.target.value)}
                onKeyDown={e => e.key === "Enter" && addCustom()}
                placeholder="Add custom activity..."
                style={{ flex: 1, padding: "8px 12px", borderRadius: 8, border: `1px solid ${C.border}`, background: C.bg, color: C.text, outline: "none", fontSize: 14 }} />
              <button onClick={addCustom} style={sty(C.accent)}>Add</button>
            </div>
          </div>

          {selected.length >= 2 && (
            <div style={{ background: C.card, borderRadius: 12, padding: 14, marginBottom: 16, border: `1px solid ${C.border}` }}>
              <p style={{ color: C.dim, fontSize: 12, margin: "0 0 8px" }}>Your dose</p>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {selected.map((id, i) => {
                  const a = allActs.find(x => x.id === id);
                  return (
                    <span key={id} style={{ fontSize: 13, color: a ? a.color : C.dim, background: (a ? a.color : C.dim) + "15", padding: "4px 12px", borderRadius: 8 }}>
                      {i + 1}. {a ? a.icon : "✨"} {a ? a.name : id}
                    </span>
                  );
                })}
              </div>
            </div>
          )}

          <button onClick={startGen} disabled={selected.length < 2}
            style={{
              width: "100%", padding: 16,
              background: selected.length >= 2 ? `linear-gradient(135deg, ${C.accent}, ${C.brain})` : C.card,
              color: selected.length >= 2 ? "#fff" : C.dim,
              border: "none", borderRadius: 14, fontSize: 18, fontWeight: 600,
              cursor: selected.length >= 2 ? "pointer" : "not-allowed",
              opacity: selected.length >= 2 ? 1 : .4
            }}>
            Prepare My Dose →
          </button>
        </div>
      </div>
    );
  }

  // ═══ LOADING ═══
  if (view === V.LOAD) {
    const pct = loadProg.total ? ((loadProg.done / loadProg.total) * 100) : 0;
    const isError = loadProg.cur.startsWith("⚠");
    return (
      <div style={{ background: C.bg, minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "system-ui", flexDirection: "column", gap: 24 }}>
        <div style={{ fontSize: 48 }}>💊</div>
        <h2 style={{ color: C.text, margin: 0 }}>Preparing your dose</h2>
        <div style={{ width: 300, height: 6, background: C.card, borderRadius: 3, overflow: "hidden" }}>
          <div style={{ height: 6, background: `linear-gradient(90deg, ${C.accent}, ${C.success})`, width: pct > 0 ? pct + "%" : "70%", transition: "width .5s", borderRadius: 3, animation: pct === 0 ? "none" : "none" }} />
        </div>
        <p style={{ color: isError ? C.danger : C.accentL, fontSize: 15 }}>{loadProg.cur}<Dots color={C.accentL} /></p>
      </div>
    );
  }

  // ═══ SESSION ═══
  if (view === V.SESSION) {
    const actId = selected[curPhase];
    const act = allActs.find(a => a.id === actId);
    const progress = selected.length > 0 ? ((curPhase) / selected.length) * 100 : 0;
    const isLast = curPhase >= selected.length - 1;

    return (
      <div style={{ background: C.bg, minHeight: "100vh", fontFamily: "system-ui", display: "flex", flexDirection: "column" }}>
        <div style={{ height: 4, background: C.card }}>
          <div style={{ height: 4, background: `linear-gradient(90deg, ${C.accent}, ${C.success})`, width: Math.min(progress, 100) + "%", transition: "width .4s" }} />
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 20px", borderBottom: `1px solid ${C.border}` }}>
          <div style={{ display: "flex", gap: 5 }}>
            {selected.map((id, i) => {
              const a = allActs.find(x => x.id === id);
              return (
                <div key={id} style={{
                  width: 28, height: 28, borderRadius: 8,
                  background: i === curPhase ? (a ? a.color : C.dim) + "30" : i < curPhase ? C.success + "30" : C.card,
                  display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14,
                  border: `1px solid ${i === curPhase ? (a ? a.color : C.dim) : C.border}`
                }}>
                  {a ? a.icon : "✨"}
                </div>
              );
            })}
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ color: C.dim, fontSize: 13, fontVariantNumeric: "tabular-nums" }}>{fmtTime(elapsed)}</div>
            <div style={{ color: act ? act.color : C.text, fontSize: 12, fontWeight: 600 }}>
              {act ? act.name : ""} · {curPhase + 1}/{selected.length}
            </div>
          </div>
        </div>
        <div style={{ flex: 1, padding: 24, overflowY: "auto" }}>
          {renderContent(actId)}
        </div>
        <div style={{ padding: "14px 20px", borderTop: `1px solid ${C.border}`, display: "flex", justifyContent: "center" }}>
          <button onClick={nextPhase}
            style={{
              ...sty(isLast ? C.success : C.accent, true),
              padding: "14px 48px", fontSize: 16, borderRadius: 12, width: "100%", maxWidth: 360
            }}>
            {isLast ? "✓ Dose Complete" : "Next → " + ((allActs.find(a => a.id === selected[curPhase + 1]) || {}).icon || "")}
          </button>
        </div>
      </div>
    );
  }

  // ═══ REFLECT ═══
  if (view === V.REFLECT) {
    const totalSeconds = phaseTimes.reduce((s, p) => s + p.duration, 0);
    return (
      <div style={{ background: C.bg, minHeight: "100vh", padding: 24, fontFamily: "system-ui" }}>
        <div style={{ maxWidth: 480, margin: "0 auto", textAlign: "center" }}>
          <div style={{ fontSize: 56, marginBottom: 12 }}>✅</div>
          <h2 style={{ color: C.text, margin: "0 0 4px" }}>Dose Complete!</h2>
          <p style={{ color: C.dim, margin: "0 0 24px", fontSize: 14 }}>Total time: {fmtTime(totalSeconds)}</p>

          <div style={{ display: "flex", gap: 16, justifyContent: "center", margin: "0 0 28px" }}>
            <div style={{ background: C.card, borderRadius: 16, padding: "16px 28px", border: `1px solid ${C.border}` }}>
              <div style={{ fontSize: 28, fontWeight: 700, color: C.accentL }}>🔥 {streak.count}</div>
              <div style={{ color: C.dim, fontSize: 12 }}>Streak</div>
            </div>
            <div style={{ background: C.card, borderRadius: 16, padding: "16px 28px", border: `1px solid ${C.border}` }}>
              <div style={{ fontSize: 28, fontWeight: 700, color: C.success }}>{sessions}</div>
              <div style={{ color: C.dim, fontSize: 12 }}>Total</div>
            </div>
          </div>

          <div style={{ background: C.card, borderRadius: 12, padding: 16, textAlign: "left", border: `1px solid ${C.border}`, marginBottom: 20 }}>
            <p style={{ color: C.text, margin: "0 0 12px", fontSize: 14, fontWeight: 600 }}>Activity Breakdown</p>
            {phaseTimes.map((pt, i) => {
              const a = allActs.find(x => x.id === pt.id);
              const sc = scores[pt.id];
              const actColor = a ? a.color : C.dim;
              const pct = totalSeconds > 0 ? Math.round((pt.duration / totalSeconds) * 100) : 0;
              return (
                <div key={i} style={{ marginBottom: 14 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                    <span style={{ fontSize: 18 }}>{a ? a.icon : "✨"}</span>
                    <span style={{ color: C.text, fontSize: 14, flex: 1, fontWeight: 500 }}>{a ? a.name : pt.id}</span>
                    <span style={{ color: actColor, fontSize: 14, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
                      {fmtTime(pt.duration)}
                    </span>
                  </div>
                  <div style={{ height: 4, background: C.border, borderRadius: 2, marginBottom: sc ? 6 : 0 }}>
                    <div style={{ height: 4, background: actColor, borderRadius: 2, width: pct + "%", minWidth: 4 }} />
                  </div>
                  {sc && (
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4 }}>
                      <span style={{ fontSize: 11, color: C.dim }}>Score:</span>
                      {sc.isFraction ? (
                        <>
                          <span style={{
                            fontSize: 12, fontWeight: 600,
                            color: sc.got / sc.total >= 0.7 ? C.success : sc.got / sc.total >= 0.4 ? C.warn : C.danger
                          }}>
                            {sc.got}/{sc.total} {sc.label}
                          </span>
                          <span style={{ fontSize: 11, color: C.dim }}>
                            ({Math.round((sc.got / sc.total) * 100)}%)
                          </span>
                        </>
                      ) : (
                        <span style={{ fontSize: 12, fontWeight: 600, color: C.accentL }}>
                          {sc.label === "best ms" ? sc.got + "ms best" :
                           sc.label === "rounds" ? sc.got + " rounds" :
                           sc.label === "level reached" ? "level " + sc.got :
                           sc.label === "cycles" ? sc.got + " cycles" :
                           sc.got + " " + sc.label}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div style={{ marginBottom: 24 }}>
            <p style={{ color: C.text, marginBottom: 8 }}>Rate today's dose</p>
            <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
              {[1, 2, 3, 4, 5].map(n => (
                <button key={n} onClick={() => setRating(n)}
                  style={{
                    width: 48, height: 48, borderRadius: 12, fontSize: 22,
                    border: `2px solid ${n <= rating ? C.warn : C.border}`,
                    background: n <= rating ? C.warn + "20" : C.card,
                    cursor: "pointer", color: n <= rating ? C.warn : C.dim
                  }}>★</button>
              ))}
            </div>
          </div>

          <div style={{ marginBottom: 24, textAlign: "left" }}>
            <label style={{ color: C.text, fontSize: 14, display: "block", marginBottom: 8 }}>Takeaway:</label>
            <textarea value={note} onChange={e => setNote(e.target.value)}
              placeholder="What stuck? What to try next?"
              style={{ width: "100%", minHeight: 100, padding: 16, borderRadius: 12, border: `1px solid ${C.border}`, background: C.card, color: C.text, fontSize: 15, outline: "none", resize: "vertical", boxSizing: "border-box" }} />
          </div>

          <button onClick={() => {
            setView(V.HOME); setSelected([]); setNote(""); setRating(0);
            setCurPhase(0); setContent({}); setElapsed(0);
            setPhaseTimes([]); setScores({});
          }}
            style={{ width: "100%", padding: 16, background: `linear-gradient(135deg, ${C.accent}, ${C.brain})`, color: "#fff", border: "none", borderRadius: 14, fontSize: 18, fontWeight: 600, cursor: "pointer" }}>
            Done
          </button>
        </div>
      </div>
    );
  }

  return null;
}