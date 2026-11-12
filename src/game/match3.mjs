/**
 * 3-lü uyğunlaşdırma oyununun mühərriki — təmiz, deterministik, DOM-suz.
 *
 * EYNİ FAYL serverdədir: `UniPOS Node JS Api/src/game/match3.mjs`. Server raundu seed + gedişlərlə yenidən
 * oynayıb xalı özü hesablayır (`replay`) — klientin göndərdiyi xala inanılmır. İki nüsxə fərqlənsə klientin
 * gördüyü xal serverin hesabladığından fərqli olar və raund rədd edilər. Dəyişəndə hər ikisini yenilə
 * (`ENGINE_VERSION`-u artır — server köhnə versiyalı raundu rədd edir).
 *
 * Determinizm: Math.random, Date, Set/Map sırası kimi şeylər nəticəyə təsir etmir. Bütün təsadüf `sfc32`
 * (32-bit tam ədəd əməliyyatları — hər JS mühərrikində eyni) seed-dən gəlir, sıra sabitdir.
 *
 * Xana: { id, k, s } — k: növ (0..kinds-1; rəngli bomba üçün ANY), s: xüsusi növ (SP).
 * Gediş: [r1, c1, r2, c2] — qonşu iki xananın yerdəyişməsi.
 */

export const ENGINE_VERSION = 1;

export const SP = { NONE: 0, ROW: 1, COL: 2, BOMB: 3, COLOR: 4 };
export const ANY = 99;

export const DEFAULTS = { w: 8, h: 8, kinds: 6, moves: 20 };

const MAX_CASCADES = 60;
const BASE = 20; // hər silinən xana
const CREATE_BONUS = { [SP.ROW]: 60, [SP.COL]: 60, [SP.BOMB]: 120, [SP.COLOR]: 200 };
const COMBO_BONUS = 300;

// ── RNG ──────────────────────────────────────────────────────────────────────

function cyrb128(str) {
    let h1 = 1779033703, h2 = 3144134277, h3 = 1013904242, h4 = 2773480762;
    for (let i = 0; i < str.length; i++) {
        const k = str.charCodeAt(i);
        h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
        h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
        h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
        h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
    }
    h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
    h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
    h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
    h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
    h1 ^= h2 ^ h3 ^ h4; h2 ^= h1; h3 ^= h1; h4 ^= h1;
    return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0];
}

/** sfc32 — vəziyyət 4 ədədlik massivdir (state.rng), yerində dəyişir */
function next(rng) {
    let [a, b, c, d] = rng;
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    rng[0] = a; rng[1] = b; rng[2] = c; rng[3] = d;
    return t >>> 0;
}

const randInt = (rng, n) => next(rng) % n;

// ── Köməkçilər ───────────────────────────────────────────────────────────────

const idx = (st, r, c) => r * st.w + c;
const rowOf = (st, i) => Math.floor(i / st.w);
const colOf = (st, i) => i % st.w;
const inside = (st, r, c) => r >= 0 && c >= 0 && r < st.h && c < st.w;

function clone(st) {
    return { ...st, rng: st.rng.slice(), cells: st.cells.map((x) => (x ? { ...x } : null)) };
}

function spawn(st, k = null) {
    return { id: st.nextId++, k: k === null ? randInt(st.rng, st.kinds) : k, s: SP.NONE };
}

/** Rəngli bomba heç nə ilə uyğunlaşmır */
const matchKind = (cell) => (cell && cell.s !== SP.COLOR ? cell.k : -1);

// ── Uyğunluq axtarışı ────────────────────────────────────────────────────────

/**
 * Bütün ≥3 sıraları tapır və kəsişənləri bir qrupa birləşdirir (L / T formaları).
 * @returns {{ cells: number[], runs: { dir: 'h'|'v', cells: number[] }[] }[]}
 */
