// UI for the logic test trainer. Expects the globals DATA (bank.json) and ENGINE (engine.js); see build.mjs.
const ITEMS = DATA.items, SETS = DATA.sets;
const GEN_CACHE = new Map();
// Fixed-bank items have numeric ids; generated items have string ids "n:<family>:<seed>[:h]".
function item(id) {
  if (typeof id === 'number') return ITEMS[id];
  if (!GEN_CACHE.has(id)) GEN_CACHE.set(id, ENGINE.fromId(id));
  return GEN_CACHE.get(id);
}
function freshItem(target, avoid) {
  const it = ENGINE.generate(target, { avoid }) || ENGINE.generate(target);
  GEN_CACHE.set(it.id, it); return it.id;
}
const DIFF = { easy: ['Easy', -2.2, -0.8], medium: ['Medium', -0.8, 0.8], hard: ['Hard', 0.8, 3.0], mixed: ['Mixed', -2.2, 3.0] };
const LETTERS = 'ABCDEF', LIMIT = 120, MAX_Q = 20, MIN_Q = 12, SD_STOP = 0.35;
const KEY = 'logicTrainer.v1', HIST = 'logicTrainer.history.v1', SEEN = 'logicTrainer.seen.v1';
const IRT_A = 1.4, IRT_C = 1 / 6;
const $ = id => document.getElementById(id);
const app = $('app'), acts = $('acts'), hint = $('hint');
const svg = inner => `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">${inner}</svg>`;
const MATRIX_LABEL = 'Puzzle: a 3 by 3 grid of figures with the bottom-right figure missing';
const fmt = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
// Storage can be full or disabled; the trainer then keeps working in memory only.
const store = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } };
const forget = k => { try { localStorage.removeItem(k); } catch { /* ignore */ } };

// ---------------------------------------------------------------- persisted-state validation
// Saved state may be corrupt or come from an older version, so it is checked before use.
const isObj = v => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = v => typeof v === 'number' && Number.isFinite(v);
const isInt = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
const isSel = v => v === null || isInt(v, 0, 5);
function isItemId(id) {
  if (typeof id === 'number') return isInt(id, 0, ITEMS.length - 1);
  if (typeof id !== 'string') return false;
  const [tag, fam, seed, h, ...rest] = id.split(':');
  if (tag !== 'n' || !ENGINE.FAMILIES.includes(fam) || !/^\d+$/.test(seed ?? '') || (h !== undefined && h !== 'h') || rest.length) return false;
  const it = item(id);
  return !!it && Array.isArray(it.cells) && Array.isArray(it.options);
}
function validRun(s) {
  const { order, resp, ans, times } = s;
  return ['new', 'bank'].includes(s.src) && [order, resp, ans, times].every(Array.isArray)
    && [resp, ans, times].every(a => a.length === order.length)
    && order.every(isItemId) && resp.every(r => r === 0 || r === 1) && ans.every(isSel) && times.every(isNum);
}
const validResult = s => validRun(s) && s.order.length > 0 && isObj(s.est) && isNum(s.est.theta) && isNum(s.est.sd);
function validState(s) {
  if (!isObj(s)) return false;
  switch (s.screen) {
    case 'home': return true;
    case 'timed': return validRun(s) && isItemId(s.cur) && isSel(s.sel) && isNum(s.remaining)
      && typeof s.paused === 'boolean' && (s.deadline == null || isNum(s.deadline));
    case 'result': return validResult(s);
    case 'review': return validResult(s) && isInt(s.rev, 0, s.order.length - 1);
    case 'practice': {
      const list = s.set === 'gen' ? s.list : isInt(s.set, 0, SETS.length - 1) ? SETS[s.set].items : null;
      return Array.isArray(list) && list.length > 0 && list.every(isItemId) && isInt(s.idx, 0, list.length - 1)
        && isSel(s.sel) && [null, 'ok', 'bad', 'sol'].includes(s.result) && (s.set !== 'gen' || Object.hasOwn(DIFF, s.diff));
    }
    default: return false;
  }
}
const validHist = h => isObj(h) && isNum(h.date) && isNum(h.theta) && isNum(h.sd) && h.sd >= 0
  && isInt(h.n, 1, MAX_Q) && isInt(h.correct, 0, h.n) && isNum(h.time) && h.time >= 0;
