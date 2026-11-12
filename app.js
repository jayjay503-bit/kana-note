(() => {
const L = window.LESSONS, LOOK = window.LOOKALIKE || {};
const view = document.getElementById("view");
const $ = s => view.querySelector(s);
const shuffle = a => { a = [...a]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const today = () => new Date().toLocaleDateString("sv-SE");

/* ---------- 저장 ---------- */
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
};
let stats = store.get("kn-stats", {});      // key -> {c, w, last}
let days = store.get("kn-days", []);        // 공부한 날짜 목록
let selLessons = store.get("kn-sel", null);  // 복습 범위

function record(key, ok) {
  const s = stats[key] || { c: 0, w: 0, last: 0 };
  ok ? s.c++ : s.w++; s.last = Date.now(); stats[key] = s; store.set("kn-stats", stats);
}
function markDay() { const t = today(); if (!days.includes(t)) { days.push(t); store.set("kn-days", days); } }
function streak() {
  let n = 0; const d = new Date();
  if (!days.includes(today())) d.setDate(d.getDate() - 1);
  while (days.includes(d.toLocaleDateString("sv-SE"))) { n++; d.setDate(d.getDate() - 1); }
  return n;
}
const isWeak = key => { const s = stats[key]; return s && s.w > 0 && s.w * 2 >= s.c; };

/* ---------- 학습 항목 ---------- */
function items(lessonIds) {
  const out = [];
  L.filter(l => !lessonIds || lessonIds.includes(l.id)).forEach(l => {
    l.rows.forEach(r => r.kana.forEach(([k, s]) => out.push({ key: "k:" + k, kind: "kana", jp: k, read: s, lesson: l.id })));
    (l.words || []).forEach(([w, r, m]) => out.push({ key: "w:" + w, kind: "word", jp: w, read: r, mean: m, lesson: l.id }));
    (l.phrases || []).forEach(([p, r, m]) => out.push({ key: "p:" + p, kind: "phrase", jp: p, read: r, mean: m, lesson: l.id }));
  });
  return out;
}
const allKana = () => items().filter(i => i.kind === "kana");

// 약한 것·오래 안 본 것·새 것일수록 자주 나오게
function weight(it) {
  const s = stats[it.key];
  if (!s) return 3;
  const err = (s.w + 1) / (s.c + s.w + 2);
  const daysAgo = (Date.now() - s.last) / 864e5;
  return 0.5 + err * 5 + Math.min(daysAgo, 7) * 0.3;
}
function weightedPick(pool, n) {
  const res = [], p = [...pool];
  while (res.length < n && p.length) {
    const tot = p.reduce((a, it) => a + weight(it), 0);
    let r = Math.random() * tot, i = 0;
    for (; i < p.length - 1; i++) { r -= weight(p[i]); if (r <= 0) break; }
    res.push(p.splice(i, 1)[0]);
  }
  return res;
}

/* ---------- 소리 ---------- */
const canSpeak = "speechSynthesis" in window;
let jaVoice = null;
function loadVoice() { if (!canSpeak) return; jaVoice = speechSynthesis.getVoices().find(v => /^ja/i.test(v.lang)) || null; }
if (canSpeak) { loadVoice(); speechSynthesis.onvoiceschanged = loadVoice; }
function speak(text, rate = 0.8) {
  if (!canSpeak) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "ja-JP"; u.rate = rate; if (jaVoice) u.voice = jaVoice;
  speechSynthesis.speak(u);
}
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
const toHira = s => s.replace(/[ァ-ヶ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60));
const norm = s => toHira(s).replace(/[\s。、！？!?.,ー〜~]/g, "");
const SPK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9H4zm12.5 3a4.5 4.5 0 0 0-2.5-4v8a4.5 4.5 0 0 0 2.5-4zM14 3.2v2.1a7 7 0 0 1 0 13.4v2.1a9 9 0 0 0 0-17.6z"/></svg>';

/* ---------- 문제 만들기 ---------- */
const TYPES = {
  kana: ["readKana", "findKana", "listenKana"],
  word: ["readWord", "listenWord", "meanWord"],
  phrase: ["meanWord", "listenWord"]
};
const SKILL = { readKana: "읽기", findKana: "읽기", readWord: "읽기", meanWord: "읽기", listenKana: "듣기", listenWord: "듣기" };
const SKILL_TYPES = { 읽기: ["readKana", "findKana", "readWord", "meanWord"], 듣기: ["listenKana", "listenWord"] };
const READ_RATIO = 0.8; // 종합 모드에서 읽기 문제 비율

function options(answer, pool, field, nearJp) {
  const set = new Set([answer]);
  (nearJp || []).forEach(j => { const f = pool.find(p => p.jp === j); if (f && set.size < 4) set.add(f[field]); });
  for (const p of shuffle(pool)) { if (set.size >= 4) break; if (p[field]) set.add(p[field]); }
  return shuffle([...set]);
}

function buildSession(skill, lessonIds) {
  const pool = items(lessonIds);
  let allowed = skill === "종합" ? null : SKILL_TYPES[skill];
  if (!canSpeak) allowed = (allowed || Object.keys(SKILL)).filter(t => !t.startsWith("listen"));
  const n = skill === "종합" ? 15 : 12;
  const picked = weightedPick(pool.filter(it => TYPES[it.kind].some(t => !allowed || allowed.includes(t))), n);
  // 종합 모드: 읽기 위주(약 80%), 나머지는 듣기
  return picked.map(it => {
    let opts = TYPES[it.kind].filter(t => !allowed || allowed.includes(t));
    if (!canSpeak) opts = opts.filter(t => !t.startsWith("listen"));
    if (skill === "종합") {
      const want = Math.random() < READ_RATIO ? "읽기" : "듣기";
      const sub = opts.filter(t => SKILL[t] === want);
      if (sub.length) opts = sub;
    }
    const type = opts[Math.floor(Math.random() * opts.length)];
    return { it, type };
  });
}

/* ---------- 퀴즈 진행 ---------- */
let S = null;
function startSession(skill) {
  const ids = selLessons && selLessons.length ? selLessons : null;
  const q = buildSession(skill, ids);
  if (!q.length) { view.innerHTML = `<div class="card"><p class="muted">선택한 범위에 문제가 없어요.</p></div>`; return; }
  S = { skill, queue: q, total: q.length, done: 0, right: 0, missed: new Map(), retried: new Set(), skills: { 읽기: [0, 0], 듣기: [0, 0] } };
  ask();
}

function header() {
  const pct = Math.round(S.done / S.total * 100);
  return `<div class="meta"><span>${S.skill} · ${S.done} / ${S.total}</span><span>맞힘 ${S.right}</span></div><div class="bar"><i style="width:${pct}%"></i></div>`;
}

function ask() {
  if (!S.queue.length) return finish();
  const { it, type } = S.queue[0];
  const pool = items();
  const kanaPool = allKana();
  let html = "", answer = null, kanaOpts = false, opts = [];
  const sameKind = pool.filter(p => p.kind === it.kind);
  switch (type) {
    case "readKana":
      html = `<div class="prompt"><span>${it.jp}</span></div><p class="ask">이 글자는 어떻게 읽을까요?</p>`;
      answer = it.read; opts = options(answer, kanaPool, "read", LOOK[it.jp]); break;
    case "findKana":
      html = `<div class="prompt sound"><span>${it.read}</span></div><p class="ask">이 소리에 맞는 글자는?</p>`;
      answer = it.jp; kanaOpts = true; opts = options(answer, kanaPool, "jp", LOOK[it.jp]); break;
    case "listenKana":
      html = `<div class="prompt listen"><button id="play" aria-label="다시 듣기">🔊</button></div><p class="ask">듣고 맞는 글자를 고르세요</p>`;
      answer = it.jp; kanaOpts = true; opts = options(answer, kanaPool, "jp", LOOK[it.jp]); break;
    case "readWord":
      html = `<div class="prompt word"><span>${it.jp}</span></div><p class="ask">이 단어를 읽어 보세요</p>`;
      answer = it.read; opts = options(answer, sameKind, "read"); break;
    case "meanWord":
      html = `<div class="prompt word"><span>${it.jp}</span></div><p class="ask">무슨 뜻일까요?</p>`;
      answer = it.mean; opts = options(answer, pool.filter(p => p.mean), "mean"); break;
    case "listenWord":
      html = `<div class="prompt listen"><button id="play" aria-label="다시 듣기">🔊</button></div><p class="ask">듣고 뜻을 고르세요</p>`;
      answer = it.mean; opts = options(answer, pool.filter(p => p.mean), "mean"); break;
    case "speak": return askSpeak(it);
  }
  view.innerHTML = `<div class="card">${header()}${html}
    <div class="opts">${opts.map((o, i) => `<button id="o${i}" class="${kanaOpts ? "kana" : ""}" data-v="${esc(o)}">${esc(o)}</button>`).join("")}</div>
    <p class="feedback" id="fb"></p></div>`;
  if (type.startsWith("listen")) { speak(it.jp); $("#play").onclick = () => speak(it.jp, 0.6); }
  view.querySelectorAll(".opts button").forEach(b => b.onclick = () => {
    view.querySelectorAll(".opts button").forEach(x => { x.disabled = true; if (x.dataset.v === answer) x.classList.add("ok"); });
    const ok = b.dataset.v === answer;
    if (!ok) b.classList.add("no");
    const tip = it.mean ? `${it.jp} (${it.read}) = ${it.mean}` : `${it.jp} = ${it.read}`;
    resolve(ok, ok ? "정답! " + tip : "정답은 " + tip);
    if (it.kind !== "kana" || type !== "listenKana") speak(it.jp);
  });
}

function askSpeak(it) {
  view.innerHTML = `<div class="card">${header()}
    <div class="prompt ${it.kind === "kana" ? "" : "word"}"><span>${it.jp}</span></div>
    <p class="ask">소리 내어 말해 보세요${it.mean ? ` · ${esc(it.mean)}` : ""}</p>
    ${SR ? `<button class="primary" id="mic">🎤 눌러서 말하기</button>` : ""}
    <button class="ghost" id="hear">🔊 정답 발음 듣기 (${esc(it.read)})</button>
    <p class="feedback" id="fb">${SR ? "" : "말한 뒤 발음을 듣고 스스로 채점해 주세요"}</p>
    <div class="opts" id="self"><button id="good">잘 말했어요</button><button id="again">다시 연습</button></div></div>`;
  $("#hear").onclick = () => speak(it.jp, 0.7);
  const self = ok => { view.querySelectorAll("#self button,#mic").forEach(b => b.disabled = true); resolve(ok, ok ? "좋아요!" : "뒤에서 한 번 더 나와요"); };
  $("#good").onclick = () => self(true);
  $("#again").onclick = () => self(false);
  if (SR) $("#mic").onclick = () => {
    const rec = new SR(); rec.lang = "ja-JP"; rec.interimResults = false; rec.maxAlternatives = 5;
    const fb = $("#fb"); fb.className = "feedback"; fb.textContent = "듣고 있어요…";
    rec.onresult = e => {
      const alts = [...e.results[0]].map(a => a.transcript);
      const hit = alts.some(a => norm(a).includes(norm(it.jp)));
      if (hit) { view.querySelectorAll("#self button,#mic").forEach(b => b.disabled = true); resolve(true, `정확해요! 「${esc(alts[0])}」`); }
      else { fb.textContent = `이렇게 들렸어요: 「${alts[0]}」 · 발음을 듣고 스스로 채점해 주세요`; }
    };
    rec.onerror = () => { fb.textContent = "음성 인식을 쓸 수 없어요. 말한 뒤 스스로 채점해 주세요"; };
    try { rec.start(); } catch (e) { fb.textContent = "음성 인식을 쓸 수 없어요. 말한 뒤 스스로 채점해 주세요"; }
  };
}

function resolve(ok, msg) {
  const cur = S.queue.shift();
  const fb = $("#fb"); fb.className = "feedback " + (ok ? "ok" : "no"); fb.textContent = msg;
  const first = !S.retried.has(cur.it.key + cur.type);
  if (first) { record(cur.it.key, ok); const sk = S.skills[SKILL[cur.type]]; sk[1]++; if (ok) sk[0]++; }
  S.done++;
  if (ok) { if (first) S.right++; }
  else {
    S.missed.set(cur.it.key, cur.it);
    if (first) { S.retried.add(cur.it.key + cur.type); S.total++; S.queue.splice(Math.min(3, S.queue.length), 0, cur); }
  }
  const n = document.createElement("button"); n.className = "primary"; n.id = "next";
  n.textContent = S.queue.length ? "다음" : "결과 보기"; n.onclick = ask;
  view.querySelector(".card").appendChild(n); n.focus();
}

function finish() {
  markDay();
  const first = S.total - S.retried.size;
  const missed = [...S.missed.values()];
  const sk = Object.entries(S.skills).filter(([, v]) => v[1]);
  view.innerHTML = `<div class="card"><p class="ask">한 번에 맞힌 문제</p><p class="score">${S.right} / ${first}</p>
    ${sk.length > 1 ? `<div class="stats">${sk.map(([k, v]) => `<div class="stat"><b>${v[0]}/${v[1]}</b><span>${k}</span></div>`).join("")}</div>` : ""}
    ${missed.length ? `<p class="ask">다시 볼 것</p><div class="miss">${missed.map(m => `<span>${m.jp}</span>`).join("")}</div>` : `<p class="ask">전부 한 번에 맞혔어요!</p>`}
    <p class="ask">연속 ${streak()}일째 공부 중</p>
    <button class="primary" id="again">새 문제로 한 번 더</button>
    <button class="ghost" id="home">홈으로</button></div>`;
  $("#again").onclick = () => startSession(S.skill);
  $("#home").onclick = () => go("home");
}

/* ---------- 화면 ---------- */
function lessonChips() {
  return `<div class="chips">${L.map(l => `<button class="chip" data-l="${l.id}" aria-pressed="${!selLessons || !selLessons.length || selLessons.includes(l.id)}">${l.id}강</button>`).join("")}</div>`;
}
function bindChips() {
  view.querySelectorAll(".chip[data-l]").forEach(c => c.onclick = () => {
    const on = c.getAttribute("aria-pressed") !== "true"; c.setAttribute("aria-pressed", on);
    selLessons = [...view.querySelectorAll(".chip[data-l]")].filter(x => x.getAttribute("aria-pressed") === "true").map(x => +x.dataset.l);
    if (selLessons.length === L.length) selLessons = null;
    store.set("kn-sel", selLessons);
  });
}

function home() {
  const all = items(), seen = all.filter(i => stats[i.key]);
  const tot = Object.values(stats).reduce((a, s) => [a[0] + s.c, a[1] + s.c + s.w], [0, 0]);
  const acc = tot[1] ? Math.round(tot[0] / tot[1] * 100) + "%" : "-";
  const weak = all.filter(i => isWeak(i.key)).slice(0, 12);
  const last = L[L.length - 1];
  view.innerHTML = `
    <div><div class="eyebrow">최근 수업 · ${last.id}강 ${esc(last.title)}</div><h1>가나 노트</h1></div>
    <div class="stats">
      <div class="stat"><b>${streak()}일</b><span>연속 공부</span></div>
      <div class="stat"><b>${seen.length}/${all.length}</b><span>본 항목</span></div>
      <div class="stat"><b>${acc}</b><span>정답률</span></div>
    </div>
    <div class="card"><h2>오늘의 복습</h2>
      <p class="muted">읽기 위주에 듣기를 섞은 15문제. 틀렸던 것과 오래 안 본 것이 더 자주 나와요. 매번 새로 섞여요.</p>
      <button class="primary" id="go">복습 시작</button></div>
    ${weak.length ? `<div class="card"><h2>약한 글자·단어</h2><div class="miss">${weak.map(w => `<span>${w.jp}</span>`).join("")}</div></div>` : ""}
    <div class="card"><h2>배운 수업</h2>${L.map(l => `<p class="muted">${l.id}강 · ${esc(l.title)}</p>`).join("")}</div>`;
  $("#go").onclick = () => { setTab("quiz"); startSession("종합"); };
}

function quizMenu() {
  view.innerHTML = `<div><div class="eyebrow">원하는 영역만 골라서</div><h1>퀴즈</h1></div>
    <div class="card"><h2>범위</h2>${lessonChips()}</div>
    <div class="card">
      <button class="primary" data-s="종합">종합 (읽기 + 듣기)</button>
      <button class="ghost" data-s="읽기">읽기만</button>
      ${canSpeak ? `<button class="ghost" data-s="듣기">듣기만</button>` : ""}
    </div>`;
  bindChips();
  view.querySelectorAll("[data-s]").forEach(b => b.onclick = () => startSession(b.dataset.s));
}

function chart() {
  view.innerHTML = `<div><div class="eyebrow">글자를 누르면 발음이 나와요 · 빨간 점은 약한 글자</div><h1>글자표</h1></div>
    ${L.map(l => l.rows.map(r => `<div class="card"><h2>${r.name} <span class="muted">${l.id}강</span></h2>
      <div class="cells">${r.kana.map(([k, s]) => `<div class="cell ${isWeak("k:" + k) ? "weak" : ""}" data-say="${k}" role="button" tabindex="0"><b>${k}</b><small>${s}</small></div>`).join("")}</div></div>`).join("")).join("")}`;
  view.querySelectorAll("[data-say]").forEach(c => c.onclick = () => speak(c.dataset.say));
}

function phrases() {
  view.innerHTML = `<div><div class="eyebrow">듣고 따라 말해 보세요</div><h1>표현</h1></div>
    ${L.map(l => `<div class="card"><h2>${l.id}강</h2>
      ${[...(l.phrases || []).map(p => [...p, "표현"]), ...(l.words || []).map(w => [...w, "단어"])].map(([j, r, m]) =>
        `<div class="phrase"><div><b>${j}</b><span>${esc(r)} · ${esc(m)}</span></div>${canSpeak ? `<button class="say" data-say="${j}" aria-label="${j} 듣기">${SPK}</button>` : ""}</div>`).join("")}
    </div>`).reverse().join("")}`;
  view.querySelectorAll("[data-say]").forEach(b => b.onclick = () => speak(b.dataset.say, 0.7));
}

const PAGES = { home, quiz: quizMenu, chart, phrase: phrases };
function setTab(t) { document.querySelectorAll("nav button").forEach(b => b.toggleAttribute("aria-current", b.dataset.tab === t)); document.querySelectorAll("nav button[aria-current]").forEach(b => b.setAttribute("aria-current", "page")); }
function go(t) { if (canSpeak) speechSynthesis.cancel(); setTab(t); PAGES[t](); document.querySelector("main").scrollTop = 0; }
document.querySelectorAll("nav button").forEach(b => b.onclick = () => go(b.dataset.tab));
go("home");

if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
})();