function findGroups(st) {
    const runs = [];
    for (let r = 0; r < st.h; r++) {
        let c = 0;
        while (c < st.w) {
            const k = matchKind(st.cells[idx(st, r, c)]);
            let e = c + 1;
            while (k >= 0 && e < st.w && matchKind(st.cells[idx(st, r, e)]) === k) e++;
            if (k >= 0 && e - c >= 3) {
                const cells = [];
                for (let x = c; x < e; x++) cells.push(idx(st, r, x));
                runs.push({ dir: 'h', cells });
            }
            c = e;
        }
    }
    for (let c = 0; c < st.w; c++) {
        let r = 0;
        while (r < st.h) {
            const k = matchKind(st.cells[idx(st, r, c)]);
            let e = r + 1;
            while (k >= 0 && e < st.h && matchKind(st.cells[idx(st, e, c)]) === k) e++;
            if (k >= 0 && e - r >= 3) {
                const cells = [];
                for (let y = r; y < e; y++) cells.push(idx(st, y, c));
                runs.push({ dir: 'v', cells });
            }
            r = e;
        }
    }
    if (!runs.length) return [];

    // union-find: ortaq xanası olan sıralar bir qrupdur
    const parent = runs.map((_, i) => i);
    const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    const owner = new Array(st.w * st.h).fill(-1);
    runs.forEach((run, i) => {
        for (const cell of run.cells) {
            if (owner[cell] >= 0) parent[find(i)] = find(owner[cell]);
            else owner[cell] = i;
        }
    });
    const byRoot = new Map();
    runs.forEach((run, i) => {
        const root = find(i);
        if (!byRoot.has(root)) byRoot.set(root, { runs: [], set: new Set() });
        const g = byRoot.get(root);
        g.runs.push(run);
        run.cells.forEach((x) => g.set.add(x));
    });
    return [...byRoot.values()]
        .map((g) => ({ runs: g.runs, cells: [...g.set].sort((a, b) => a - b) }))
        .sort((a, b) => a.cells[0] - b.cells[0]);
}

/** Qrupdan hansı xüsusi daş yaranır və harada */
function specialFor(st, group, preferred) {
    const h = group.runs.filter((r) => r.dir === 'h');
    const v = group.runs.filter((r) => r.dir === 'v');
    const longest = group.runs.reduce((a, b) => (b.cells.length > a.cells.length ? b : a));
    let s = SP.NONE;
    if (longest.cells.length >= 5) s = SP.COLOR;
    else if (h.length && v.length) s = SP.BOMB;
    else if (longest.cells.length === 4) s = longest.dir === 'h' ? SP.COL : SP.ROW;
    if (s === SP.NONE) return null;

    const free = (i) => st.cells[i] && st.cells[i].s === SP.NONE;
    let at = -1;
    for (const p of preferred) if (group.cells.includes(p) && free(p)) { at = p; break; }
    if (at < 0 && s === SP.BOMB) {
        // L / T — kəsişmə nöqtəsi
        const hs = new Set(h.flatMap((r) => r.cells));
        at = v.flatMap((r) => r.cells).find((i) => hs.has(i) && free(i)) ?? -1;
    }
    if (at < 0) {
        const mid = longest.cells[Math.floor((longest.cells.length - 1) / 2)];
        at = free(mid) ? mid : group.cells.find(free) ?? -1;
    }
    if (at < 0) return null;
    return { at, s, k: s === SP.COLOR ? ANY : st.cells[at].k };
}

// ── Effektlər ────────────────────────────────────────────────────────────────

function mostCommonKind(st, skip) {
    const count = new Array(st.kinds).fill(0);
    st.cells.forEach((cell, i) => {
        if (cell && cell.s !== SP.COLOR && !skip.has(i)) count[cell.k]++;
    });
    let best = 0;
    for (let k = 1; k < st.kinds; k++) if (count[k] > count[best]) best = k;
    return best;
}