const loadHist = () => { const h = load(HIST, []); return Array.isArray(h) ? h.filter(validHist) : []; };
const loadSeen = () => { const s = load(SEEN, []); return Array.isArray(s) ? s.filter(id => isInt(id, 0, ITEMS.length - 1)) : []; };

let S = load(KEY, null);
if (!validState(S)) S = { screen: 'home' };
if (S.screen === 'timed') {
  S.remaining = Math.min(LIMIT, Math.max(0, S.remaining));
  if (!S.paused && !isNum(S.deadline)) S.deadline = Date.now() + S.remaining * 1000;
}
const save = () => store(KEY, S);
// The question clock runs on a wall-clock deadline, so throttled timers in background tabs can't stretch it.
const remainingNow = () => S.paused || !isNum(S.deadline) ? S.remaining : Math.max(0, (S.deadline - Date.now()) / 1000);

// ---------------------------------------------------------------- scoring model (3PL IRT, guessing = 1/6)
const P = (t, b) => IRT_C + (1 - IRT_C) / (1 + Math.exp(-IRT_A * (t - b)));
const info = (t, b) => { const p = P(t, b); return IRT_A ** 2 * ((1 - p) / p) * ((p - IRT_C) / (1 - IRT_C)) ** 2; };
const GRID = Array.from({ length: 161 }, (_, i) => -4 + i * 0.05);
function estimate(ids, resp) {
  const ll = GRID.map(t => ids.reduce((l, id, i) => { const p = P(t, item(id).b); return l + Math.log(resp[i] ? p : 1 - p); }, -t * t / 2));
  const m = Math.max(...ll), w = ll.map(x => Math.exp(x - m)), sum = w.reduce((a, b) => a + b, 0);
  const theta = GRID.reduce((a, t, i) => a + t * w[i], 0) / sum;
  const sd = Math.sqrt(GRID.reduce((a, t, i) => a + (t - theta) ** 2 * w[i], 0) / sum);
  return { theta, sd };
}
const stenRaw = t => 2 * t + 5.5;
const sten = t => Math.min(10, Math.max(1, Math.round(stenRaw(t))));
function Phi(x) {
  const t = 1 / (1 + 0.2316419 * Math.abs(x)), d = 0.3989423 * Math.exp(-x * x / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return x > 0 ? 1 - p : p;
}
const ordinal = n => { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };
const level = id => Math.min(10, Math.max(1, Math.round(stenRaw(item(id).b))));

function pickNext() {
  const t = S.order.length ? estimate(S.order, S.resp).theta : -0.5;
  if (S.src === 'new') {
    // Generated run: target the current ability estimate, never repeat a family back-to-back, max 4 per family.
    const fams = S.order.map(id => item(id).fam), count = f => fams.filter(x => x === f).length;
    const avoid = ENGINE.FAMILIES.filter(f => f === fams[fams.length - 1] || count(f) >= 4);
    const target = Math.max(-2.4, Math.min(3.0, t + (Math.random() - 0.5) * 0.5));
    return freshItem(target, avoid);
  }
  const used = new Set(S.order), fams = new Set(S.order.map(id => ITEMS[id].fam)), seen = new Set(loadSeen());
  const cand = ITEMS.map((it, id) => ({ id, v: info(t, it.b) * (seen.has(id) ? 0.5 : 1) }))
    .filter(c => !used.has(c.id) && !fams.has(ITEMS[c.id].fam))
    .sort((a, b) => b.v - a.v).slice(0, 3);
  return cand.length ? cand[Math.floor(Math.random() * cand.length)].id : null;
}
function markSeen(id) { if (typeof id !== 'number') return; const s = new Set(loadSeen()); s.add(id); store(SEEN, [...s]); }

// ---------------------------------------------------------------- navigation
function goHome(ask = true) {
  if (ask && S.screen === 'timed' && !confirm('Abandon this timed run? It will not be scored.')) return;
  S = { screen: 'home' }; save(); render();
}
function startTimed(ask = false, src = S.src || 'new') {
  if (ask && S.screen === 'timed' && !confirm('Restart the timed run from the beginning?')) return;
  S = { screen: 'timed', src, order: [], resp: [], ans: [], times: [], sel: null, remaining: LIMIT, deadline: Date.now() + LIMIT * 1000, paused: false };
  S.cur = pickNext(); markSeen(S.cur); save(); render();
}
function genPractice(diff, avoid = []) { const [, lo, hi] = DIFF[diff]; return freshItem(lo + Math.random() * (hi - lo), avoid); }
function startPractice(set, diff = S.diff) {
  S = { screen: 'practice', set, idx: 0, sel: null, result: null };
  if (set === 'gen') { S.diff = diff; S.list = [genPractice(diff)]; }
  save(); render();
}
const pList = () => S.set === 'gen' ? S.list : SETS[S.set].items;

function bar(buttons) {
  acts.innerHTML = buttons.map(([id, label, cls]) => `<button class="btn small ${cls || 'ghost'}" id="${id}">${label}</button>`).join('');
}

// Every render rebuilds the DOM, so keyboard focus is carried over to the equivalent control.
const focusKeyOf = el => !el || el === document.body ? null
  : el.id ? `#${el.id}` : el.dataset && el.dataset.i !== undefined ? `.opt[data-i="${el.dataset.i}"]` : null;
function restoreFocus(key) {
  if (!key) return;
  const el = document.querySelector(key);
  const target = el && !el.disabled ? el : app.querySelector('button.opt');
  if (target) target.focus();
}

function render() {
  hint.textContent = '';
  const screenFn = ({ home, timed, result, review, practice })[S.screen];
  if (!screenFn) return goHome(false);
  const focusKey = focusKeyOf(document.activeElement);
  try { screenFn(); } catch (e) {
    if (S.screen === 'home') throw e;
    console.error('Resetting the trainer after a render error', e);
    S = { screen: 'home' }; save(); return render();
  }
  const on = (id, fn) => { const el = $(id); if (el) el.onclick = fn; };
  on('b-home', () => goHome());
  on('b-restart-t', () => startTimed(true));
  on('b-new-t', () => startTimed());
  on('b-restart-p', () => startPractice(S.set));
  restoreFocus(focusKey);
}

function optButton(o, i, cls, pressed, note = '') {
  return `<button type="button" class="opt ${cls}" data-i="${i}" aria-label="Option ${LETTERS[i]}${note}" aria-pressed="${pressed}">`
    + `${svg(o)}<span class="lab" aria-hidden="true">${LETTERS[i]}</span></button>`;
}

// ---------------------------------------------------------------- home
function home() {
  bar([]);
  const hist = loadHist();
  const histHtml = hist.length ? `<div class="card"><h2>Previous timed runs</h2>
    <table><tr><th>Date</th><th>Questions</th><th>Score (1–10)</th><th>Est. percentile</th><th>Correct</th><th>Time</th></tr>
    ${hist.slice().reverse().slice(0, 15).map(h => `<tr><td>${esc(new Date(h.date).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }))}</td>
      <td>${h.src === 'new' ? 'New' : 'Fixed bank'}</td>
      <td><b>${sten(h.theta)}</b> <span class="muted">(${sten(h.theta - h.sd)}–${sten(h.theta + h.sd)})</span></td>
      <td>${Math.min(99, Math.max(1, Math.round(Phi(h.theta) * 100)))}%</td><td>${h.correct} / ${h.n}</td><td>${fmt(h.time)}</td></tr>`).join('')}</table>
    <p><button class="link" id="clear-hist">Clear history</button></p></div>` : '';
  app.innerHTML = `
    <div class="grid2">
      <div class="card"><h2>⏱ Timed test (scored)</h2>
        <div class="grow"><p>Simulates an adaptive matrix-reasoning logic test:</p><ul>
          <li><b>Brand-new questions every run</b>, generated on the spot from ${ENGINE.FAMILIES.length} puzzle types, so you can't have seen them before.</li>
          <li><b>Adaptive</b>: a correct answer leads to a harder question, a wrong one to an easier one.</li>
          <li>${MAX_Q} questions, <b>2 minutes each</b>. A timeout counts as wrong.</li>
          <li>You can pause, but you can't go back.</li>
          <li>At the end you get an estimated <b>1–10 score</b> on the bell curve and a full review.</li></ul></div>
        <button class="btn" id="start-t">Start timed test</button>
        <p class="alt-start"><button class="link" id="start-tb">or use the fixed 60-question bank</button></p></div>
      <div class="card"><h2>🧩 Practice (no timer)</h2>
        <div class="grow"><p>Check each answer and get an explanation. Move freely between questions.</p>
        <div class="sub">Endless: new questions</div>
        <div class="diffrow">${Object.entries(DIFF).map(([k, [name]]) => `<button class="btn ghost" data-diff="${k}">${name}</button>`).join('')}</div>
        <div class="sub">Fixed sets</div>
        ${SETS.map((s, i) => `<button class="setbtn" data-set="${i}"><b>${esc(s.name)}</b><span>${esc(s.desc)}</span></button>`).join('')}</div></div>
    </div>${histHtml}`;
  $('start-t').onclick = () => startTimed(false, 'new');
  $('start-tb').onclick = () => startTimed(false, 'bank');
  app.querySelectorAll('[data-diff]').forEach(b => b.onclick = () => startPractice('gen', b.dataset.diff));
  app.querySelectorAll('.setbtn').forEach(b => b.onclick = () => startPractice(+b.dataset.set));
  const ch = $('clear-hist');
  if (ch) ch.onclick = () => { if (confirm('Clear all previous runs and the "already seen" memory?')) { forget(HIST); forget(SEEN); render(); } };
}

