/**
 * reflowSim.test.ts — runs the realignment scenario grid through the REAL engine
 * and renders a visual report (HTML) grading each on mileage / quality / long /
 * safety. Run: `npx jest reflowSim` — then open the printed report path.
 *
 * It also acts as a light guard: every scenario must run without throwing and be
 * graded. It does NOT fail on a 'bad' verdict — surfacing those is the point.
 */
import { writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { runAll, SCENARIOS, DATES, DOW, toMi, type Level } from '../__sim__/reflowSim';

const REPORT_PATH = process.env.REFLOW_SIM_OUT || join(tmpdir(), 'reflow-sim.html');

const TYPE_COLOR: Record<string, string> = { easy: '#4FB477', quality: '#FF5C7A', long: '#45C0E6', rest: '#5b636e' };
const LEVEL_COLOR: Record<Level, string> = { ok: '#4FB477', warn: '#F0883E', bad: '#FF5C7A', na: '#5b636e' };
const LEVEL_ICON: Record<Level, string> = { ok: '✓', warn: '!', bad: '✗', na: '–' };

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

test('realignment scenario grid — runs, grades, and writes the HTML report', () => {
  const results = runAll();
  expect(results.length).toBe(SCENARIOS.length);

  const tally = { ok: 0, warn: 0, bad: 0, na: 0 } as Record<Level, number>;
  for (const r of results) for (const v of [r.grade.mileage, r.grade.quality, r.grade.long, r.grade.safety]) tally[v.level]++;

  const rows = results
    .map(({ built, grade }) => {
      const s = built.scenario;
      // The plan week strip (Mon..Sun): type dot + planned mi, today marked,
      // past days show logged (green) or "miss" (red) vs planned.
      const week = s.days
        .map((d, i) => {
          const past = i < s.todayIdx;
          const logged = s.logged[i];
          const missed = past && d.type !== 'rest' && !logged;
          const state = i === s.todayIdx ? 'today' : missed ? 'miss' : past ? 'done' : 'ahead';
          const sub =
            d.type === 'rest' ? 'rest' : past ? (missed ? 'miss' : `${logged}✓`) : `${d.mi}`;
          return `<div class="wd ${state}"><span class="dow">${DOW[i]}</span>
            <span class="pl" style="color:${d.type === 'rest' ? '#5b636e' : '#c8ced6'}">${d.type === 'rest' ? '—' : d.mi}</span>
            <span class="pip" style="background:${TYPE_COLOR[d.type]}"></span>
            <span class="sub ${missed ? 'm' : ''}">${sub}</span></div>`;
        })
        .join('');

      // reflowStrip.ts was dropped in the extraction (MISSING.md §1); the sim's
      // HTML report notes a reflow instead of rendering the before/after strip.
      const strip = grade.reflow
        ? '<span class="none">reflow proposed (strip rendering not extracted)</span>'
        : '<span class="none">no reflow proposed</span>';

      const badge = (label: string, v: { level: Level; text: string }) =>
        `<div class="bd"><span class="bi" style="background:${LEVEL_COLOR[v.level]}">${LEVEL_ICON[v.level]}</span>
          <div><b>${label}</b><span>${esc(v.text)}</span></div></div>`;

      return `<div class="card">
        <div class="ch"><h3>${esc(s.name)}</h3><span class="grp">${s.group}</span></div>
        <p class="note">${esc(s.note)} <span class="tgt">target ${toMi(built.targetMeters)} mi · today ${DOW[s.todayIdx]}</span></p>
        <div class="wk">${week}</div>
        ${strip}
        <div class="grades">
          ${badge('Mileage', grade.mileage)}${badge('Quality', grade.quality)}
          ${badge('Long', grade.long)}${badge('Safety', grade.safety)}
        </div>
      </div>`;
    })
    .join('\n');

  const html = `<style>
    :root{--bg:#0E0D17;--card:#14121F;--line:rgba(255,255,255,.08);--ink:#fff;--mute:#A9A5BF;--faint:#6F6B87}
    *{box-sizing:border-box}
    body{margin:0;background:#05070a;color:var(--ink);font-family:-apple-system,'SF Pro Text','Segoe UI',sans-serif;padding:28px 22px 60px}
    h1{font-size:20px;font-weight:800;margin:0 0 4px}
    .lede{color:var(--mute);font-size:13px;max-width:820px;line-height:1.5;margin:0 0 18px}
    .sum{display:flex;gap:10px;margin:0 0 26px;flex-wrap:wrap}
    .sc{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:8px 14px;font-size:13px;font-weight:700}
    .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(430px,1fr));gap:16px}
    .card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:14px 16px}
    .ch{display:flex;align-items:center;gap:8px}
    h3{font-size:15px;font-weight:800;margin:0}
    .grp{font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.5px;color:var(--faint);border:1px solid var(--line);border-radius:6px;padding:2px 7px}
    .note{color:var(--faint);font-size:12px;line-height:1.45;margin:6px 0 12px}
    .tgt{color:var(--mute);font-weight:700}
    .wk{display:flex;gap:4px;margin-bottom:12px}
    .wd{flex:1;text-align:center;padding:6px 0;border-radius:8px;background:rgba(255,255,255,.02)}
    .wd.today{background:rgba(255,201,60,.12);box-shadow:inset 0 0 0 1px rgba(255,201,60,.35)}
    .wd.miss{background:rgba(255,92,122,.09)}
    .dow{display:block;font-size:9px;font-weight:800;color:var(--faint);text-transform:uppercase}
    .pl{display:block;font-size:15px;font-weight:800;font-variant-numeric:tabular-nums;margin-top:2px}
    .pip{display:block;width:5px;height:5px;border-radius:3px;margin:3px auto 0}
    .sub{display:block;font-size:9px;font-weight:700;color:var(--mute);margin-top:3px}
    .sub.m{color:#FF5C7A}
    .strip{background:rgba(255,255,255,.02);border-radius:10px;padding:8px 10px;margin-bottom:12px}
    .strip .row{display:flex;align-items:center}
    .strip .row b{width:34px;flex:0 0 34px;font-size:9px;font-weight:800;text-transform:uppercase;color:var(--faint)}
    .strip .row.hd b{color:transparent}
    .strip .c{flex:1;text-align:center;font-size:13px;font-weight:800;font-variant-numeric:tabular-nums;padding:3px 0;position:relative}
    .strip .row.hd .c{font-size:9px;font-weight:800;color:var(--faint);text-transform:uppercase}
    .strip .c.dim{color:var(--faint)}
    .strip .c.dim2{opacity:.45}
    .strip .c.chg{color:#fff;background:#1E242C;border-radius:6px}
    .strip .c i{display:block;width:5px;height:5px;border-radius:3px;margin:3px auto 0}
    .none{color:var(--faint);font-size:12px;font-style:italic}
    .grades{display:grid;grid-template-columns:1fr 1fr;gap:8px}
    .bd{display:flex;gap:8px;align-items:flex-start}
    .bi{flex:0 0 18px;width:18px;height:18px;border-radius:9px;color:#0E0D17;font-weight:900;font-size:11px;display:flex;align-items:center;justify-content:center;margin-top:1px}
    .bd b{display:block;font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.3px;color:var(--mute)}
    .bd span{font-size:11.5px;color:var(--ink);line-height:1.35}
  </style>
  <h1>Plan realignment — scenario evaluation</h1>
  <p class="lede">Each card is a realistic "behind" week run through the real <code>proposeAdaptations</code> engine. The plan strip shows Mon–Sun (planned mi, type dot, today highlighted, past days ✓done / <span style="color:#FF5C7A">miss</span>). Below it, the "Recover fully" proposal's before/after, then the grade on four axes.</p>
  <div class="sum">
    <div class="sc" style="color:#4FB477">✓ ${tally.ok} ok</div>
    <div class="sc" style="color:#F0883E">! ${tally.warn} warn</div>
    <div class="sc" style="color:#FF5C7A">✗ ${tally.bad} concern</div>
    <div class="sc" style="color:#A9A5BF">– ${tally.na} n/a</div>
  </div>
  <div class="grid">${rows}</div>`;

  writeFileSync(REPORT_PATH, html);
  // eslint-disable-next-line no-console
  console.log(`\nReflow-sim report: ${REPORT_PATH}\n  ✓${tally.ok} !${tally.warn} ✗${tally.bad} –${tally.na}`);
});
