// In-browser award engine (run on a https://statsapi.mlb.com tab). Mirrors awards.py run(): for each candidate, sum his
// game logs over each week window, swap them for a replacement-level line over the same AB / outs in his team's Yahoo week,
// re-score the matchup and add up categories and matchups swung. Usage: await AWE.run(jobUrl); AWE.S; AWE.out (JSON-able).
window.AWE = (() => {
  const S = {state: 'idle', n: 0, total: 0, err: ''}, out = {};
  const ip2outs = ip => { const [a, b] = String(ip || '0').split('.'); return 3 * (+a || 0) + (+b || 0); };
  async function j(u) { for (let i = 0; i < 6; i++) { try { const r = await fetch(u); if (r.ok) return r.json(); } catch (e) {} await new Promise(r => setTimeout(r, 2000 * (i + 1))); } throw new Error('fetch ' + u); }
  const r3 = x => Math.round(x * 1000) / 1000, r2 = x => Math.round(x * 100) / 100;
  const pyround = x => { const f = Math.floor(x), d = x - f; if (Math.abs(d - 0.5) < 1e-9) return f % 2 === 0 ? f : f + 1; return Math.round(x); };   // Python round(): half to even
  function cats(t) {
    const ip = t.OUTS / 3, obpd = t.AB + t.BB + t.HBP + t.SF;
    return {R: t.R, H: t.H, HR: t.HR, RBI: t.RBI, SB: t.SB, BB: t.BB, K: t.K,
      AVG: t.AB ? r3(t.H / t.AB) : 0, OBP: obpd ? r3((t.H + t.BB + t.HBP) / obpd) : 0, IP: t.OUTS, W: t.W, L: t.L, SV: t.SV, HLD: t.HLD,
      pH: t.pH, pBB: t.pBB, pK: t.pK, ERA: ip ? r2(9 * t.ER / ip) : 99, WHIP: ip ? r2((t.pH + t.pBB) / ip) : 99, K9: ip ? r2(9 * t.pK / ip) : 0, BSV: t.BSV, SVH: t.SVH};
  }
  const HIT = new Set(['R', 'H', 'HR', 'RBI', 'SB', 'BB', 'K', 'AVG', 'OBP']);
  function score(a, b, ipmin, keys, low) {
    const ca = cats(a), cb = cats(b); let w = 0, l = 0, t = 0; const sa = a.OUTS < ipmin, sb = b.OUTS < ipmin;
    for (const c of keys) {
      if (!HIT.has(c) && c !== 'IP' && (sa || sb)) { if (sa && sb) t++; else if (sa) l++; else w++; continue; }
      let x = ca[c], y = cb[c]; if (low.has(c)) { x = -x; y = -y; }
      if (x > y) w++; else if (x < y) l++; else t++;
    }
    return [w, l, t];
  }
  function sub(team, g, x, Rh, Rp) {
    const t = Object.assign({}, team);
    if (g === 'h') {
      const [ab, r, h, hr, rbi, sb, bb, k, hbp, sf] = x;
      [['AB', ab], ['R', r], ['H', h], ['HR', hr], ['RBI', rbi], ['SB', sb], ['BB', bb], ['K', k], ['HBP', hbp], ['SF', sf]].forEach(([f, v]) => t[f] -= v);
      const ok = t.AB >= 0 && t.H >= 0 && t.HR >= 0 && t.R >= 0 && t.RBI >= 0 && t.BB >= 0 && t.K >= 0;
      for (const f of ['R', 'H', 'HR', 'RBI', 'SB', 'BB', 'K', 'HBP', 'SF']) t[f] += pyround((Rh[f] || 0) * ab);
      t.AB += ab; return ok ? t : null;
    }
    const [outs, w, sv, bb, k, hld, er, h, bsv, lo] = x;
    [['OUTS', outs], ['W', w], ['L', lo], ['SV', sv], ['HLD', hld], ['pBB', bb], ['pK', k], ['ER', er], ['pH', h], ['BSV', bsv], ['SVH', sv + hld]].forEach(([f, v]) => t[f] -= v);
    const ok = t.OUTS >= 0 && t.W >= 0 && t.pK >= 0 && t.pH >= 0 && t.pBB >= 0 && t.SVH >= 0 && t.ER >= 0 && t.SV >= 0 && t.HLD >= 0;
    for (const [f, src] of [['W', 'W'], ['L', 'W'], ['SV', 'SV'], ['HLD', 'HLD'], ['pBB', 'BB'], ['pK', 'K'], ['ER', 'ER'], ['pH', 'H'], ['BSV', 'BSV']]) t[f] += pyround((Rp[src] || 0) * outs);
    t.SVH += pyround(((Rp.SV || 0) + (Rp.HLD || 0)) * outs); t.OUTS += outs; return ok ? t : null;
  }
  const H = s => [s.atBats, s.runs, s.hits, s.homeRuns, s.rbi, s.stolenBases, s.baseOnBalls, s.strikeOuts, s.hitByPitch, s.sacFlies];
  const P = s => [ip2outs(s.inningsPitched), s.wins, s.saves, s.baseOnBalls, s.strikeOuts, s.holds, s.earnedRuns, s.hits, s.blownSaves, s.losses];
  async function run(url) {
    S.state = 'running';
    try {
      const job = await j(url), F = job.F; S.total = job.c.length;
      const toObj = arr => { const o = {}; F.forEach((f, i) => o[f] = arr[i]); return o; };
      for (const [pid, mid, Y, g, win] of job.c) {
        const Yd = job.y[Y], low = new Set(Yd.low);
        const d = await j(`/api/v1/people/${mid}/stats?stats=gameLog&group=${g === 'h' ? 'hitting' : 'pitching'}&season=${Y}&sportId=1`);
        const games = (d.stats[0] || {splits: []}).splits; let sw = 0, msw = 0, weeks = 0, benched = 0;
        for (const [L, R, wi, tid] of win) {
          const tot = new Array(g === 'h' ? 10 : 10).fill(0); let gp = 0;
          for (const x of games) if (x.date >= L && x.date <= R) { gp++; (g === 'h' ? H : P)(x.stat).forEach((v, i) => tot[i] += (+v || 0)); }
          if (!gp) continue;
          const key = wi + '_' + tid; if (!Yd.lines[key]) continue;
          const [tl, oppTid] = Yd.lines[key], team = toObj(tl), opp = toObj(Yd.lines[wi + '_' + oppTid][0]);
          const t2 = sub(team, g, tot, Yd.rh, Yd.rp); if (!t2) { benched++; continue; }
          const ipm = Yd.ipmin[wi - 1], b0 = score(team, opp, ipm, Yd.keys, low), nw = score(t2, opp, ipm, Yd.keys, low), wt = wi > Yd.reg ? 1.5 : 1;
          sw += wt * ((b0[0] - nw[0]) + (nw[1] - b0[1])) / 2;
          const res = r => (r[0] > r[1]) - (r[0] < r[1]); msw += wt * (res(b0) - res(nw)) / 2; weeks++;
        }
        out[pid + '|' + Y] = [r2(sw), r2(msw), weeks, benched]; S.n++;
      }
      S.state = 'done';
    } catch (e) { S.state = 'error'; S.err = String(e && e.message || e); }
  }
  return {S, out, run};
})();
'engine loaded';