// ---------------------------------------------------------------- timed
function timed() {
  bar([['b-restart-t', '↺ Restart'], ['b-home', 'Home']]);
  const q = item(S.cur), n = S.order.length + 1;
  const cells = q.cells.map(c => `<div class="cell">${svg(c)}</div>`).join('') + `<div class="cell missing">?</div>`;
  const opts = q.options.map((o, i) => optButton(o, i, S.sel === i ? 'sel' : '', S.sel === i)).join('');
  app.innerHTML = `<div class="card ${S.paused ? 'paused' : ''}">
    <div class="top"><span class="qnum">Question ${n} / ${MAX_Q}</span>
      <div class="timer"><div class="bar" id="tbar"><div id="fill"></div></div><span class="clock" id="clock"></span></div></div>
    <div class="overlay">Paused. The question is hidden.</div>
    <div class="stage"><div class="matrix" role="img" aria-label="${MATRIX_LABEL}">${cells}</div>
      <p class="prompt">Which option completes the pattern?</p><div class="opts">${opts}</div></div>
    <div class="actions"><button class="btn ghost" id="pause">${S.paused ? 'Resume' : 'Pause'}</button>
      <button class="btn" id="next" ${S.sel === null || S.paused ? 'disabled' : ''}>Submit</button></div></div>`;
  hint.textContent = 'A–F select · Enter submit · P pause';
  app.querySelectorAll('.opt').forEach(el => el.onclick = () => tSelect(+el.dataset.i));
  $('pause').onclick = togglePause;
  $('next').onclick = () => submit(false);
  tickUI();
}
function tSelect(i) { if (S.paused) return; S.sel = i; save(); render(); }
function togglePause() {
  if (S.paused) { S.paused = false; S.deadline = Date.now() + S.remaining * 1000; }
  else { S.remaining = remainingNow(); S.paused = true; S.deadline = null; }
  save(); render();
}
function submit(timeout) {
  if (!timeout && S.sel === null) return;
  const it = item(S.cur);
  S.order.push(S.cur); S.resp.push(!timeout && S.sel === it.correct ? 1 : 0);
  S.ans.push(timeout ? null : S.sel); S.times.push(LIMIT - (timeout ? 0 : remainingNow()));
  S.sel = null; S.paused = false; S.remaining = LIMIT; S.deadline = Date.now() + LIMIT * 1000;
  const est = estimate(S.order, S.resp), n = S.order.length;
  const next = n >= MAX_Q || (n >= MIN_Q && est.sd < SD_STOP) ? null : pickNext();
  if (next === null) {
    S.screen = 'result';
    S.est = est; S.date = Date.now();
    const time = S.times.reduce((a, b) => a + b, 0);
    const hist = loadHist();
    hist.push({ date: S.date, src: S.src || 'bank', theta: est.theta, sd: est.sd, n, correct: S.resp.reduce((a, b) => a + b, 0), time });
    store(HIST, hist);
  } else { S.cur = next; markSeen(next); }
  save(); render();
}
function tickUI() {
  const fill = $('fill'), clock = $('clock'), tb = $('tbar');
  if (!fill) return;
  const left = remainingNow();
  fill.style.transform = `scaleX(${left / LIMIT})`;
  clock.textContent = fmt(Math.ceil(left));
  tb.classList.toggle('low', left <= 20);
}
setInterval(() => {
  if (S.screen !== 'timed' || S.paused) return;
  const left = remainingNow(), prev = Math.ceil(S.remaining);
  if (left <= 0) { S.remaining = 0; submit(true); return; }
  S.remaining = left;
  if (Math.ceil(left) !== prev) save();
  tickUI();
}, 250);