function area(st, i, cell, cleared) {
    const r = rowOf(st, i), c = colOf(st, i);
    const out = [];
    if (cell.s === SP.ROW) for (let x = 0; x < st.w; x++) out.push(idx(st, r, x));
    else if (cell.s === SP.COL) for (let y = 0; y < st.h; y++) out.push(idx(st, y, c));
    else if (cell.s === SP.BOMB) {
        for (let y = r - 1; y <= r + 1; y++) for (let x = c - 1; x <= c + 1; x++) if (inside(st, y, x)) out.push(idx(st, y, x));
    } else if (cell.s === SP.COLOR) {
        const k = mostCommonKind(st, cleared);
        st.cells.forEach((other, j) => { if (other && other.s !== SP.COLOR && other.k === k) out.push(j); });
        return { cells: out, fx: { t: 'color', r, c, k } };
    }
    const t = cell.s === SP.ROW ? 'row' : cell.s === SP.COL ? 'col' : 'bomb';
    return { cells: out, fx: { t, r, c } };
}

/**
 * `start` xanalarını silir; içlərindəki xüsusi daşlar zəncirvari işə düşür.
 * `protect` — yeni yaranan xüsusi daşların yeri (bu addımda silinmir).
 */
function detonate(st, start, protect, fx, alreadyTriggered = new Set()) {
    const cleared = new Set();
    const queue = [];
    const add = (i) => {
        if (protect.has(i) || cleared.has(i) || !st.cells[i]) return;
        cleared.add(i);
        if (st.cells[i].s !== SP.NONE && !alreadyTriggered.has(i)) queue.push(i);
    };
    start.forEach(add);
    while (queue.length) {
        const i = queue.shift();
        if (alreadyTriggered.has(i)) continue;
        alreadyTriggered.add(i);
        const hit = area(st, i, st.cells[i], cleared);
        fx.push(hit.fx);
        hit.cells.forEach(add);
    }
    return cleared;
}

function removeCells(st, cleared) {
    const out = [];
    [...cleared].sort((a, b) => a - b).forEach((i) => {
        const cell = st.cells[i];
        out.push({ id: cell.id, r: rowOf(st, i), c: colOf(st, i), k: cell.k, s: cell.s });
        st.cells[i] = null;
    });
    return out;
}

/** Cazibə + doldurma. Yeni daşlar yuxarıdan, seed-in təsadüfü ilə */
function gravity(st) {
    const falls = [];
    const spawned = [];
    for (let c = 0; c < st.w; c++) {
        let write = st.h - 1;
        for (let r = st.h - 1; r >= 0; r--) {
            const cell = st.cells[idx(st, r, c)];
            if (!cell) continue;
            if (write !== r) {
                st.cells[idx(st, write, c)] = cell;
                st.cells[idx(st, r, c)] = null;
                falls.push({ id: cell.id, r: write, c, from: r });
            }
            write--;
        }
        const missing = write + 1;
        for (let r = write; r >= 0; r--) {
            const cell = spawn(st);
            st.cells[idx(st, r, c)] = cell;
            spawned.push({ id: cell.id, r, c, k: cell.k, s: cell.s, from: r - missing });
        }
    }
    return { t: 'fall', falls, spawned };
}

// ── Mümkün gedişlər ──────────────────────────────────────────────────────────

function swapCells(st, a, b) {
    const t = st.cells[a];
    st.cells[a] = st.cells[b];
    st.cells[b] = t;
}

function lineLen(st, r, c, k, dr, dc) {
    let n = 0;
    let y = r + dr, x = c + dc;
    while (inside(st, y, x) && matchKind(st.cells[idx(st, y, x)]) === k) { n++; y += dr; x += dc; }
    return n;
}

