// Procedural 3x3 matrix-puzzle generator. Every item is fully determined by (family, seed).
// Quality gates per item: the intended answer must follow from a library of common rule interpretations,
// no distractor may be explainable by any of those interpretations, all six options must look different,
// and the options are built as a 3x2 attribute design so "pick the most typical option" gives no advantage.
const ENGINE = (() => {
  const INK = '#1b1b1f', SW = 2.5, GUIDE = '#dcdce4';
  const FILLV = { white: '#ffffff', grey: '#9c9ca3', black: INK };
  const nf = x => { const s = (Math.round(x * 10) / 10).toFixed(1); return s.endsWith('.0') ? s.slice(0, -2) : s; };

  function Rand(seed, hard = false) {
    let a = seed >>> 0;
    const f = () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    const R = {
      f, hard, int: (lo, hi) => lo + Math.floor(f() * (hi - lo + 1)), pick: arr => arr[Math.floor(f() * arr.length)],
      chance: p => f() < p,
      shuffle: arr => { const b = arr.slice(); for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(f() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; },
      weighted: obj => { const e = Object.entries(obj), tot = e.reduce((s, [, w]) => s + w, 0); let x = f() * tot; for (const [k, w] of e) { if ((x -= w) < 0) return k; } return e[e.length - 1][0]; },
    };
    R.sample = (arr, k) => R.shuffle(arr).slice(0, k);
    return R;
  }

  // ------------------------------------------------------------ drawing
  const reg = (cx, cy, r, k, start) => Array.from({ length: k }, (_, i) => { const a = (start + 360 * i / k) * Math.PI / 180; return [cx + r * Math.cos(a), cy + r * Math.sin(a)]; });
  const pts = p => p.map(([x, y]) => `${nf(x)},${nf(y)}`).join(' ');
  function shape(kind, cx, cy, r, fill = 'white', sw = SW) {
    const st = `fill="${FILLV[fill] || fill}" stroke="${INK}" stroke-width="${sw}" stroke-linejoin="round"`;
    if (kind === 'circle') return `<circle cx="${nf(cx)}" cy="${nf(cy)}" r="${nf(r)}" ${st}/>`;
    let p;
    if (kind === 'square') p = reg(cx, cy, r * 1.2, 4, -45);
    else if (kind === 'diamond') p = reg(cx, cy, r * 1.3, 4, -90);
    else if (kind === 'triangle') p = reg(cx, cy + r * 0.18, r * 1.3, 3, -90);
    else if (kind === 'pentagon') p = reg(cx, cy + r * 0.05, r * 1.1, 5, -90);
    else if (kind === 'hexagon') p = reg(cx, cy, r * 1.08, 6, -90);
    else if (kind === 'heptagon') p = reg(cx, cy + r * 0.03, r * 1.08, 7, -90);
    else if (kind === 'octagon') p = reg(cx, cy, r * 1.08, 8, -90 + 22.5);
    else if (kind === 'star') p = Array.from({ length: 10 }, (_, i) => { const rr = i % 2 ? r * 0.52 : r * 1.25, a = (-90 + 36 * i) * Math.PI / 180; return [cx + rr * Math.cos(a), cy + rr * Math.sin(a)]; });
    else if (kind === 'cross') { const w = r * 0.38, L = r * 1.1; p = [[cx - w, cy - L], [cx + w, cy - L], [cx + w, cy - w], [cx + L, cy - w], [cx + L, cy + w], [cx + w, cy + w], [cx + w, cy + L], [cx - w, cy + L], [cx - w, cy + w], [cx - L, cy + w], [cx - L, cy - w], [cx - w, cy - w]]; }
    else throw new Error(kind);
    return `<polygon points="${pts(p)}" ${st}/>`;
  }
  const line = (x1, y1, x2, y2, sw = SW, color = INK) => `<line x1="${nf(x1)}" y1="${nf(y1)}" x2="${nf(x2)}" y2="${nf(y2)}" stroke="${color}" stroke-width="${nf(sw)}" stroke-linecap="round"/>`;
  const LAYOUT = {
    1: [[50, 50]], 2: [[32, 50], [68, 50]], 3: [[50, 30], [30, 68], [70, 68]], 4: [[32, 32], [68, 32], [32, 68], [68, 68]],
    5: [[27, 27], [73, 27], [50, 50], [27, 73], [73, 73]], 6: [[25, 36], [50, 36], [75, 36], [25, 64], [50, 64], [75, 64]],
    7: [[25, 24], [50, 24], [75, 24], [25, 50], [50, 50], [75, 50], [50, 76]],
    8: [[25, 24], [50, 24], [75, 24], [25, 50], [50, 50], [75, 50], [37, 76], [63, 76]],
    9: [[25, 25], [50, 25], [75, 25], [25, 50], [50, 50], [75, 50], [25, 75], [50, 75], [75, 75]],
  };
  const countR = k => k <= 2 ? 11 : k <= 4 ? 10 : k <= 6 ? 8.5 : 7.5;

  // ------------------------------------------------------------ helpers
  const G = f => [0, 1, 2].map(r => [0, 1, 2].map(c => f(r, c)));
  const CELLS = [[0, 0], [0, 1], [0, 2], [1, 0], [1, 1], [1, 2], [2, 0], [2, 1]];
  const cap = s => s[0].toUpperCase() + s.slice(1);
  const ROWN = ['row 1', 'row 2', 'row 3'], COLN = ['column 1', 'column 2', 'column 3'];
  const andList = a => a.length < 2 ? a.join('') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1];
  const popc = m => { let k = 0; while (m) { k += m & 1; m >>>= 1; } return k; };
  const bits = (m, n) => Array.from({ length: n }, (_, i) => i).filter(i => m >> i & 1);

  // Every value the given 8 cells could reasonably lead to, under common rule interpretations.
  function predict(v, { mod = 0, ordinal = false, arith = false } = {}) {
    const N = x => mod ? ((x % mod) + mod) % mod : x;
    const T = G((r, c) => v[c][r]);
    const out = new Set();
    for (const m of [v, T]) {
      if (m[0][0] === m[0][1] && m[0][1] === m[0][2] && m[1][0] === m[1][1] && m[1][1] === m[1][2] && m[2][0] === m[2][1]) out.add(m[2][0]);
      const s0 = new Set(m[0]), s1 = new Set(m[1]);
      if (s0.size === 3 && [...s0].every(x => s1.has(x)) && s1.size === 3 && m[2][0] !== m[2][1] && s0.has(m[2][0]) && s0.has(m[2][1]))
        out.add([...s0].find(x => x !== m[2][0] && x !== m[2][1]));
      if (ordinal) {
        const ap = r => N(m[r][2] - m[r][1]) === N(m[r][1] - m[r][0]);
        if (ap(0) && ap(1)) out.add(N(2 * m[2][1] - m[2][0]));
        const d = N(m[0][1] - m[0][0]);
        if ([0, 1].every(r => N(m[r][1] - m[r][0]) === d && N(m[r][2] - m[r][1]) === d) && N(m[2][1] - m[2][0]) === d) out.add(N(m[2][1] + d));
      }
      if (arith) {
        if (m[0][2] === m[0][0] + m[0][1] && m[1][2] === m[1][0] + m[1][1]) out.add(m[2][0] + m[2][1]);
        if (m[0][2] === m[0][0] - m[0][1] && m[1][2] === m[1][0] - m[1][1]) out.add(m[2][0] - m[2][1]);
      }
      // A cell copies a fixed other cell of its row (e.g. column 3 = column 1).
      for (const k of [0, 1]) if (m[0][2] === m[0][k] && m[1][2] === m[1][k]) out.add(m[2][k]);
      // Rows 1 and 2 hold the same values in any order (Latin square, two-and-one): row 3 completes that set.
      const ms = a => a.map(String).sort().join('|');
      if (ms(m[0]) === ms(m[1])) {
        const rest = m[0].slice();
        for (const x of [m[2][0], m[2][1]]) { const i = rest.indexOf(x); if (i < 0) { rest.length = 0; break; } rest.splice(i, 1); }
        if (rest.length === 1) out.add(rest[0]);
      }
    }
    return out;
  }

  // Options: answer, sec(answer), prim1, sec(prim1), prim2, sec(prim2). Every attribute value appears in
  // exactly 2 or 3 options, so the answer is never "the most common value" for any attribute.
  function finish(R, { fam, points, cells, ans, prim, sec, render, consistent, valid, rule }) {
    if (!prim || prim.length < 2 || !sec) return null;
    const opts = [];
    for (const p of [null, prim[0], prim[1]]) {
      const base = p ? p.apply(ans) : ans;
      opts.push({ at: base, why: p ? p.why : null });
      const s = sec.apply(base);
      opts.push({ at: s, why: p ? (sec.join ? `${p.why} ${sec.why(base)}` : p.why) : sec.why(base) });
    }
    if (valid && !opts.every(o => valid(o.at))) return null;
    if (!consistent(ans) || opts.slice(1).some(o => consistent(o.at))) return null;
    const svgs = opts.map(o => render(o.at));
    if (new Set(svgs).size !== 6) return null;
    const cellSvgs = cells.map(render);
    const order = R.shuffle([0, 1, 2, 3, 4, 5]);
    return {
      cells: cellSvgs, options: order.map(i => svgs[i]), reasons: order.map(i => opts[i].why), correct: order.indexOf(0),
      rule, b: Math.max(-2.6, Math.min(3.2, -2.9 + 1.3 * points)), fam,
    };
  }

  // ------------------------------------------------------------ attribute machinery (scene, movers, dial)
  // An attribute: { key, grid (3x3, [2][2] = answer), opts for predict(), alts: [{v, why}], text: rule sentence, w: weight }
  const STRUCT = {
    row: vals => G(r => vals[r]), col: vals => G((r, c) => vals[c]),
    lat1: vals => G((r, c) => vals[(c + r) % 3]), lat2: vals => G((r, c) => vals[(c + 2 * r) % 3]),
  };
  function catAttr(R, key, label, plural, nm, domain, struct) {
    const ansOf = g => g[2][2];
    if (struct === 'const') {
      const v = R.pick(domain), grid = G(() => v);
      return { key, grid, varying: false, w: 0, text: '',
        alts: R.sample(domain.filter(x => x !== v), 3).map(x => ({ v: x, why: `${cap(label)} never changes: it is always ${nm(v)}.` })) };
    }
    if (struct === 'two') {
      const [A, B] = R.sample(domain, 2), k = R.int(0, 2), s = R.pick([1, 2]);
      const grid = G((r, c) => c === (k + s * r) % 3 ? B : A), a = grid[2][2];
      const text = `Every row and every column has two cells with ${label} ${nm(A)} and one with ${nm(B)}.`;
      const alts = [{ v: a === A ? B : A, why: a === A ? `Row 3 already has its one ${nm(B)}; ${text}` : `Row 3 already has two ${nm(A)}; ${text}` }];
      const un = domain.filter(x => x !== A && x !== B);
      if (un.length) { const x = R.pick(un); alts.push({ v: x, why: `${cap(nm(x))} never appears in the pattern. ${text}` }); }
      return { key, grid, varying: true, struct, w: 0.8, text, alts };
    }
    const vals = R.sample(domain, 3), grid = STRUCT[struct](vals), a = ansOf(grid);
    const unused = domain.filter(x => !vals.includes(x));
    let alts, text;
    if (struct === 'row') {
      text = `${cap(label)} is fixed per row (${vals.map(nm).join(', ')}).`;
      alts = [0, 1].map(i => ({ v: vals[i], why: `${cap(label)} is fixed per row: row 3 always has ${nm(a)}; ${nm(vals[i])} belongs to ${ROWN[i]}.` }));
    } else if (struct === 'col') {
      text = `${cap(label)} is fixed per column (${vals.map(nm).join(', ')}).`;
      alts = [0, 1].map(i => ({ v: vals[i], why: `${cap(label)} is fixed per column: column 3 always has ${nm(a)}; ${nm(vals[i])} belongs to ${COLN[i]}.` }));
    } else {
      text = `Each row and column contains each of the ${plural} ${andList(vals.map(nm))} once.`;
      alts = vals.filter(x => x !== a).map(x => ({ v: x, why: `Each row and column has each of the ${plural} ${andList(vals.map(nm))} once. Row 3 already has ${nm(x)}, so it needs ${nm(a)}.` }));
    }
    if (unused.length) { const x = R.pick(unused); alts.push({ v: x, why: `${cap(nm(x))} never appears in the pattern; ${label} only takes the values ${andList(vals.map(nm))}.` }); }
    return { key, grid, varying: true, struct, w: { row: 0.45, col: 0.45, lat1: 0.95, lat2: 0.95 }[struct], text, alts };
  }

  // Numeric attribute (counts, polygon sides): progression, Latin, row/col, arithmetic.
  function numAttr(R, key, label, nm, lo, hi, struct) {
    let grid, text, alts = [], w;
    const ok = x => x >= lo && x <= hi;
    if (struct === 'const') {
      const v = R.int(lo, hi);
      grid = G(() => v);
      const cand = [v - 1, v + 1, v + 2, v - 2].filter(ok);
      return { key, grid, varying: false, w: 0, text: '', o: { ordinal: true }, alts: cand.slice(0, 3).map(x => ({ v: x, why: `The ${label} never changes: it is always ${v}.` })) };
    }
    if (struct === 'prog') {
      const d = R.weighted({ 1: 5, 2: 2, '-1': 2 }) | 0, e = R.pick([1, 2, -1, d, 0].filter(x => x !== 0 || R.chance(0.3)));
      const all = []; for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) all.push(e * r + d * c);
      const mn = Math.min(...all), mx = Math.max(...all);
      if (mx - mn > hi - lo) return null;
      const a0 = R.int(lo - mn, hi - mx);
      grid = G((r, c) => a0 + e * r + d * c);
      const g = grid[2], a = g[2], sgn = d > 0 ? `+${d}` : `${d}`;
      const seq = `${nm(g[0])} → ${nm(g[1])} → ${nm(a)}`;
      text = `The ${label} changes by ${sgn} from each cell to the next along every row (row 3: ${seq}).`;
      alts = [
        { v: g[1], why: `This repeats the middle cell. The ${label} changes by ${sgn} each step, so it should be ${nm(a)}.` },
        { v: a + d, why: `One step too far: the ${label} changes by ${sgn} per step (${seq}), not ${sgn} twice.` },
        { v: a - 2 * d, why: `This goes the wrong way: the ${label} changes by ${sgn} per step (${seq}).` },
        { v: a + (R.chance(0.5) ? 1 : -1) * (Math.abs(d) === 1 ? 2 : 1), why: `Count again: the ${label} changes by ${sgn} per step (${seq}).` },
      ].filter(x => ok(x.v) && x.v !== a);
      w = 0.75 + (Math.abs(d) === 2 ? 0.2 : 0) + (d < 0 ? 0.15 : 0) + (e !== d && e !== 0 ? 0.1 : 0);
    } else if (struct === 'arith') {
      const plus = R.chance(0.6), rows = [];
      for (let r = 0; r < 3; r++) {
        let x, y;
        if (plus) { x = R.int(1, 4); y = R.int(1, Math.min(4, hi - x)); } else { x = R.int(3, hi); y = R.int(1, x - 1); }
        rows.push([x, y, plus ? x + y : x - y]);
      }
      if (new Set(rows.map(String)).size < 3 || rows.some(rw => rw[0] === rw[1])) return null;
      grid = rows;
      const [x, y, a] = rows[2], op = plus ? '+' : '−';
      text = `In every row, column 3 = column 1 ${op} column 2 (row 3: ${x} ${op} ${y} = ${a}).`;
      alts = [
        { v: plus ? x - y : x + y, why: `Wrong operation: column 3 = column 1 ${op} column 2, so ${x} ${op} ${y} = ${a}.` },
        { v: a + 1, why: `Off by one: column 3 = column 1 ${op} column 2, so ${x} ${op} ${y} = ${a}.` },
        { v: a - 1, why: `Off by one: column 3 = column 1 ${op} column 2, so ${x} ${op} ${y} = ${a}.` },
      ].filter(o => ok(o.v) && o.v !== a);
      w = 1.55;
    } else {
      const vals = R.sample(Array.from({ length: hi - lo + 1 }, (_, i) => lo + i), 3);
      const at = catAttr(R, key, label, 'counts', nm, vals, struct);
      at.alts = at.alts.filter(o => vals.includes(o.v));
      const x = R.pick([at.grid[2][2] + 1, at.grid[2][2] - 1].filter(v => ok(v) && !vals.includes(v)));
      if (x !== undefined) at.alts.push({ v: x, why: `The ${label} is ${nm(x)}, which never appears; ${at.text}` });
      at.o = { ordinal: true, arith: true };
      return at;
    }
    return { key, grid, varying: true, struct, w, text, alts, o: { ordinal: true, arith: true } };
  }

  function buildFromAttrs(R, fam, attrs, render, extraPoints, answerText, valid) {
    if (attrs.some(a => !a)) return null;
    const ans = Object.fromEntries(attrs.map(a => [a.key, a.grid[2][2]]));
    const cells = CELLS.map(([r, c]) => Object.fromEntries(attrs.map(a => [a.key, a.grid[r][c]])));
    const P = Object.fromEntries(attrs.map(a => [a.key, a.preds || predict(a.grid, a.o || {})]));
    const consistent = at => attrs.every(a => P[a.key].has(at[a.key]));
    const vary = attrs.filter(a => a.varying);
    const primC = vary.filter(a => a.alts.length >= 2);
    if (!primC.length) return null;
    const pa = R.pick(primC);
    const secC = attrs.filter(a => a !== pa && a.alts.length);
    const secV = secC.filter(a => a.varying);
    const sa = secV.length && R.chance(0.85) ? R.pick(secV) : secC.length ? R.pick(secC) : null;
    if (!sa) return null;
    const mk = (a, alt) => ({ apply: at => ({ ...at, [a.key]: alt.v }), why: () => alt.why });
    const prim = R.sample(pa.alts, 2).map(alt => ({ apply: at => ({ ...at, [pa.key]: alt.v }), why: alt.why }));
    const salt = R.pick(sa.alts), sec = { ...mk(sa, salt), join: true };
    const points = vary.reduce((s, a) => s + a.w, 0) + 0.35 * Math.max(0, vary.length - 1) + extraPoints;
    const rule = vary.map(a => a.text).join(' ') + ` Answer: ${answerText(ans)}.`;
    return finish(R, { fam, points, cells, ans, prim, sec, render, consistent, valid, rule });
  }

  const pickStructs = (R, attrs, k, must) => {
    // attrs: [{key, structs}] -> assign k distinct structure kinds; others const
    const chosen = new Set(must ? [must] : []);
    while (chosen.size < k) chosen.add(R.pick(attrs).key);
    const used = new Set(), out = {};
    for (const a of R.shuffle(attrs)) {
      if (!chosen.has(a.key)) { out[a.key] = 'const'; continue; }
      const opts = a.structs.filter(s => !used.has(s.replace(/\d/, '')) && !used.has(s));
      if (!opts.length) return null;
      const s = R.pick(opts); out[a.key] = s; used.add(s);
      if (s === 'row' || s === 'col') used.add(s);
    }
    return out;
  };

  // ------------------------------------------------------------ family: shapes (single / count / in-out)
  const SHAPES = ['circle', 'square', 'triangle', 'pentagon', 'hexagon', 'star', 'cross', 'diamond'];
  const SMALL = ['circle', 'square', 'triangle', 'star', 'cross', 'diamond'];
  const POLY = { 3: 'triangle', 4: 'square', 5: 'pentagon', 6: 'hexagon', 7: 'heptagon', 8: 'octagon' };
  const sName = s => s === 'cross' ? 'plus' : s;
  const noSqDi = R => d => { const x = R.chance(0.5) ? 'square' : 'diamond'; return d.filter(s => s !== x); };
  const FILLS = ['white', 'grey', 'black'], SIZES = [12, 19, 27], SIZEN = ['small', 'medium', 'large'];
  const kVary = R => R.hard ? 3 : +R.weighted({ 1: 3, 2: 4, 3: 3 });

  function genSingle(R) {
    const sides = R.chance(0.3);
    const defs = [{ key: 'shape', structs: sides ? ['prog'] : ['row', 'col', 'lat1', 'lat2'] },
      { key: 'fill', structs: ['row', 'col', 'lat1', 'lat2', 'two'] }, { key: 'size', structs: ['row', 'col', 'lat1', 'lat2', 'two'] }];
    const st = pickStructs(R, defs, kVary(R), sides ? 'shape' : null);
    if (!st) return null;
    const shp = sides ? numAttr(R, 'shape', 'number of sides', x => `${POLY[x]} (${x})`, 3, 8, st.shape === 'const' ? 'const' : 'prog')
      : catAttr(R, 'shape', 'shape', 'shapes', sName, noSqDi(R)(SHAPES), st.shape);
    if (sides && shp) shp.w += 0.3;
    const fill = catAttr(R, 'fill', 'colour', 'colours', x => x, FILLS, st.fill);
    const size = catAttr(R, 'size', 'size', 'sizes', i => SIZEN[i], [0, 1, 2], st.size);
    const shapeOf = at => sides ? POLY[at.shape] : at.shape;
    return buildFromAttrs(R, 'single', [shp, fill, size], at => shape(shapeOf(at), 50, 50, SIZES[at.size], at.fill), 0,
      at => `a ${SIZEN[at.size]} ${at.fill} ${sName(shapeOf(at))}`);
  }

  function genCount(R) {
    const defs = [{ key: 'count', structs: R.hard ? ['prog', 'arith', 'arith'] : ['prog', 'prog', 'arith', 'row', 'col', 'lat1', 'lat2'] },
      { key: 'shape', structs: ['row', 'col', 'lat1', 'lat2'] }, { key: 'fill', structs: ['row', 'col', 'lat1', 'lat2'] }];
    const st = pickStructs(R, defs, kVary(R), 'count');
    if (!st) return null;
    const cnt = numAttr(R, 'count', 'number of shapes', x => String(x), 1, 9, st.count);
    const shp = catAttr(R, 'shape', 'shape', 'shapes', sName, noSqDi(R)(SMALL), st.shape);
    const fill = catAttr(R, 'fill', 'colour', 'colours', x => x, FILLS, st.fill);
    return buildFromAttrs(R, 'count', [cnt, shp, fill],
      at => LAYOUT[at.count].map(([x, y]) => shape(at.shape, x, y, countR(at.count), at.fill)).join(''), 0,
      at => `${at.count} ${at.fill} ${sName(at.shape)}${at.count > 1 ? (at.shape === 'cross' ? ' signs' : 's') : ''}`);
  }

  function genInOut(R) {
    const defs = [{ key: 'outer', structs: ['row', 'col', 'lat1', 'lat2'] }, { key: 'inner', structs: ['row', 'col', 'lat1', 'lat2', 'two'] },
      { key: 'fill', structs: ['row', 'col', 'lat1', 'lat2', 'two'] }];
    const st = pickStructs(R, defs, kVary(R), null);
    if (!st) return null;
    const outer = catAttr(R, 'outer', 'outer shape', 'outer shapes', sName, noSqDi(R)(['circle', 'square', 'hexagon', 'pentagon', 'diamond', 'triangle']), st.outer);
    const inner = catAttr(R, 'inner', 'inner shape', 'inner shapes', sName, noSqDi(R)(SMALL), st.inner);
    const fill = catAttr(R, 'fill', 'inner colour', 'inner colours', x => x, FILLS, st.fill);
    return buildFromAttrs(R, 'inout', [outer, inner, fill],
      at => shape(at.outer, 50, 50, 33, 'white') + shape(at.inner, 50, at.outer === 'triangle' ? 58 : 50, at.outer === 'triangle' ? 9 : 11, at.fill), 0.15,
      at => `a ${sName(at.outer)} with a ${at.fill} ${sName(at.inner)} inside`);
  }

  // ------------------------------------------------------------ family: markers moving around a frame
  const SLOTS = [[22, 22], [50, 22], [78, 22], [78, 50], [78, 78], [50, 78], [22, 78], [22, 50]];
  const SLOTN = ['top-left corner', 'top middle', 'top-right corner', 'right middle', 'bottom-right corner', 'bottom middle', 'bottom-left corner', 'left middle'];
  const DIRN = ['up', 'up-right', 'right', 'down-right', 'down', 'down-left', 'left', 'up-left'];

  function cyclic(R, key, label, n, d, posName, V) {
    const starts = R.sample([0, 1, 2, 3, 4, 5, 6, 7], 3);
    const grid = G((r, c) => ((starts[r] + d * c) % n + n) % n);
    const N = x => ((x % n) + n) % n, g = grid[2], a = g[2];
    const k = Math.abs(d), dir = d > 0 ? 'clockwise' : 'anticlockwise', other = d > 0 ? 'anticlockwise' : 'clockwise';
    const step = `${V.step(k)} ${dir}`;
    const text = `The ${label} ${V.verb} ${step} each column.`;
    const alts = [
      { v: g[1], why: `The ${label} did not ${V.base} here. It ${V.verb} ${step} each column.` },
      { v: N(a + d), why: `The ${label} ${V.past} too far: ${V.step(2 * k)} instead of ${V.step(k)}.` },
      { v: N(g[1] - d), why: `The ${label} ${V.past} ${other}. It ${V.verb} ${step} each column.` },
      { v: N(a + (R.chance(0.5) ? 1 : -1)), why: `The ${label} is ${V.off} off. It ${V.verb} ${step} each column, so it ends ${posName(a)}.` },
    ].filter((o, i, arr) => o.v !== a && arr.findIndex(p => p.v === o.v) === i);
    return { key, grid, varying: true, w: 0.7 + 0.25 * (k - 1) + (d < 0 ? 0.2 : 0), text, alts, o: { ordinal: true, mod: n } };
  }

  const MOVE_V = { verb: 'moves', base: 'move', past: 'moved', off: 'one position', step: k => `${k} position${k > 1 ? 's' : ''}` };
  const TURN_V = { verb: 'turns', base: 'turn', past: 'turned', off: '45°', step: k => `${45 * k}°` };
  const MARKERS = [
    { label: 'black circle', draw: (x, y) => shape('circle', x, y, 9, 'black') },
    { label: 'white square', draw: (x, y) => shape('square', x, y, 9, 'white') },
    { label: 'grey triangle', draw: (x, y) => shape('triangle', x, y, 9.5, 'grey') },
  ];
  function genMove(R) {
    const m = R.hard ? 3 : +R.weighted({ 1: 3, 2: 5, 3: 1 }), mk = R.sample(MARKERS, m);
    const attrs = mk.map((M, i) => cyclic(R, 'm' + i, M.label, 8, R.pick([1, 1, 2, 3, -1, -2]), p => `in the ${SLOTN[p]}`, MOVE_V));
    const bg = `<rect x="8" y="8" width="84" height="84" rx="4" fill="none" stroke="${GUIDE}" stroke-width="2"/>` + SLOTS.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="3" fill="${GUIDE}"/>`).join('');
    let extra = 0.5 * (m - 1);
    if (m === 1) {
      // Single marker: add a second rule on the marker's size or the number of markers? Keep it simple: colour of the frame centre.
      const st = R.pick(['row', 'col', 'lat1', 'lat2', 'const']);
      attrs.push(catAttr(R, 'c', 'centre shape', 'centre shapes', sName, ['circle', 'square', 'triangle', 'star', 'diamond'], st));
    }
    const valid = at => new Set(mk.map((_, i) => at['m' + i])).size === m;
    if (![...CELLS, [2, 2]].every(([r, c]) => valid(Object.fromEntries(attrs.map(a => [a.key, a.grid[r][c]]))))) return null;
    return buildFromAttrs(R, 'move', attrs,
      at => bg + (at.c ? shape(at.c, 50, 50, 10, 'white') : '') + mk.map((M, i) => M.draw(...SLOTS[at['m' + i]])).join(''), extra,
      at => mk.map((M, i) => `${M.label} in the ${SLOTN[at['m' + i]]}`).join(', ') + (at.c ? `, ${sName(at.c)} in the centre` : ''), valid);
  }

  // ------------------------------------------------------------ family: rotating arrow / clock hands
  function genDial(R) {
    const clock = R.hard || R.chance(0.5), attrs = [];
    let render, answer, extra = 0, valid;
    if (clock) {
      attrs.push(cyclic(R, 'h1', 'long hand', 8, R.pick([1, 1, 2, 3, -1, -2]), p => `pointing ${DIRN[p]}`, TURN_V));
      attrs.push(cyclic(R, 'h2', 'short hand', 8, R.pick([1, 2, -1, -2, -3]), p => `pointing ${DIRN[p]}`, TURN_V));
      if (attrs[0].grid.flat().join() === attrs[1].grid.flat().join()) return null;
      const hand = (a, L, sw) => { const t = (a * 45 - 90) * Math.PI / 180; return line(50, 50, 50 + L * Math.cos(t), 50 + L * Math.sin(t), sw); };
      const ticks = Array.from({ length: 8 }, (_, i) => { const t = i * Math.PI / 4; return line(50 + 33 * Math.cos(t), 50 + 33 * Math.sin(t), 50 + 37 * Math.cos(t), 50 + 37 * Math.sin(t), 1.5, '#b5b5bf'); }).join('');
      render = at => `<circle cx="50" cy="50" r="40" fill="#fff" stroke="${INK}" stroke-width="${SW}"/>` + ticks + hand(at.h1, 31, 2.5) + hand(at.h2, 19, 6.5) + `<circle cx="50" cy="50" r="3.5" fill="${INK}"/>`;
      answer = at => `long hand ${DIRN[at.h1]}, short hand ${DIRN[at.h2]}`;
      valid = at => at.h1 !== at.h2;
      extra = 0.45;
    } else {
      attrs.push(cyclic(R, 'h1', 'arrow', 8, R.pick([1, 1, 2, 3, -1, -2, -3]), p => `pointing ${DIRN[p]}`, TURN_V));
      attrs.push(catAttr(R, 'f', 'arrowhead colour', 'arrowhead colours', x => x, FILLS, R.pick(['row', 'col', 'lat1', 'lat2', 'two', 'const', 'const'])));
      render = at => `<g transform="rotate(${at.h1 * 45} 50 50)">${line(50, 80, 50, 36, 4)}<polygon points="50,14 37,38 63,38" fill="${FILLV[at.f]}" stroke="${INK}" stroke-width="${SW}" stroke-linejoin="round"/><circle cx="50" cy="82" r="5" fill="#fff" stroke="${INK}" stroke-width="${SW}"/></g>`;
      answer = at => `the arrow pointing ${DIRN[at.h1]} with a ${at.f} head`;
      extra = -0.1;
    }
    const vcells = [...CELLS, [2, 2]].map(([r, c]) => Object.fromEntries(attrs.map(a => [a.key, a.grid[r][c]])));
    if (valid && !vcells.every(valid)) return null;
    return buildFromAttrs(R, 'dial', attrs, render, extra, answer, valid);
  }

  // ------------------------------------------------------------ family: overlay (set operations on lines/dots)
  const OPS = { or: (a, b) => a | b, xor: (a, b) => a ^ b, and: (a, b) => a & b, sub: (a, b) => a & ~b, bsub: (a, b) => b & ~a, first: a => a, second: (a, b) => b };
  const OPDESC = {
    or: 'Cell 3 is cells 1 and 2 laid on top of each other: it keeps every element from either cell.',
    xor: 'Cell 3 keeps the elements that are in exactly one of cells 1 and 2; elements in both cancel out.',
    and: 'Cell 3 keeps only the elements that cells 1 and 2 have in common.',
    sub: 'Cell 3 is cell 1 with the elements of cell 2 removed.',
  };
  const OPALT = { or: 'all elements of both cells combined', xor: 'the elements in exactly one of the cells', and: 'only the shared elements', sub: 'cell 1 minus cell 2', bsub: 'cell 2 minus cell 1' };
  function genOverlay(R) {
    const lines = !R.hard && R.chance(0.55), n = lines ? 12 : 9, unit = lines ? 'line' : 'dot';
    const shp = !lines && (R.hard || R.chance(0.35)) ? catAttr(R, 'k', 'dot shape', 'dot shapes', sName, ['circle', 'square', 'triangle', 'star', 'diamond'], R.pick(['row', 'col', 'lat1', 'lat2'])) : null;
    const op = R.weighted({ or: 2, xor: 3, and: 2, sub: 2 });
    const rand = (lo, hi) => { const k = R.int(lo, hi); let m = 0; for (const i of R.sample([...Array(n).keys()], k)) m |= 1 << i; return m; };
    const rows = [];
    for (let r = 0; r < 3; r++) {
      let A, B, C, t = 0;
      do { A = rand(3, 5); B = rand(3, 5); C = OPS[op](A, B); t++; }
      while (t < 50 && (popc(A & B) < 1 || popc(A ^ B) < 3 || popc(C) < 2 || A === B || C === A || C === B));
      if (t >= 50) return null;
      rows.push([A, B, C]);
    }
    const g = rows, ans = g[2][2];
    const preds = new Set();
    for (const [k, f] of Object.entries(OPS)) {
      if ([0, 1].every(r => f(g[r][0], g[r][1]) === g[r][2])) preds.add(f(g[2][0], g[2][1]));
      if ([0, 1].every(c => f(g[0][c], g[1][c]) === g[2][c])) preds.add(f(g[0][2], g[1][2]));
    }
    if (preds.size !== 1 || !preds.has(ans)) return null;
    const alt = Object.keys(OPALT).filter(k => k !== op).map(k => ({ k, v: OPS[k](g[2][0], g[2][1]) }))
      .filter((o, i, arr) => o.v !== ans && popc(o.v) >= 1 && arr.findIndex(p => p.v === o.v) === i);
    if (alt.length < 2) return null;
    const pr = R.sample(alt, 2).map(o => ({ apply: at => ({ ...at, s: o.v }), why: `This shows ${OPALT[o.k]}. ${OPDESC[op]}` }));
    const e = R.int(0, n - 1);
    const tog = s => (s ^ (1 << e)) || (s | (1 << ((e + 1) % n)));
    let sec = { apply: at => ({ ...at, s: tog(at.s) }), why: at => popc(tog(at.s)) < popc(at.s) ? `One ${unit} is missing. ${OPDESC[op]}` : `It has an extra ${unit}. ${OPDESC[op]}`, join: false };
    let consistent = at => preds.has(at.s);
    if (shp) {
      const o = R.pick(shp.alts.slice(0, 2)), P = predict(shp.grid);
      if (R.chance(0.6)) sec = { apply: at => ({ ...at, k: o.v }), why: () => o.why, join: true };
      consistent = at => preds.has(at.s) && P.has(at.k);
    }
    let draw;
    if (lines) {
      const segs = [];
      for (let i = 0; i < 8; i++) { const t = (i * 45 - 90) * Math.PI / 180, L = i % 2 ? 28 * Math.SQRT2 : 28; segs.push([50, 50, 50 + L * Math.cos(t), 50 + L * Math.sin(t)]); }
      segs.push([22, 22, 78, 22], [78, 22, 78, 78], [78, 78, 22, 78], [22, 78, 22, 22]);
      draw = at => segs.map(s => line(...s, 1.2, GUIDE)).join('') + bits(at.s, n).map(i => line(...segs[i], 4)).join('');
    } else {
      const P = [26, 50, 74];
      draw = at => [...Array(9).keys()].map(i => (at.s >> i & 1) ? shape(at.k || 'circle', P[i % 3], P[(i / 3) | 0], at.k ? 8 : 9, 'black', at.k ? 2 : 0) : `<circle cx="${P[i % 3]}" cy="${P[(i / 3) | 0]}" r="3" fill="${GUIDE}"/>`).join('');
    }
    const cells = CELLS.map(([r, c]) => ({ s: g[r][c], ...(shp ? { k: shp.grid[r][c] } : {}) }));
    const points = { or: 0.95, and: 1.15, sub: 1.35, xor: 1.5 }[op] + (lines ? 0.2 : 0) + 0.85 + (shp ? shp.w + 0.35 : 0);
    const ansAt = { s: ans, ...(shp ? { k: shp.grid[2][2] } : {}) };
    return finish(R, { fam: 'overlay', points, cells, ans: ansAt, prim: pr, sec, render: draw, consistent,
      rule: `${OPDESC[op]} This holds in every row.${shp ? ' ' + shp.text + ` Answer: ${sName(shp.grid[2][2])}s.` : ''}` });
  }

  // ------------------------------------------------------------ family: board patterns that shift or rotate
  function genBoard(R) {
    const n = R.chance(0.5) ? 3 : 4, layers = R.hard || R.chance(0.35) ? 2 : 1, N2 = n * n;
    const xf = f => m => { let o = 0; for (let i = 0; i < N2; i++) if (m >> i & 1) { const [r, c] = f((i / n) | 0, i % n); o |= 1 << (r * n + c); } return o; };
    const md = x => ((x % n) + n) % n;
    const TF = {
      right: xf((r, c) => [r, md(c + 1)]), left: xf((r, c) => [r, md(c - 1)]), down: xf((r, c) => [md(r + 1), c]), up: xf((r, c) => [md(r - 1), c]),
      cw: xf((r, c) => [c, n - 1 - r]), ccw: xf((r, c) => [n - 1 - c, r]), r180: xf((r, c) => [n - 1 - r, n - 1 - c]),
      fliph: xf((r, c) => [r, n - 1 - c]), flipv: xf((r, c) => [n - 1 - r, c]), tr: xf((r, c) => [c, r]), atr: xf((r, c) => [n - 1 - c, n - 1 - r]),
      dr: xf((r, c) => [md(r + 1), md(c + 1)]), dl: xf((r, c) => [md(r + 1), md(c - 1)]), ur: xf((r, c) => [md(r - 1), md(c + 1)]), ul: xf((r, c) => [md(r - 1), md(c - 1)]),
      id: m => m,
    };
    const INV = { right: 'left', left: 'right', up: 'down', down: 'up', cw: 'ccw', ccw: 'cw', dr: 'ul', ul: 'dr', dl: 'ur', ur: 'dl' };
    const DESC = {
      right: 'moves one square to the right each column (wrapping round to the left edge)', left: 'moves one square to the left each column (wrapping round to the right edge)',
      down: 'moves one square down each column (wrapping round to the top)', up: 'moves one square up each column (wrapping round to the bottom)',
      cw: 'turns 90° clockwise each column', ccw: 'turns 90° anticlockwise each column',
      dr: 'moves one square diagonally down-right each column (wrapping round)', ur: 'moves one square diagonally up-right each column (wrapping round)',
    };
    const NAMES = ['black squares', 'circles'];
    const attrs = [];
    const usedT = new Set();
    for (let L = 0; L < layers; L++) {
      const t = R.pick(['right', 'left', 'down', 'up', 'cw', 'ccw', 'dr', 'ur'].filter(x => !usedT.has(x)));
      usedT.add(t);
      const k = n === 3 ? R.int(2, 3) : R.int(3, 5);
      const rand = () => { let m = 0; for (const i of R.sample([...Array(N2).keys()], k)) m |= 1 << i; return m; };
      const starts = [rand(), rand(), rand()];
      const grid = G((r, c) => { let m = starts[r]; for (let i = 0; i < c; i++) m = TF[t](m); return m; });
      const preds = new Set();
      for (const f of Object.values(TF)) {
        if ([0, 1].every(r => f(grid[r][0]) === grid[r][1] && f(grid[r][1]) === grid[r][2]) && f(grid[2][0]) === grid[2][1]) preds.add(f(grid[2][1]));
        if ([0, 1].every(c => f(grid[0][c]) === grid[1][c] && f(grid[1][c]) === grid[2][c]) && f(grid[0][2]) === grid[1][2]) preds.add(f(grid[1][2]));
      }
      if (preds.size !== 1) return null;
      const a = grid[2][2], nm = NAMES[L], d = DESC[t];
      const alts = [
        { v: grid[2][1], why: `The ${nm} did not move. The pattern ${d}.` },
        { v: TF[INV[t]](grid[2][1]), why: `This moved the wrong way. The pattern of ${nm} ${d}.` },
        { v: TF[t](a), why: `This moved twice. The pattern of ${nm} ${d}.` },
        t === 'cw' || t === 'ccw' ? { v: TF.fliph(a), why: `This is a mirror image of the correct answer. The pattern of ${nm} ${d}.` }
          : { v: TF[{ right: 'down', left: 'up', down: 'right', up: 'left', dr: 'right', ur: 'up' }[t]](grid[2][1]), why: `This moved in the wrong direction. The pattern of ${nm} ${d}.` },
      ].filter((o, i, arr) => o.v !== a && arr.findIndex(p => p.v === o.v) === i);
      attrs.push({ key: 'L' + L, grid, preds, alts, text: `The pattern of ${nm} ${d}.`, w: { right: 1.0, left: 1.05, down: 1.0, up: 1.05, cw: 1.35, ccw: 1.45, dr: 1.4, ur: 1.45 }[t] });
    }
    const ans = Object.fromEntries(attrs.map(a => [a.key, a.grid[2][2]]));
    const pa = R.pick(attrs);
    if (pa.alts.length < 2) return null;
    const prim = R.sample(pa.alts, 2).map(o => ({ apply: at => ({ ...at, [pa.key]: o.v }), why: o.why }));
    let sec;
    if (layers === 2) {
      const sa = attrs.find(a => a !== pa), o = R.pick(sa.alts);
      if (!o) return null;
      sec = { apply: at => ({ ...at, [sa.key]: o.v }), why: () => o.why, join: true };
    } else {
      const e = R.int(0, N2 - 1);
      sec = { apply: at => ({ ...at, L0: at.L0 ^ (1 << e) }), why: at => (at.L0 >> e & 1) ? `One black square is missing. ${attrs[0].text}` : `It has an extra black square. ${attrs[0].text}`, join: false };
    }
    const S0 = 76 / n, x0 = 12;
    const grid = Array.from({ length: n + 1 }, (_, i) => line(x0 + i * S0, x0, x0 + i * S0, x0 + n * S0, 1.2, '#c4c4cc') + line(x0, x0 + i * S0, x0 + n * S0, x0 + i * S0, 1.2, '#c4c4cc')).join('');
    const render = at => grid + bits(at.L0, N2).map(i => `<rect x="${nf(x0 + (i % n) * S0)}" y="${nf(x0 + ((i / n) | 0) * S0)}" width="${nf(S0)}" height="${nf(S0)}" fill="${INK}"/>`).join('')
      + (layers === 2 ? bits(at.L1, N2).map(i => `<circle cx="${nf(x0 + (i % n + 0.5) * S0)}" cy="${nf(x0 + (((i / n) | 0) + 0.5) * S0)}" r="${nf(S0 * 0.28)}" fill="#fff" stroke="${INK}" stroke-width="2.2"/>`).join('') : '');
    const cells = CELLS.map(([r, c]) => Object.fromEntries(attrs.map(a => [a.key, a.grid[r][c]])));
    const points = attrs.reduce((s, a) => s + a.w, 0) + (n === 4 ? 0.15 : 0) + (layers === 2 ? 0.5 : 0);
    return finish(R, { fam: 'board', points, cells, ans, prim, sec, render, consistent: at => attrs.every(a => a.preds.has(at[a.key])), rule: attrs.map(a => a.text).join(' ') });
  }

  // ------------------------------------------------------------ family: fold / flip / rotate whole figures
  // A figure is a set of atoms on a doubled-integer grid centred on (0,0):
  //   cells glyph: 'F x y c' (full square, c = b|g) and 'T x y sx sy' (black half-square triangle, right angle at corner (x+sx, y+sy))
  //   arms glyph:  'A dx dy' (line from the centre) and 'D x y' (dot beside a line)
  const PM = { id: [1, 0, 0, 1], r90: [0, -1, 1, 0], r180: [-1, 0, 0, -1], r270: [0, 1, -1, 0], mh: [-1, 0, 0, 1], mv: [1, 0, 0, -1], md: [0, 1, 1, 0], ma: [0, -1, -1, 0] };
  const parseA = a => { const p = a.split(' '); return [p[0], ...p.slice(1).map(x => isNaN(x) ? x : +x)]; };
  function mapAtom(M, a) {
    const [t, x, y, u, v] = parseA(a), f = (p, q) => [M[0] * p + M[1] * q, M[2] * p + M[3] * q];
    if (t === 'F') return `F ${f(x, y).join(' ')} ${u}`;
    if (t === 'T') return `T ${f(x, y).join(' ')} ${f(u, v).join(' ')}`;
    return `${t} ${f(x, y).join(' ')}`;
  }
  const shiftAtom = (a, dx, dy) => { const [t, x, y, ...r] = parseA(a); return [t, x + dx, y + dy, ...r].join(' '); };
  const posX = a => Math.sign(parseA(a)[1]), posY = a => Math.sign(parseA(a)[2]);
  function normFig(arr) {
    const set = [...new Set(arr)], byCell = new Map(), other = [];
    for (const a of set) { const [t, x, y] = parseA(a); if (t === 'F' || t === 'T') { const k = x + ',' + y; if (!byCell.has(k)) byCell.set(k, []); byCell.get(k).push(a); } else other.push(a); }
    const out = [...other];
    for (const [k, list] of byCell) {
      const [x, y] = k.split(',');
      const full = list.filter(a => a[0] === 'F'), tri = list.filter(a => a[0] === 'T').map(parseA);
      if (full.length) { out.push(`F ${x} ${y} ${full.some(a => a.endsWith('b')) || tri.length ? 'b' : 'g'}`); continue; }
      if (tri.some(a => tri.some(b => a[3] === -b[3] && a[4] === -b[4]))) { out.push(`F ${x} ${y} b`); continue; }
      out.push(...tri.map(a => a.join(' ')));
    }
    return out.sort().join('|');
  }
  const atoms = k => k ? k.split('|') : [];
  const XF = {};
  for (const k of Object.keys(PM)) XF[k] = s => normFig(atoms(s).map(a => mapAtom(PM[k], a)));
  const sideOp = (side, M) => s => normFig(atoms(s).map(a => side(a) ? mapAtom(M, a) : a));
  const copyOp = (keep, mirror) => s => { const k = atoms(s).filter(a => keep(a) >= 0); return normFig([...k, ...k.filter(a => keep(a) > 0).map(a => mapAtom(mirror, a))]); };
  const turnOp = (from, mirror) => s => normFig(atoms(s).map(a => from(a) ? mapAtom(mirror, a) : a));
  Object.assign(XF, {
    copyL: copyOp(a => -posX(a), PM.mh), copyR: copyOp(a => posX(a), PM.mh), copyT: copyOp(a => -posY(a), PM.mv), copyB: copyOp(a => posY(a), PM.mv),
    turnL: turnOp(a => posX(a) < 0, PM.mh), turnR: turnOp(a => posX(a) > 0, PM.mh), turnT: turnOp(a => posY(a) < 0, PM.mv), turnB: turnOp(a => posY(a) > 0, PM.mv),
    hfL: sideOp(a => posX(a) < 0, PM.mv), hfR: sideOp(a => posX(a) > 0, PM.mv), hmT: sideOp(a => posY(a) < 0, PM.mh), hmB: sideOp(a => posY(a) > 0, PM.mh),
    swapLR: s => normFig(atoms(s).map(a => shiftAtom(a, posX(a) < 0 ? 4 : -4, 0))), swapTB: s => normFig(atoms(s).map(a => shiftAtom(a, 0, posY(a) < 0 ? 4 : -4))),
  });
  const XTXT = {
    id: 'unchanged', r90: 'turned 90° clockwise', r270: 'turned 90° anticlockwise', r180: 'turned 180°', mh: 'mirrored left–right', mv: 'flipped upside down',
    md: 'mirrored in the diagonal from top-left to bottom-right', ma: 'mirrored in the diagonal from top-right to bottom-left',
    copyL: 'with its left half mirrored over to replace the right half', copyR: 'with its right half mirrored over to replace the left half',
    copyT: 'with its top half mirrored down to replace the bottom half', copyB: 'with its bottom half mirrored up to replace the top half',
    turnL: 'with its left half folded over onto the right half', turnR: 'with its right half folded over onto the left half',
    turnT: 'with its top half folded down onto the bottom half', turnB: 'with its bottom half folded up onto the top half',
    hfL: 'with only its left half flipped upside down', hfR: 'with only its right half flipped upside down',
    hmT: 'with only its top half mirrored left–right', hmB: 'with only its bottom half mirrored left–right',
    swapLR: 'with its left and right halves swapped (not mirrored)', swapTB: 'with its top and bottom halves swapped (not mirrored)',
  };
  const XW = { r90: 1.0, r270: 1.1, r180: 0.95, mh: 0.9, mv: 0.9, md: 1.45, ma: 1.55, copyL: 1.1, copyR: 1.1, copyT: 1.1, copyB: 1.1,
    turnL: 1.35, turnR: 1.35, turnT: 1.35, turnB: 1.35, hfL: 1.5, hfR: 1.5, hmT: 1.5, hmB: 1.5, swapLR: 1.25, swapTB: 1.25 };
  const D4 = ['r90', 'r270', 'r180', 'mh', 'mv', 'md', 'ma'], FOLDS = ['copyL', 'copyR', 'copyT', 'copyB', 'turnL', 'turnR', 'turnT', 'turnB'];
  const HALF = ['hfL', 'hfR', 'hmT', 'hmB'], SWAP = ['swapLR', 'swapTB'];
  const SETOP = { or: (a, b) => normFig([...atoms(a), ...atoms(b)]), and: (a, b) => { const B = new Set(atoms(b)); return normFig(atoms(a).filter(x => B.has(x))); },
    xor: (a, b) => { const A = new Set(atoms(a)), B = new Set(atoms(b)); return normFig([...A].filter(x => !B.has(x)).concat([...B].filter(x => !A.has(x)))); },
    sub: (a, b) => { const B = new Set(atoms(b)); return normFig(atoms(a).filter(x => !B.has(x))); }, bsub: (a, b) => SETOP.sub(b, a) };

  function figPredict(g, lib) {
    const out = new Set(), T = G((r, c) => g[c][r]);
    for (const m of [g, T]) {
      const ok2 = (f, h) => [0, 1].every(r => f(m[r][0]) === m[r][1] && h(m[r][1]) === m[r][2]) && f(m[2][0]) === m[2][1];
      for (const a of lib) for (const b of lib) if (ok2(XF[a], XF[b])) out.add(XF[b](m[2][1]));
      for (const a of lib) if ([0, 1].every(r => XF[a](m[r][0]) === m[r][2])) out.add(XF[a](m[2][0]));
      for (const f of Object.values(SETOP)) if ([0, 1].every(r => f(m[r][0], m[r][1]) === m[r][2])) out.add(f(m[2][0], m[2][1]));
    }
    return out;
  }

  const U = 8.5;
  function drawFig(s, glyph) {
    let o = '';
    if (glyph === 'cells') {
      o += `<rect x="${50 - 4 * U}" y="${50 - 4 * U}" width="${8 * U}" height="${8 * U}" fill="none" stroke="${GUIDE}" stroke-width="1.5"/>`;
      for (const i of [-2, 0, 2]) o += line(50 + i * U, 50 - 4 * U, 50 + i * U, 50 + 4 * U, i ? 1 : 1.6, i ? GUIDE : '#c4c4cc') + line(50 - 4 * U, 50 + i * U, 50 + 4 * U, 50 + i * U, i ? 1 : 1.6, i ? GUIDE : '#c4c4cc');
      for (const a of atoms(s)) {
        const [t, x, y, u, v] = parseA(a), cx = 50 + x * U, cy = 50 + y * U;
        if (t === 'F') o += `<rect x="${nf(cx - U)}" y="${nf(cy - U)}" width="${nf(2 * U)}" height="${nf(2 * U)}" fill="${u === 'b' ? INK : FILLV.grey}"/>`;
        else { const P = [[cx + u * U, cy + v * U], [cx - u * U, cy + v * U], [cx + u * U, cy - v * U]]; o += `<polygon points="${pts(P)}" fill="${INK}"/>`; }
      }
    } else {
      o += `<circle cx="50" cy="50" r="${4 * U + 3}" fill="none" stroke="${GUIDE}" stroke-width="1.5"/>`;
      for (const a of atoms(s)) {
        const [t, x, y] = parseA(a);
        if (t === 'A') o += line(50, 50, 50 + x * 4 * U, 50 + y * 4 * U, 4);
        else o += `<circle cx="${nf(50 + x * U)}" cy="${nf(50 + y * U)}" r="4.6" fill="${INK}"/>`;
      }
      o += `<circle cx="50" cy="50" r="3" fill="${INK}"/>`;
    }
    return o;
  }

  function randCells(R, k) {
    const C = [-3, -1, 1, 3], cells = new Set([`${R.pick(C)},${R.pick(C)}`]);
    while (cells.size < k) {
      const [x, y] = R.pick([...cells]).split(',').map(Number), [dx, dy] = R.pick([[2, 0], [-2, 0], [0, 2], [0, -2]]);
      if (Math.abs(x + dx) <= 3 && Math.abs(y + dy) <= 3) cells.add(`${x + dx},${y + dy}`);
    }
    return normFig([...cells].map(c => { const [x, y] = c.split(','); return R.chance(0.45) ? `T ${x} ${y} ${R.pick([1, -1])} ${R.pick([1, -1])}` : `F ${x} ${y} ${R.chance(0.2) ? 'g' : 'b'}`; }));
  }
  const ARMS = [[0, -1], [1, 0], [0, 1], [-1, 0]];
  function randArms(R, k, dots = 1) {
    const out = [];
    for (const [dx, dy] of R.sample(ARMS, k)) {
      out.push(`A ${dx} ${dy}`);
      const n = dots === 1 ? 1 : R.weighted({ 0: 1, 1: 4, 2: 1 }) | 0;
      for (const s of R.sample([1, -1], n)) out.push(dx ? `D ${3 * dx} ${s}` : `D ${s} ${3 * dy}`);
    }
    return normFig(out);
  }
  function perturb(R, s, glyph) {
    const A = atoms(s), i = R.int(0, A.length - 1), [t, x, y, u, v] = parseA(A[i]);
    if (glyph === 'cells') {
      A[i] = t === 'F' ? `T ${x} ${y} ${R.pick([1, -1])} ${R.pick([1, -1])}` : `T ${x} ${y} ${-v} ${u}`;
      return { s: normFig(A), why: 'One square is drawn differently.' };
    }
    const D = A.map((a, j) => [a, j]).filter(([a]) => a[0] === 'D');
    if (!D.length) return null;
    const [d, j] = R.pick(D), [, dx, dy] = parseA(d);
    const moved = Math.abs(dx) === 3 ? `D ${dx} ${-dy}` : `D ${-dx} ${dy}`;
    if (A.includes(moved)) { A.splice(j, 1); return { s: normFig(A), why: 'One dot is missing.' }; }
    A[j] = moved;
    return { s: normFig(A), why: 'One dot is on the wrong side of its line.' };
  }

  function genFold(R) {
    const glyph = R.chance(0.5) ? 'cells' : 'arms';
    const lib = ['id', ...D4, ...FOLDS, ...(glyph === 'cells' ? [...HALF, ...SWAP] : [])];
    const pool = glyph === 'cells' ? [...D4, ...FOLDS, ...HALF, ...SWAP] : [...D4, ...FOLDS];
    const mode = glyph === 'arms' && !R.hard && R.chance(0.2) ? 'or' : R.hard ? 'two' : R.weighted({ same: 4, two: 3 });
    let t1, t2;
    if (mode === 'same') t1 = t2 = R.pick(glyph === 'cells' ? [...D4, ...SWAP] : D4);
    else if (mode === 'two') {
      const hardPool = pool.filter(t => XW[t] >= 1.25);
      t1 = R.pick(R.hard ? hardPool : D4); t2 = R.pick(pool.filter(t => t !== t1 && (!R.hard || XW[t] >= 1))); if (R.chance(0.5)) [t1, t2] = [t2, t1];
    }
    const mkFig = () => glyph === 'cells' ? randCells(R, R.int(R.hard ? 5 : 4, R.hard ? 7 : 6)) : randArms(R, R.int(2, 3), R.hard ? 2 : 1);
    const rows = [];
    for (let r = 0; r < 3; r++) {
      let row, t = 0;
      do {
        if (mode === 'or') { const a = mkFig(), b = mkFig(); row = [a, b, SETOP.or(a, b)]; }
        else { const a = mkFig(), b = XF[t1](a); row = [a, b, XF[t2](b)]; }
        t++;
      } while (t < 30 && (new Set(row).size < 3 || row.some(x => !x) || rows.some(p => p[0] === row[0])));
      if (t >= 30) return null;
      rows.push(row);
    }
    const g = rows, ans = g[2][2], preds = figPredict(g, lib);
    if (preds.size !== 1 || !preds.has(ans)) return null;
    let rule;
    if (mode === 'or') rule = 'Column 3 is columns 1 and 2 laid on top of each other: every line and dot from both is kept.';
    else if (mode === 'same') rule = `Each step to the right, the figure is ${XTXT[t1]}.`;
    else rule = `In every row, column 2 is column 1 ${XTXT[t1]}, and column 3 is column 2 ${XTXT[t2]}.`;
    if (glyph === 'arms' && mode !== 'or') rule += ' Watch the dots: a mirror moves a dot to the other side of its line, a rotation does not.';
    const mid = g[2][1], cand = [], fallback = [];
    if (mode === 'or') {
      for (const k of ['xor', 'and', 'sub', 'bsub']) cand.push({ s: SETOP[k](g[2][0], g[2][1]), why: `This is not every element of both cells. ${rule}` });
      for (const k of D4) cand.push({ s: SETOP.or(g[2][0], XF[k](g[2][1])), why: `Here column 2 was ${XTXT[k]} before overlaying. ${rule}` });
    }
    for (const k of lib) {
      if (k === 'id') continue;
      if (mode !== 'or') cand.push({ s: XF[k](mid), why: `This is the middle figure ${XTXT[k]}. ${rule}` });
      if (mode !== 'or') cand.push({ s: XF[k](g[2][0]), why: `This is the first figure ${XTXT[k]}. ${rule}` });
      fallback.push({ s: XF[k](ans), why: `This is the correct figure ${XTXT[k]}. ${rule}` });
    }
    const A = new Set(atoms(ans)), sim = s => { const B = atoms(s); return B.filter(x => A.has(x)).length / (new Set([...A, ...B]).size || 1); };
    const seen = new Set([...preds]);
    const uniq = list => list.filter(c => c.s && !seen.has(c.s) && (seen.add(c.s), true)).map(c => ({ ...c, k: sim(c.s) + R.f() * 0.35 })).sort((a, b) => b.k - a.k);
    const alts = uniq(cand).concat(uniq(fallback));
    if (alts.length < 2) return null;
    const prim = alts.slice(0, 2).map(c => ({ apply: () => ({ s: c.s }), why: c.why }));
    const pert = {};
    const sec = { apply: at => { const p = perturb(R, at.s, glyph); pert[at.s] = p; return { s: p ? p.s : at.s }; }, why: at => `${(pert[at.s] || {}).why || ''} ${rule}`, join: false };
    const w = mode === 'or' ? 1.55 : mode === 'same' ? XW[t1] + 0.15 : XW[t1] + XW[t2] + 0.35;
    const points = 0.85 + w + (glyph === 'arms' && mode !== 'or' ? 0.35 : 0) + (R.hard && glyph === 'arms' ? 0.2 : 0) + (glyph === 'cells' && R.hard ? 0.2 : 0);
    const cells = CELLS.map(([r, c]) => ({ s: g[r][c] }));
    return finish(R, { fam: 'fold', points, cells, ans: { s: ans }, prim, sec, render: at => drawFig(at.s, glyph), consistent: at => preds.has(at.s), valid: at => !!at.s, rule });
  }

  // ------------------------------------------------------------ family: shade mixing (column 1 + column 2 = column 3, region by region)
  const SHOPS = {
    max: { f: (a, b) => Math.max(a, b), w: 1.0, d: 'Overlay the two figures; the darker shade wins in every region (white < grey < black).' },
    min: { f: (a, b) => Math.min(a, b), w: 1.25, d: 'Overlay the two figures; the lighter shade wins in every region (white < grey < black).' },
    add: { f: (a, b) => Math.min(2, a + b), w: 1.45, d: 'Shades add up region by region: white adds nothing, grey + grey = black, and black stays black.' },
    sub: { f: (a, b) => Math.max(0, a - b), w: 1.7, d: 'Column 2 is taken away from column 1 region by region (black − grey = grey, grey − grey = white, black − black = white).' },
    diff: { f: (a, b) => Math.abs(a - b), w: 1.85, d: 'Each region shows how different the two shades are: same shade = white, one step apart = grey, white vs black = black.' },
    mod: { f: (a, b) => (a + b) % 3, w: 2.15, d: 'Shades count as white = 0, grey = 1, black = 2 and add up, wrapping round after black: grey + grey = black, grey + black = white, black + black = grey.' },
    bsub: { f: (a, b) => Math.max(0, b - a), w: 1.7, d: '' }, first: { f: a => a, w: 0, d: '' }, second: { f: (a, b) => b, w: 0, d: '' },
  };
  const SHN = ['white', 'grey', 'black'], SHF = [FILLV.white, FILLV.grey, INK];
  function drawShade(v, kind) {
    const st = `stroke="${INK}" stroke-width="${SW}" stroke-linejoin="round"`;
    if (kind === 'half') return `<path d="M50,16 A34,34 0 0 0 50,84 Z" fill="${SHF[v[0]]}" ${st}/><path d="M50,16 A34,34 0 0 1 50,84 Z" fill="${SHF[v[1]]}" ${st}/>`;
    if (kind === 'tri') {
      const P = [[50, 50], [50, 14], [81.2, 68], [18.8, 68]];
      return [[0, 1, 2], [0, 2, 3], [0, 3, 1]].map(([a, b, c], i) => `<path d="M${P[a]} L${P[b]} A36,36 0 0 1 ${P[c]} Z" fill="${SHF[v[i]]}" ${st}/>`).join('');
    }
    const Q = [[18, 18], [50, 18], [18, 50], [50, 50]];
    let o = Q.map(([x, y], i) => `<rect x="${x}" y="${y}" width="32" height="32" fill="${SHF[v[i]]}" ${st}/>`).join('');
    if (kind === 'quadc') o += `<circle cx="50" cy="50" r="11" fill="${SHF[v[4]]}" ${st}/>`;
    return o;
  }
  function genShade(R) {
    const kind = R.hard ? R.pick(['quad', 'quadc']) : R.weighted({ half: 2, tri: 2, quad: 3, quadc: 1 });
    const n = { half: 2, tri: 3, quad: 4, quadc: 5 }[kind];
    const op = R.hard ? R.weighted({ sub: 1, diff: 2, mod: 2, add: 1 }) : R.weighted({ max: 2, min: 1, add: 3, sub: 1, diff: 2, mod: 1 });
    const byCol = R.chance(R.hard ? 0.4 : 0.2);
    const rv = () => Array.from({ length: n }, () => R.int(0, 2));
    const rows = [];
    for (let r = 0; r < 3; r++) {
      let a, b, t = 0;
      do { a = rv(); b = rv(); t++; } while (t < 40 && (String(a) === String(b) || a.every(x => !x) || b.every(x => !x)));
      rows.push([a, b, a.map((x, i) => SHOPS[op].f(x, b[i]))]);
    }
    const g = byCol ? G((r, c) => rows[c][r]) : rows, ans = g[2][2], K = v => v.join('');
    const preds = new Set();
    for (const m of [g, G((r, c) => g[c][r])]) for (const o of Object.values(SHOPS))
      if ([0, 1].every(r => K(m[r][0].map((x, i) => o.f(x, m[r][1][i]))) === K(m[r][2]))) preds.add(K(m[2][0].map((x, i) => o.f(x, m[2][1][i]))));
    if (preds.size !== 1 || !preds.has(K(ans))) return null;
    if (new Set(g.flat().map(K)).size < 7) return null;
    const rule = (byCol ? 'This works down the columns: row 3 is made from rows 1 and 2. ' : 'In every row, column 3 is made from columns 1 and 2. ') + SHOPS[op].d;
    const [x1, x2] = byCol ? [g[0][2], g[1][2]] : [g[2][0], g[2][1]];
    const seen = new Set(preds), alts = [];
    for (const [k, o] of R.shuffle(Object.entries(SHOPS))) {
      if (k === op) continue;
      const v = x1.map((x, i) => o.f(x, x2[i]));
      if (!seen.has(K(v))) { seen.add(K(v)); alts.push({ v, why: `This uses a different shade rule. ${rule}` }); }
    }
    for (let i = 0; alts.length < 2 && i < n; i++) { const v = ans.slice(); v[i] = (v[i] + 1) % 3; if (!seen.has(K(v))) { seen.add(K(v)); alts.push({ v, why: `One region has the wrong shade. ${rule}` }); } }
    if (alts.length < 2) return null;
    const prim = alts.slice(0, 2).map(o => ({ apply: () => ({ v: o.v }), why: o.why }));
    const ri = R.int(0, n - 1), dlt = R.pick([1, 2]);
    const sec = { apply: at => { const v = at.v.slice(); v[ri] = (v[ri] + dlt) % 3; return { v }; }, why: () => `One region has the wrong shade. ${rule}`, join: false };
    const points = 0.85 + SHOPS[op].w + { half: 0, tri: 0.2, quad: 0.35, quadc: 0.6 }[kind] + (byCol ? 0.3 : 0);
    const cells = CELLS.map(([r, c]) => ({ v: g[r][c] }));
    return finish(R, { fam: 'shade', points, cells, ans: { v: ans }, prim, sec, render: at => drawShade(at.v, kind), consistent: at => preds.has(K(at.v)),
      rule: rule + ` Answer: ${ans.map(x => SHN[x]).join(', ')} (${kind === 'half' ? 'left, right' : kind === 'tri' ? 'clockwise from the top' : 'top-left, top-right, bottom-left, bottom-right' + (kind === 'quadc' ? ', centre' : '')}).` });
  }

  // ------------------------------------------------------------ family: dots beside a line (same side adds up, opposite sides cancel)
  const SLN = { v: [[50, 8], [50, 92]], h: [[8, 50], [92, 50]], d1: [[10, 10], [90, 90]], d2: [[90, 10], [10, 90]] };
  const lineSide = (L, x, y) => { const [[x1, y1], [x2, y2]] = SLN[L]; return Math.sign((x2 - x1) * (y - y1) - (y2 - y1) * (x - x1)); };
  const lineDist = (L, x, y) => { const [[x1, y1], [x2, y2]] = SLN[L]; return Math.abs((x2 - x1) * (y - y1) - (y2 - y1) * (x - x1)) / Math.hypot(x2 - x1, y2 - y1); };
  const SGRID = []; for (const x of [17, 30, 43, 57, 70, 83]) for (const y of [17, 30, 43, 57, 70, 83]) SGRID.push([x, y]);
  // Finer grid for the diagonal cross, whose narrow quadrants would otherwise leave too few clear slots.
  const DGRID = []; for (let x = 14; x <= 86; x += 12) for (let y = 14; y <= 86; y += 12) DGRID.push([x, y]);
  // Region names for sign +1 / -1. Single line: side of the line. Cross: pair of opposite quadrants.
  const SIDEN = { v: ['left of the line', 'right of the line'], h: ['below the line', 'above the line'],
    d1: ['below the diagonal', 'above the diagonal'], d2: ['above the diagonal', 'below the diagonal'] };
  const QUADN = { vh: [['bottom-left', 'top-right'], ['top-left', 'bottom-right']], dd: [['left', 'right'], ['bottom', 'top']] };
  const SOPS = {
    sum: [(a, b) => a + b, 'dots on the same side were added up, but dots on opposite sides must cancel each other out'],
    diff: [(a, b) => a - b, 'column 2 was subtracted, but only dots on opposite sides cancel; dots on the same side add up'],
    bdiff: [(a, b) => b - a, 'column 1 was subtracted, but only dots on opposite sides cancel; dots on the same side add up'],
    cnt1: [(a, b) => Math.sign(a) * (Math.abs(a) + Math.abs(b)), 'the dots were simply counted together, but dots on opposite sides cancel each other out'],
    cnt2: [(a, b) => Math.sign(b) * (Math.abs(a) + Math.abs(b)), 'the dots were simply counted together, but dots on opposite sides cancel each other out'],
    cntd: [(a, b) => Math.sign(a) * Math.abs(Math.abs(a) - Math.abs(b)), 'the dots always cancelled, but dots on the same side add up'],
  };
  function signedAttr(R, key, lim, maxIn, byCol, nm, label) {
    for (let t = 0; t < 40; t++) {
      const rows = [0, 1, 2].map(() => { const a = R.int(1, maxIn) * R.pick([1, -1]), b = R.int(1, maxIn) * R.pick([1, -1]); return [a, b, a + b]; });
      if (rows.some(r => Math.abs(r[2]) > lim) || new Set(rows.map(String)).size < 3) continue;
      const g = byCol ? G((r, c) => rows[c][r]) : rows;
      const preds = predict(g, { ordinal: true, arith: true });
      for (const m of [g, G((r, c) => g[c][r])]) for (const [f] of Object.values(SOPS)) if ([0, 1].every(r => f(m[r][0], m[r][1]) === m[r][2])) preds.add(f(m[2][0], m[2][1]));
      const a = g[2][2];
      if (preds.size !== 1 || !preds.has(a)) continue;
      const [x, y] = byCol ? [g[0][2], g[1][2]] : [g[2][0], g[2][1]];
      const text = `${label ? `${cap(label)}: dots in the same quadrant add up and dots in opposite quadrants` : 'Dots on the same side add up and dots on opposite sides'} cancel each other out (${byCol ? 'row 3 = row 1 + row 2' : 'column 3 = column 1 + column 2'}). So ${nm(x)} and ${nm(y)} give ${nm(a)}.`;
      const seen = new Set([a]), alts = [];
      for (const [k, [f, why]] of R.shuffle(Object.entries(SOPS))) {
        const v = f(x, y);
        if (k !== 'sum' && Math.abs(v) <= lim && !seen.has(v)) { seen.add(v); alts.push({ v, why: `Here ${why}. ${text}` }); }
      }
      for (const v of [a + 1, a - 1, -a]) if (Math.abs(v) <= lim && !seen.has(v)) { seen.add(v); alts.push({ v, why: `Count again. ${text}` }); }
      return { key, grid: g, varying: true, w: 1.5, text, alts, preds };
    }
    return null;
  }
  function genSides(R) {
    const quad = R.hard || R.chance(0.3), byCol = R.chance(R.hard ? 0.5 : 0.2);
    const lines = quad ? (R.chance(0.5) ? ['v', 'h'] : ['d1', 'd2']) : [R.pick(['v', 'h', 'd1', 'd2'])];
    const qn = quad && QUADN[lines[0] === 'v' ? 'vh' : 'dd'];
    // slots[pair][sign] = candidate dot positions
    const slots = [0, 1].map(() => ({ 1: [], '-1': [] }));
    for (const [x, y] of (quad && lines[0] === 'd1' ? DGRID : SGRID)) {
      if (lines.some(L => lineDist(L, x, y) < 12)) continue;
      const s1 = lineSide(lines[0], x, y);
      if (!quad) slots[0][s1].push([x, y]);
      else { const s2 = lineSide(lines[1], x, y); slots[s1 === s2 ? 0 : 1][s1].push([x, y]); }
    }
    const capN = Math.min(...slots.slice(0, quad ? 2 : 1).flatMap(p => [p[1].length, p[-1].length]), 6);
    const nmF = p => v => v === 0 ? (quad ? `no dots in the ${qn[p][0]} or ${qn[p][1]} quadrant` : 'no dots') : `${Math.abs(v)} dot${Math.abs(v) > 1 ? 's' : ''} ${quad ? 'in the ' + qn[p][v > 0 ? 0 : 1] + ' quadrant' : SIDEN[lines[0]][v > 0 ? 0 : 1]}`;
    const attrs = [signedAttr(R, 'p', capN, quad ? 3 : 4, byCol, nmF(0), quad ? `${qn[0][0]}/${qn[0][1]} quadrants` : '')];
    if (quad) attrs.push(signedAttr(R, 'q', capN, 3, byCol, nmF(1), `${qn[1][0]}/${qn[1][1]} quadrants`));
    if (attrs.some(a => !a)) return null;
    const zg = G(() => R.int(1, 1e6));
    attrs.push({ key: 'z', grid: zg, varying: false, w: 0, text: '', alts: [], preds: new Set([zg[2][2]]) });
    const pickSlots = (list, n, seed) => { let a = seed >>> 0; const rnd = () => (a = (Math.imul(a, 1664525) + 1013904223) >>> 0) / 4294967296; const b = list.slice(); for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b.slice(0, n); };
    const render = at => lines.map(L => line(...SLN[L][0], ...SLN[L][1], 3)).join('') +
      [at.p, quad ? at.q : 0].flatMap((v, i) => v ? pickSlots(slots[i][Math.sign(v)], Math.abs(v), at.z * (i + 3)) : []).map(([x, y]) => `<circle cx="${x}" cy="${y}" r="4.8" fill="${INK}"/>`).join('');
    const valid = at => Math.abs(at.p) <= capN && (!quad || Math.abs(at.q) <= capN);
    const extra = (lines[0][0] === 'd' ? 0.15 : 0) + (byCol ? 0.3 : 0) + (quad ? -0.2 : 0.25);
    const vary = attrs.filter(a => a.varying), pa = R.pick(vary);
    if (pa.alts.length < 2) return null;
    const ans = Object.fromEntries(attrs.map(a => [a.key, a.grid[2][2]]));
    const prim = R.sample(pa.alts, 2).map(o => ({ apply: at => ({ ...at, [pa.key]: o.v }), why: o.why }));
    const other = vary.find(a => a !== pa);
    let sec;
    if (other && R.chance(0.6)) { const o = R.pick(other.alts); sec = { apply: at => ({ ...at, [other.key]: o.v }), why: () => o.why, join: true }; }
    else {
      const sa = R.pick(vary), d = R.pick([1, -1]);
      sec = { apply: at => ({ ...at, [sa.key]: at[sa.key] + d }), why: () => `Count the dots again. ${sa.text}`, join: false };
    }
    const cells = CELLS.map(([r, c]) => Object.fromEntries(attrs.map(a => [a.key, a.grid[r][c]])));
    const points = vary.reduce((s, a) => s + a.w, 0) + 0.35 * (vary.length - 1) + extra + 0.85;
    return finish(R, { fam: 'sides', points, cells, ans, prim, sec, render, valid, consistent: at => vary.every(a => a.preds.has(at[a.key])),
      rule: vary.map(a => a.text).join(' ') + ` Where the dots sit within their side does not matter. Answer: ${[nmF(0)(ans.p), ...(quad ? [nmF(1)(ans.q)] : [])].join(' and ')}.` });
  }

  const FAMILIES = { single: genSingle, count: genCount, inout: genInOut, move: genMove, dial: genDial, overlay: genOverlay, board: genBoard, fold: genFold, shade: genShade, sides: genSides };
  const FAM_WEIGHT = { single: 1, count: 1.2, inout: 1, move: 1, dial: 0.8, overlay: 1.1, board: 1, fold: 1.3, shade: 1, sides: 1.1 };

  function make(fam, seed, hard = false) {
    try { const it = FAMILIES[fam](Rand(seed, hard)); if (it) it.id = `n:${fam}:${seed}${hard ? ':h' : ''}`; return it; } catch (e) { if (typeof console !== 'undefined') console.error(fam, seed, e); return null; }
  }
  // Generate a fresh item near difficulty `target`, avoiding `avoid` families. `rnd` = Math.random-like.
  function generate(target, { avoid = [], rnd = Math.random, tries = 80, tol = 0.25 } = {}) {
    let best = null;
    const fams = Object.keys(FAMILIES).filter(f => !avoid.includes(f));
    for (let i = 0; i < tries; i++) {
      const tot = fams.reduce((s, f) => s + FAM_WEIGHT[f], 0); let x = rnd() * tot, fam = fams[0];
      for (const f of fams) { if ((x -= FAM_WEIGHT[f]) < 0) { fam = f; break; } }
      const it = make(fam, Math.floor(rnd() * 2 ** 31), target > 1 && i % 2 === 1);
      if (!it) continue;
      if (!best || Math.abs(it.b - target) < Math.abs(best.b - target)) best = it;
      if (Math.abs(best.b - target) <= tol) break;
    }
    return best;
  }
  const fromId = id => { const [, fam, seed, h] = id.split(':'); return make(fam, +seed, h === 'h'); };
  return { make, fromId, generate, FAMILIES: Object.keys(FAMILIES), predict };
})();
if (typeof module !== 'undefined') module.exports = ENGINE;