// ---------------------------------------------------------------- result
const STEN_PCT = [2.3, 4.4, 9.2, 15.0, 19.1, 19.1, 15.0, 9.2, 4.4, 2.3];
function bellChart(theta, sd) {
  const W = 680, H = 230, x0 = 30, x1 = W - 30, base = 170, top = 28;
  const X = s => x0 + (Math.min(10.5, Math.max(0.5, s)) - 0.5) / 10 * (x1 - x0);
  const Y = s => base - (base - top) * Math.exp(-(((s - 5.5) / 2) ** 2) / 2);
  const curve = (a, b) => { const pts = []; for (let s = a; s <= b + 1e-9; s += 0.05) pts.push(`${X(s).toFixed(1)},${Y(s).toFixed(1)}`); return pts; };
  const lo = Math.max(0.5, stenRaw(theta - sd)), hi = Math.min(10.5, stenRaw(theta + sd)), me = Math.min(10.5, Math.max(0.5, stenRaw(theta)));
  const you = sten(theta);
  let g = '';
  g += `<polygon points="${X(lo)},${base} ${curve(lo, hi).join(' ')} ${X(hi)},${base}" fill="rgba(63,81,214,.22)"/>`;
  for (let k = 1; k <= 9; k++) g += `<line x1="${X(k + 0.5)}" y1="${base}" x2="${X(k + 0.5)}" y2="${Y(k + 0.5)}" stroke="#d4d6e4" stroke-dasharray="3 3"/>`;
  g += `<polyline points="${curve(0.5, 10.5).join(' ')}" fill="none" stroke="#1b1b1f" stroke-width="2"/>`;
  g += `<line x1="${x0}" y1="${base}" x2="${x1}" y2="${base}" stroke="#1b1b1f" stroke-width="1.5"/>`;
  for (let k = 1; k <= 10; k++) {
    g += `<text x="${X(k)}" y="${base + 20}" text-anchor="middle" font-size="14" font-weight="${k === you ? 800 : 500}" fill="${k === you ? '#3f51d6' : '#33333b'}">${k}</text>`;
    g += `<text x="${X(k)}" y="${base + 38}" text-anchor="middle" font-size="10.5" fill="#8a8a95">${STEN_PCT[k - 1]}%</text>`;
  }
  g += `<line x1="${X(me)}" y1="${base}" x2="${X(me)}" y2="${top - 8}" stroke="#3f51d6" stroke-width="2.5"/>`;
  g += `<circle cx="${X(me)}" cy="${Y(me)}" r="5" fill="#3f51d6"/>`;
  g += `<text x="${X(me)}" y="${top - 13}" text-anchor="middle" font-size="13" font-weight="700" fill="#3f51d6">You</text>`;
  return `<svg class="chart" role="img" aria-label="Bell curve of scores 1 to 10 with your estimated score of ${you} marked" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">${g}</svg>`;
}
function questionChart(final) {
  const n = S.order.length, W = 680, H = 250, x0 = 46, x1 = W - 20, y0 = 20, y1 = H - 36;
  const X = i => n === 1 ? (x0 + x1) / 2 : x0 + i * (x1 - x0) / (n - 1);
  const Y = l => y1 - (l - 1) * (y1 - y0) / 9;
  let g = `<rect x="${x0 - 14}" y="${Y(final + 0.5)}" width="${x1 - x0 + 28}" height="${Y(final - 0.5) - Y(final + 0.5)}" fill="#e9ebfb"/>`;
  for (let l = 1; l <= 10; l++) g += `<line x1="${x0 - 14}" y1="${Y(l)}" x2="${x1 + 10}" y2="${Y(l)}" stroke="#ececf1"/><text x="${x0 - 22}" y="${Y(l) + 4}" text-anchor="end" font-size="11" fill="#8a8a95">${l}</text>`;
  g += `<polyline points="${S.order.map((id, i) => `${X(i)},${Y(level(id))}`).join(' ')}" fill="none" stroke="#c9cbd8" stroke-width="1.5"/>`;
  S.order.forEach((id, i) => {
    g += `<circle cx="${X(i)}" cy="${Y(level(id))}" r="7" fill="${S.resp[i] ? '#1f8a4c' : '#c23b35'}"/>`;
    g += `<text x="${X(i)}" y="${y1 + 20}" text-anchor="middle" font-size="10.5" fill="#8a8a95">${i + 1}</text>`;
  });
  g += `<text x="12" y="${(y0 + y1) / 2}" font-size="11" fill="#8a8a95" transform="rotate(-90 12 ${(y0 + y1) / 2})" text-anchor="middle">Question difficulty</text>`;
  return `<svg class="chart" role="img" aria-label="Difficulty level of each question, green if answered correctly and red if not" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">${g}</svg>`;
}
function result() {
  bar([['b-new-t', '↺ New timed run', ' '], ['b-home', 'Home']]);
  const { theta, sd } = S.est, n = S.order.length, correct = S.resp.reduce((a, b) => a + b, 0);
  const time = S.times.reduce((a, b) => a + b, 0), timeouts = S.ans.filter(a => a === null).length;
  const pct = Math.min(99, Math.max(1, Math.round(Phi(theta) * 100))), s = sten(theta), lo = sten(theta - sd), hi = sten(theta + sd);
  const rows = S.order.map((id, i) => {
    const a = S.ans[i], ok = S.resp[i];
    return `<tr><td>${i + 1}</td><td>${level(id)}</td><td>${a === null ? '— (timeout)' : LETTERS[a]}</td><td>${LETTERS[item(id).correct]}</td>
      <td class="${ok ? 'ok' : 'bad'}">${ok ? '✓' : '✗'}</td><td>${fmt(S.times[i])}</td><td><button class="link" data-rev="${i}">Review</button></td></tr>`;
  }).join('');
  app.innerHTML = `<div class="card"><h1>Your estimated result</h1>
      <div class="score"><div class="big">${s}<small> / 10</small></div>
        <div><p class="flush"><b>Estimated ${ordinal(pct)} percentile</b> on the trainer's bell curve. This is a model estimate, not a comparison with measured test-takers.</p>
        <p class="muted tight">Likely range: ${lo === hi ? lo : `${lo}–${hi}`} (the shaded band shows ±1 standard error).</p></div></div>
      ${bellChart(theta, sd)}
      <div class="stats"><div class="stat"><b>${correct} / ${n}</b><span>correct</span></div>
        <div class="stat"><b>${fmt(time)}</b><span>total time</span></div>
        <div class="stat"><b>${fmt(time / n)}</b><span>avg per question</span></div>
        <div class="stat"><b>${timeouts}</b><span>timeouts</span></div></div>
      <div class="note">This is an estimate. ${S.src === 'new'
        ? 'All questions were newly generated, so earlier practice did not inflate the score. Their difficulty levels are computed from the rules involved (number of changing features, rule type), not measured on real test-takers.'
        : 'The question difficulties are my own judgement, not calibrated against real test-takers. Questions you have seen before make the score look better than it is.'} Read it as a rough band, not an exact number. As in adaptive tests, the score depends on <i>how hard</i> the questions you got right were, not just on how many you got right.</div></div>
    <div class="card"><h2>Questions you got</h2>
      <p class="muted flush-top">Green = correct, red = wrong. The height of each dot is the question's difficulty level; the shaded band is your score.</p>
      ${questionChart(s)}
      <table><tr><th>#</th><th>Level</th><th>Yours</th><th>Correct</th><th></th><th>Time</th><th></th></tr>${rows}</table></div>`;
  app.querySelectorAll('[data-rev]').forEach(b => b.onclick = () => { S.screen = 'review'; S.rev = +b.dataset.rev; save(); render(); });
}