/** Xanada (r,c) uyğunluq yaranırmı və nə qədər güclü (ipucu üçün çəki) */
function strengthAt(st, r, c) {
    const k = matchKind(st.cells[idx(st, r, c)]);
    if (k < 0) return 0;
    const h = 1 + lineLen(st, r, c, k, 0, -1) + lineLen(st, r, c, k, 0, 1);
    const v = 1 + lineLen(st, r, c, k, -1, 0) + lineLen(st, r, c, k, 1, 0);
    if (h < 3 && v < 3) return 0;
    if (h >= 5 || v >= 5) return 50;
    if (h >= 3 && v >= 3) return 30;
    if (h === 4 || v === 4) return 20;
    return 10;
}

function isSpecial(cell) {
    return cell && cell.s !== SP.NONE;
}

/** Bütün etibarlı gedişlər, ən güclüsü əvvəl. Gediş = [r1, c1, r2, c2] */
export function findMoves(st) {
    const out = [];
    const work = clone(st);
    for (let r = 0; r < st.h; r++) {
        for (let c = 0; c < st.w; c++) {
            for (const [dr, dc] of [[0, 1], [1, 0]]) {
                const r2 = r + dr, c2 = c + dc;
                if (!inside(st, r2, c2)) continue;
                const a = idx(st, r, c), b = idx(st, r2, c2);
                const A = st.cells[a], B = st.cells[b];
                if (!A || !B) continue;
                let w = 0;
                if (A.s === SP.COLOR || B.s === SP.COLOR) w = 60;
                else if (isSpecial(A) && isSpecial(B)) w = 55;
                else {
                    swapCells(work, a, b);
                    w = Math.max(strengthAt(work, r, c), strengthAt(work, r2, c2));
                    swapCells(work, a, b);
                }
                if (w > 0) out.push({ move: [r, c, r2, c2], w });
            }
        }
    }
    return out.sort((x, y) => y.w - x.w).map((m) => m.move);
}

export const hasMoves = (st) => findMoves(st).length > 0;

function shuffle(st) {
    for (let attempt = 0; attempt < 200; attempt++) {
        const pool = st.cells.slice();
        for (let i = pool.length - 1; i > 0; i--) {
            const j = randInt(st.rng, i + 1);
            [pool[i], pool[j]] = [pool[j], pool[i]];
        }
        st.cells = pool;
        if (!findGroups(st).length && hasMoves(st)) return;
    }
    // Çox nadir: daşları yenidən boya
    fill(st, true);
}

/** Uyğunluqsuz və ən azı bir gedişi olan taxta */
function fill(st, keepIds = false) {
    for (let attempt = 0; attempt < 500; attempt++) {
        for (let r = 0; r < st.h; r++) {
            for (let c = 0; c < st.w; c++) {
                const i = idx(st, r, c);
                let k;
                do {
                    k = randInt(st.rng, st.kinds);
                } while (
                    (c >= 2 && st.cells[idx(st, r, c - 1)]?.k === k && st.cells[idx(st, r, c - 2)]?.k === k) ||
                    (r >= 2 && st.cells[idx(st, r - 1, c)]?.k === k && st.cells[idx(st, r - 2, c)]?.k === k)
                );
                const old = st.cells[i];
                st.cells[i] = keepIds && old ? { id: old.id, k, s: SP.NONE } : spawn(st, k);
            }
        }
        if (hasMoves(st)) return;
    }
}

// ── API ──────────────────────────────────────────────────────────────────────

export function createGame(seed, opts = {}) {
    const o = { ...DEFAULTS, ...opts };
    const st = {
        v: ENGINE_VERSION,
        w: o.w, h: o.h, kinds: o.kinds,
        cells: new Array(o.w * o.h).fill(null),
        rng: cyrb128(String(seed)),
        nextId: 1,
        score: 0,
        movesLeft: o.moves,
        movesMade: 0,
        best: { cascade: 0, specials: 0 },
    };
    for (let i = 0; i < 12; i++) next(st.rng); // seed-in ilk dəyərləri zəif qarışır
    fill(st);
    return st;
}