// ---------------------------------------------------------------- review (after timed run)
function review() {
  bar([['b-back', '← Back to results'], ['b-home', 'Home']]);
  $('b-back').onclick = () => { S.screen = 'result'; save(); render(); };
  const i = S.rev, id = S.order[i], q = item(id), a = S.ans[i], ok = S.resp[i];
  const cells = q.cells.map(c => `<div class="cell">${svg(c)}</div>`).join('') + `<div class="cell missing solved">${svg(q.options[q.correct])}</div>`;
  const opts = q.options.map((o, k) => {
    const note = k === q.correct ? ', correct answer' : k === a ? ', your answer' : '';
    return `<div class="opt ${k === q.correct ? 'ok' : k === a ? 'bad' : ''}" role="img" aria-label="Option ${LETTERS[k]}${note}">${svg(o)}<span class="lab" aria-hidden="true">${LETTERS[k]}</span></div>`;
  }).join('');
  const why = ok ? '' : a === null ? '<p class="why">You ran out of time on this one.</p>'
    : `<p class="why"><b class="inline">Your answer ${LETTERS[a]}:</b> ${esc(q.reasons[a])}</p>`;
  app.innerHTML = `<div class="card">
    <div class="top"><span class="qnum">Question ${i + 1} / ${S.order.length} <span class="muted">· level ${level(id)}</span></span></div>
    <div class="matrix" role="img" aria-label="${MATRIX_LABEL}, shown solved">${cells}</div><div class="opts">${opts}</div>
    <div class="feedback ${ok ? 'ok' : 'bad'}"><b>${ok ? '✓ Correct' : `✗ ${a === null ? 'Timed out' : 'Wrong'}. The answer is ${LETTERS[q.correct]}.`}</b>${esc(q.rule)}${why}</div>
    <div class="actions"><button class="btn ghost" id="rp" ${i === 0 ? 'disabled' : ''}>← Previous</button>
      <button class="btn ghost" id="rn" ${i === S.order.length - 1 ? 'disabled' : ''}>Next →</button></div></div>`;
  hint.textContent = '← → previous / next · Esc back to results';
  $('rp').onclick = () => revGo(-1); $('rn').onclick = () => revGo(1);
}
function revGo(d) { const j = S.rev + d; if (j < 0 || j >= S.order.length) return; S.rev = j; save(); render(); }