/** Xüsusi + xüsusi (və ya rəngli bomba + istənilən) — gediş özü partlayış başladır */
function comboStart(st, a, b, fx) {
    const A = st.cells[a], B = st.cells[b];
    const r = rowOf(st, b), c = colOf(st, b);
    const triggered = new Set([a, b]);
    const start = new Set([a, b]);

    if (A.s === SP.COLOR || B.s === SP.COLOR) {
        const other = A.s === SP.COLOR ? B : A;
        if (other.s === SP.COLOR) {
            st.cells.forEach((_, i) => start.add(i));
            fx.push({ t: 'nuke', r, c });
            return detonate(st, start, new Set(), fx, triggered);
        }
        const k = other.k;
        const targets = [];
        st.cells.forEach((cell, i) => { if (cell && cell.s !== SP.COLOR && cell.k === k && i !== a && i !== b) targets.push(i); });
        fx.push({ t: 'color', r, c, k });
        if (other.s === SP.ROW || other.s === SP.COL || other.s === SP.BOMB) {
            // həmin növün hamısı xüsusiyə çevrilir və partlayır
            for (const i of targets) {
                if (st.cells[i].s === SP.NONE) {
                    st.cells[i].s = other.s === SP.BOMB ? SP.BOMB : randInt(st.rng, 2) ? SP.ROW : SP.COL;
                }
            }
            fx.push({ t: 'convert', k, s: other.s, cells: targets.map((i) => ({ id: st.cells[i].id, s: st.cells[i].s })) });
        }
        targets.forEach((i) => start.add(i));
        return detonate(st, start, new Set(), fx, triggered);
    }

    const lines = (rows, cols) => {
        for (const y of rows) if (y >= 0 && y < st.h) { for (let x = 0; x < st.w; x++) start.add(idx(st, y, x)); fx.push({ t: 'row', r: y, c }); }
        for (const x of cols) if (x >= 0 && x < st.w) { for (let y = 0; y < st.h; y++) start.add(idx(st, y, x)); fx.push({ t: 'col', r, c: x }); }
    };
    const kinds = [A.s, B.s];
    const stripe = (s) => s === SP.ROW || s === SP.COL;
    if (stripe(kinds[0]) && stripe(kinds[1])) {
        lines([r], [c]);
    } else if (kinds.includes(SP.BOMB) && (stripe(kinds[0]) || stripe(kinds[1]))) {
        lines([r - 1, r, r + 1], [c - 1, c, c + 1]);
    } else {
        // bomba + bomba — 5×5
        for (let y = r - 2; y <= r + 2; y++) for (let x = c - 2; x <= c + 2; x++) if (inside(st, y, x)) start.add(idx(st, y, x));
        fx.push({ t: 'bigbomb', r, c });
    }
    return detonate(st, start, new Set(), fx, triggered);
}

/**
 * Gediş. Etibarsızdırsa { ok: false } (gediş sayılmır, vəziyyət dəyişmir).
 * Etibarlıdırsa yeni vəziyyət + animasiya addımları:
 *   { t: 'swap', a, b } → [{ t: 'clear', cells, created, fx, gain, cascade } → { t: 'fall', falls, spawned }]* → { t: 'shuffle', cells }?
 */