// ---------------------------------------------------------------- practice
function practice() {
  const gen = S.set === 'gen', list = pList(), id = list[S.idx], q = item(id), r = S.result;
  bar([['b-restart-p', gen ? '↺ New questions' : '↺ Restart set'], ['b-home', 'Home']]);
  const name = gen ? `Endless practice · ${DIFF[S.diff][0]}` : SETS[S.set].name;
  const solved = r === 'ok' || r === 'sol';
  const cells = q.cells.map(c => `<div class="cell">${svg(c)}</div>`).join('') +
    (solved ? `<div class="cell missing solved">${svg(q.options[q.correct])}</div>` : `<div class="cell missing">?</div>`);
  const opts = q.options.map((o, i) => {
    const cls = solved && i === q.correct ? 'ok' : r === 'bad' && i === S.sel ? 'bad' : i === S.sel ? 'sel' : '';
    const note = cls === 'ok' ? ', correct answer' : cls === 'bad' ? ', incorrect' : '';
    return optButton(o, i, cls, i === S.sel, note);
  }).join('');
  let fb = '';
  if (r === 'ok') fb = `<div class="feedback ok" role="status"><b>✓ Correct, ${LETTERS[S.sel]} is right.</b>${esc(q.rule)}</div>`;
  else if (r === 'bad') fb = `<div class="feedback bad" role="status"><b>✗ ${LETTERS[S.sel]} is not correct.</b>${esc(q.reasons[S.sel])} Pick another option and check again.<br><button class="link" id="sol">Show solution</button></div>`;
  else if (r === 'sol') fb = `<div class="feedback sol" role="status"><b>Solution: ${LETTERS[q.correct]}</b>${esc(q.rule)}</div>`;
  app.innerHTML = `<div class="card">
    <div class="top"><span class="qnum">Question ${S.idx + 1}${gen ? '' : ` / ${list.length}`}</span><span class="muted">${esc(name)} · level ${level(id)}</span></div>
    <div class="matrix" role="img" aria-label="${MATRIX_LABEL}${solved ? ', shown solved' : ''}">${cells}</div>
    <p class="prompt">Which option completes the pattern?</p><div class="opts">${opts}</div>${fb}
    <div class="actions"><button class="btn ghost" id="prev" ${S.idx === 0 ? 'disabled' : ''}>← Previous</button>
      <button class="btn" id="check" ${S.sel === null || r ? 'disabled' : ''}>Check answer</button>
      <button class="btn ghost" id="nextq" ${!gen && S.idx === list.length - 1 ? 'disabled' : ''}>Next →</button></div></div>`;
  hint.textContent = 'A–F select · Enter check · ← → previous / next';
  app.querySelectorAll('.opt').forEach(el => el.onclick = () => pSelect(+el.dataset.i));
  $('prev').onclick = () => pGo(-1); $('nextq').onclick = () => pGo(1); $('check').onclick = pCheck;
  if ($('sol')) $('sol').onclick = () => { S.result = 'sol'; save(); render(); };
}
function pGo(d) {
  const list = pList(), j = S.idx + d;
  if (j < 0) return;
  if (j >= list.length) {
    if (S.set !== 'gen') return;
    list.push(genPractice(S.diff, [item(list[list.length - 1]).fam]));
  }
  S.idx = j; S.sel = null; S.result = null; save(); render();
}
function pSelect(i) { if (S.result === 'ok' || S.result === 'sol') return; S.sel = i; S.result = null; save(); render(); }
function pCheck() {
  if (S.sel === null || S.result) return;
  S.result = S.sel === item(pList()[S.idx]).correct ? 'ok' : 'bad'; save(); render();
}

// ---------------------------------------------------------------- keyboard
document.addEventListener('keydown', e => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const k = e.key.length === 1 ? e.key.toUpperCase() : e.key;
  // Enter on a focused button activates that button natively; don't also treat it as submit/check.
  if (k === 'Enter' && e.target instanceof Element && e.target.closest('button')) return;
  const letter = k.length === 1 && LETTERS.includes(k) ? LETTERS.indexOf(k) : -1;
  if (S.screen === 'timed') {
    if (k === 'P') togglePause(); else if (k === 'Enter') submit(false); else if (letter >= 0) tSelect(letter);
  } else if (S.screen === 'practice') {
    if (k === 'ArrowLeft') pGo(-1); else if (k === 'ArrowRight') pGo(1); else if (k === 'Enter') pCheck(); else if (letter >= 0) pSelect(letter);
  } else if (S.screen === 'review') {
    if (k === 'ArrowLeft') revGo(-1); else if (k === 'ArrowRight') revGo(1); else if (k === 'Escape') { S.screen = 'result'; save(); render(); }
  }
});
$('brand').onclick = () => goHome();
render();