export function applyMove(prev, move) {
    if (!prev || prev.movesLeft <= 0) return { ok: false, reason: 'over' };
    if (!Array.isArray(move) || move.length !== 4 || !move.every(Number.isInteger)) return { ok: false, reason: 'bad' };
    const [r1, c1, r2, c2] = move;
    if (!inside(prev, r1, c1) || !inside(prev, r2, c2) || Math.abs(r1 - r2) + Math.abs(c1 - c2) !== 1) {
        return { ok: false, reason: 'bad' };
    }
    const st = clone(prev);
    const a = idx(st, r1, c1), b = idx(st, r2, c2);
    const A = st.cells[a], B = st.cells[b];
    if (!A || !B) return { ok: false, reason: 'bad' };

    const steps = [{ t: 'swap', a: [r1, c1, A.id], b: [r2, c2, B.id] }];
    let gainedTotal = 0;
    const combo = A.s === SP.COLOR || B.s === SP.COLOR || (isSpecial(A) && isSpecial(B));

    swapCells(st, a, b);
    let cascade = 1;

    if (combo) {
        const fx = [];
        const cleared = comboStart(st, a, b, fx); // mərkəz — b (A-nın çəkildiyi yer)
        const gain = cleared.size * BASE + COMBO_BONUS;
        gainedTotal += gain;
        steps.push({ t: 'clear', cells: removeCells(st, cleared), created: [], fx, gain, cascade });
        steps.push(gravity(st));
        cascade++;
        st.best.specials++;
    } else if (!findGroups(st).length) {
        return { ok: false, reason: 'nomatch' };
    }

    const preferred = [b, a];
    for (let guard = 0; guard < MAX_CASCADES; guard++) {
        const groups = findGroups(st);
        if (!groups.length) break;
        const start = new Set();
        const created = [];
        const protect = new Set();
        for (const g of groups) {
            const sp = specialFor(st, g, cascade === 1 ? preferred : []);
            if (sp) {
                created.push(sp);
                protect.add(sp.at);
            }
            g.cells.forEach((i) => start.add(i));
        }
        const fx = [];
        // Yeni xüsusi daşın yerindəki köhnə daş da silinir (yerinə xüsusi gəlir), amma partlayış onu tutmur
        const cleared = detonate(st, start, protect, fx);
        const removed = removeCells(st, cleared);
        const madeCells = created.map((sp) => {
            const old = st.cells[sp.at];
            removed.push({ id: old.id, r: rowOf(st, sp.at), c: colOf(st, sp.at), k: old.k, s: old.s, into: true });
            const cell = { id: st.nextId++, k: sp.k, s: sp.s };
            st.cells[sp.at] = cell;
            return { id: cell.id, r: rowOf(st, sp.at), c: colOf(st, sp.at), k: cell.k, s: cell.s, from: old.id };
        });
        let gain = (cleared.size + created.length) * BASE * cascade;
        for (const sp of created) gain += CREATE_BONUS[sp.s] * cascade;
        gainedTotal += gain;
        st.best.specials += created.length;
        steps.push({ t: 'clear', cells: removed, created: madeCells, fx, gain, cascade });
        steps.push(gravity(st));
        cascade++;
    }
    st.best.cascade = Math.max(st.best.cascade, cascade - 1);

    if (!hasMoves(st)) {
        shuffle(st);
        steps.push({ t: 'shuffle', cells: st.cells.map((x, i) => ({ id: x.id, r: rowOf(st, i), c: colOf(st, i), k: x.k, s: x.s })) });
    }

    st.score += gainedTotal;
    st.movesLeft -= 1;
    st.movesMade += 1;
    return { ok: true, state: st, steps, gain: gainedTotal };
}

/**
 * Server tərəfi: raundu baştan oynayır. Hər gediş etibarlı olmalıdır (klient etibarsız gedişi göndərmir).
 * @returns {{ ok: true, score, moves, cascade, specials } | { ok: false, error, at? }}
 */
export function replay(seed, opts, moves) {
    if (!Array.isArray(moves)) return { ok: false, error: 'bad_moves' };
    let st = createGame(seed, opts);
    if (moves.length > st.movesLeft) return { ok: false, error: 'too_many_moves' };
    for (let i = 0; i < moves.length; i++) {
        const res = applyMove(st, moves[i]);
        if (!res.ok) return { ok: false, error: 'invalid_move', at: i };
        st = res.state;
    }
    return { ok: true, score: st.score, moves: st.movesMade, cascade: st.best.cascade, specials: st.best.specials };
}

/** Taxtanı ekrana vermək üçün: [{ id, r, c, k, s }] */
export function tiles(st) {
    return st.cells.map((x, i) => ({ id: x.id, r: rowOf(st, i), c: colOf(st, i), k: x.k, s: x.s }));
}
