/**
 * Volkswagen Current Flow Diagram importer (VW group "Stromlaufplan", English editions).
 *
 * VW prints one self-contained diagram per engine and per item of equipment ("No. 14: 1.9 ltr./66 kW
 * direct injection turbo diesel, engine codes AHU, from September 1997"), each over several sheets.
 * Unlike the Land Rover diagrams (tools/ewd/import.ts) the wires carry no ids and are drawn as lines,
 * so the netlist is rebuilt from each sheet's vector drawing (pdftocairo -svg) and its words
 * (pdftotext -bbox):
 *
 *  - a wire is a thick line with its cross-section and colour printed on it ("0,5" over "ro/sw");
 *    a dashed wire is drawn solid with white gaps laid across it;
 *  - it ends at a component pin ("T68/23" = pin 23 of the 68-pin connector T68; a bare "2" = pin 2 of
 *    the component's own plug), at the edge of the fuse and relay band at the top ("P7/22" = pin 22 of
 *    connector P7 on the multi-function unit), at the earth line at the bottom (a ringed number: an
 *    earth point, or an earth connection in the harness), at a junction dot (a ringed harness
 *    connection such as "B170"), at a page-edge letter (continues on the next sheet) or at a boxed
 *    current-track number (continues at that track);
 *  - in-line connectors ("T24/19") are printed beside a wire, which passes through them; each is
 *    modelled as two mating halves, "T24" above and "T24'" below;
 *  - unlabelled lines between junctions (splice buses) and dots joined by thin lines belong to one
 *    electrical node; a wire end at such a node takes the node's name;
 *  - dashed wires and wires marked "*" exist only in the variant the sheet's footnote names.
 *
 * Only the geometry and words the sheet prints are used. Splices are VW's ringed harness connections
 * ("B170", "238"); grounds are the ringed earth points and earth straps ("13"); both carry their legend
 * text as `name`. Wire ids are built from their two ends, because VW prints none. A terminal the sheet
 * does not number is named after the current track it is drawn at ("?t2").
 *
 *   npx tsx tools/ewd/import-vw.ts <diagrams.pdf> <out.json> --diagrams 1,2,14 --title "…" --vin "…" --market LHD
 *     [--debug <dir>]   per-sheet JSON with every branch and end, for overlay checks
 *
 * Requires `pdftotext`, `pdfinfo` and `pdftocairo` (poppler-utils).
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { EwdData, EwdWire } from '../../src/shared/wiring';

type P = [number, number];

interface Word {
  t: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

interface Seg {
  a: P;
  b: P;
  w: number;
  dashed?: boolean;
}

interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const cx = (r: Rect) => (r.x0 + r.x1) / 2;
const cy = (r: Rect) => (r.y0 + r.y1) / 2;
const mid = (w: Word): P => [(w.x0 + w.x1) / 2, (w.y0 + w.y1) / 2];
const dist = (a: P, b: P) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const boxDist = (w: Rect, p: P) => Math.hypot(Math.max(w.x0 - p[0], 0, p[0] - w.x1), Math.max(w.y0 - p[1], 0, p[1] - w.y1));

/** VW wire colours (the diagrams' own key). */
const COLOURS = ['ws', 'sw', 'ro', 'rt', 'br', 'gn', 'bl', 'gr', 'li', 'ge', 'or', 'rs'];
const COLOUR = new RegExp(`^(?:${COLOURS.join('|')})(?:/(?:${COLOURS.join('|')}))?$`);
const SIZE = /^\d{1,2},\d{1,2}$/;
/** Component or connector codes as the legend prints them: J248, T3m, S205, TV23, A. */
const CODE = /^[A-Z]{1,2}(?:\d{1,4}[a-z]{0,2})?$/;
/** A pin of a multi-pin connector: T68/23, T3m/2, T10/8. */
const TPIN = /^(T\d+[a-z]{0,2})\/([0-9A-Za-z]+)$/;
/** A pin printed with its component: J226/8, J447/2. */
const CPIN = /^([A-Z]{1,2}\d*[a-z]?)\/([0-9A-Za-z+]+)$/;
/** Multi-function unit (relay plate and fuse holder) connector pins: P7/22, P1. */
const PLATE = /^(P\d{1,2})(?:\/(\d{1,3}))?$/;
/** Relay socket contact and relay terminal: 4/85, 1/30, 2/87. */
const RELAYPIN = /^(\d{1,2})\/(\d{2}[a-z]?)$/;
/** Plain pin or terminal names printed at a component. */
const PIN = /^(?:\d{1,3}[a-z]?|D\+|B\+|DF|W|X|S|SU|P|L|K|[+–−-]|31b|15a|58b|58d)$/;
const AMPS = /^(\d+(?:[.,]\d+)?)A$/;
/** Legend wording of the ringed harness connections and earths ("Positive (+) connection -2- (30), …"). */
const HARNESS_POINT = /^(?:Positive \(\+\) connection|Positive connection|Plus connection|Connection|Earth connection|Earth point|Earth strap|Earth \()/i;

/** The code VW leaves unnamed: the multi-function unit carrying the relay plate and fuse holder. */
export const PLATE_CODE = 'MFU';

// ---------------------------------------------------------------- PDF reading

function readWords(pdf: string, first: number, last: number): Map<number, Word[]> {
  const xml = execFileSync('pdftotext', ['-f', String(first), '-l', String(last), '-bbox', pdf, '-'], {
    maxBuffer: 1 << 28,
    stdio: ['ignore', 'pipe', 'ignore'],
  }).toString('utf8');
  const out = new Map<number, Word[]>();
  xml
    .split('<page ')
    .slice(1)
    .forEach((chunk, i) => {
      const ws: Word[] = [];
      for (const m of chunk.matchAll(/<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]*)<\/word>/g)) {
        const t = m[5].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'");
        ws.push({ t, x0: +m[1], y0: +m[2], x1: +m[3], y1: +m[4] });
      }
      out.set(first + i, ws);
    });
  return out;
}

/** Joins a code letter and its subscript number ("T" "24/19" → "T24/19", "J" "248" → "J248"). */
function joinSubscripts(ws: Word[]): Word[] {
  const sorted = [...ws].sort((a, b) => a.x0 - b.x0);
  const used = new Set<Word>();
  const out: Word[] = [];
  for (const a of sorted) {
    if (used.has(a)) continue;
    // a label broken after its slash: "D/" "X" → "D/X", "T28a/" "12" → "T28a/12"
    if (/\/$/.test(a.t)) {
      const b = sorted.find((w) => !used.has(w) && w !== a && w.x0 >= a.x1 - 1.6 && w.x0 - a.x1 < 2.6 && w.y1 > a.y0 + 1 && w.y0 < a.y1 - 1);
      if (b) {
        used.add(a);
        used.add(b);
        out.push({ t: a.t + b.t, x0: a.x0, y0: Math.min(a.y0, b.y0), x1: b.x1, y1: Math.max(a.y1, b.y1) });
        continue;
      }
    }
    if (/^[A-Z]{1,2}$/.test(a.t)) {
      const b = sorted.find(
        (w) => !used.has(w) && w !== a && /^\d/.test(w.t) && w.x0 >= a.x1 - 1.6 && w.x0 - a.x1 < 2.6 && w.y1 > a.y0 + 1 && w.y0 < a.y1 - 1 && w.y1 <= a.y1 + 2,
      );
      if (b) {
        used.add(a);
        used.add(b);
        out.push({ t: a.t + b.t, x0: a.x0, y0: Math.min(a.y0, b.y0), x1: b.x1, y1: Math.max(a.y1, b.y1) });
        continue;
      }
    }
    out.push(a);
  }
  return out;
}

interface Shapes {
  thick: Seg[];
  thin: Seg[];
  dots: P[];
  rings: { c: P; r: number }[];
  grey: Rect[];
  boxes: Rect[];
  white: Rect[];
  /** Small open circles and arcs: a component terminal or connector drawn where a wire ends. */
  terms: P[];
}

type M = [number, number, number, number, number, number];
const ID: M = [1, 0, 0, 1, 0, 0];
const mul = (m: M, n: M): M => [
  m[0] * n[0] + m[2] * n[1],
  m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3],
  m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4],
  m[1] * n[4] + m[3] * n[5] + m[5],
];
const apply = (m: M, x: number, y: number): P => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
const matrixOf = (t: string | undefined): M => {
  const m = t?.match(/matrix\(([^)]*)\)/);
  return m ? (m[1].split(',').map(Number) as M) : ID;
};
const rgb = (s: string | undefined): [number, number, number] | null => {
  const m = s?.match(/rgb\(([\d.]+)%,\s*([\d.]+)%,\s*([\d.]+)%\)/);
  return m ? [+m[1] / 100, +m[2] / 100, +m[3] / 100] : null;
};

/** Vector shapes of one page, in PDF points with the origin top left (same frame as pdftotext -bbox). */
function readShapes(pdf: string, page: number): Shapes {
  const svg = execFileSync('pdftocairo', ['-svg', '-f', String(page), '-l', String(page), pdf, '-'], {
    maxBuffer: 1 << 28,
    stdio: ['ignore', 'pipe', 'ignore'],
  }).toString('utf8');
  const body = svg.slice(svg.indexOf('</defs>'));
  const out: Shapes = { thick: [], thin: [], dots: [], rings: [], grey: [], boxes: [], white: [], terms: [] };
  const stack: M[] = [ID];
  for (const tag of body.matchAll(/<(\/?)(g|path)\b([^>]*?)(\/?)>/g)) {
    const [, close, name, attrs, selfClose] = tag;
    if (name === 'g') {
      if (close) stack.pop();
      else if (!selfClose) stack.push(mul(stack[stack.length - 1], matrixOf(attrs.match(/transform="([^"]*)"/)?.[1])));
      continue;
    }
    const attr = (k: string) => attrs.match(new RegExp(`(?:^|\\s)${k}="([^"]*)"`))?.[1];
    const m = mul(stack[stack.length - 1], matrixOf(attr('transform')));
    const scale = Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));
    const d = attr('d') ?? '';
    const fill = rgb(attr('fill'));
    const stroke = attr('stroke') && attr('stroke') !== 'none' ? rgb(attr('stroke')) : null;
    const sw = Number(attr('stroke-width') ?? 0) * scale;
    // subpaths of absolute M/L/C/Z commands
    const subs: { pts: P[]; curve: boolean; closed: boolean }[] = [];
    for (const cmd of d.matchAll(/([MLCZ])([^MLCZ]*)/g)) {
      const nums = (cmd[2].match(/-?\d*\.?\d+(?:e-?\d+)?/g) ?? []).map(Number);
      if (cmd[1] === 'M') subs.push({ pts: [apply(m, nums[0], nums[1])], curve: false, closed: false });
      const cur = subs[subs.length - 1];
      if (!cur) continue;
      if (cmd[1] === 'L') for (let i = 0; i + 1 < nums.length; i += 2) cur.pts.push(apply(m, nums[i], nums[i + 1]));
      if (cmd[1] === 'C') {
        cur.curve = true;
        for (let i = 0; i + 1 < nums.length; i += 2) cur.pts.push(apply(m, nums[i], nums[i + 1]));
      }
      if (cmd[1] === 'Z') cur.closed = true;
    }
    for (const s of subs) {
      if (s.pts.length < 2) continue;
      const xs = s.pts.map((p) => p[0]);
      const ys = s.pts.map((p) => p[1]);
      const bb: Rect = { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
      const w = bb.x1 - bb.x0;
      const h = bb.y1 - bb.y0;
      const black = !!fill && fill[0] < 0.15 && fill[1] < 0.15 && fill[2] < 0.15;
      const white = !!fill && fill[0] > 0.95 && fill[1] > 0.95 && fill[2] > 0.95;
      const grey = !!fill && Math.abs(fill[0] - 0.7) < 0.08 && Math.abs(fill[1] - 0.7) < 0.08;
      const ringLike = s.curve && (s.closed || dist(s.pts[0], s.pts[s.pts.length - 1]) < 1) && w > 8 && w < 26 && Math.abs(w - h) < 3;
      if (stroke && sw > 0.3 && ringLike && !black) {
        out.rings.push({ c: [cx(bb), cy(bb)], r: w / 2 });
        continue;
      }
      if (stroke && sw > 0.3 && s.curve && !black && w > 2.5 && w < 5.5 && h < 5.5) {
        out.terms.push([cx(bb), cy(bb)]);
        continue;
      }
      if (black && s.curve) {
        if (w > 2.9 && w < 5.2 && h > 2.9 && h < 5.2) out.dots.push([cx(bb), cy(bb)]);
        continue;
      }
      if (black && !s.curve) {
        const seg = barOf(s.pts);
        if (seg) out.thick.push(seg);
        continue;
      }
      if (white && !s.curve && s.pts.length >= 4) {
        // an outlined white box is a current-track reference; an unoutlined one masks a label or a dash gap
        if (stroke && sw > 0.3 && w > 6 && h > 5 && w < 40 && h < 16) out.boxes.push(bb);
        else out.white.push(bb);
        continue;
      }
      if (grey && !s.curve && w > 6 && h > 4) {
        out.grey.push(bb);
        continue;
      }
      if (!fill && stroke && sw > 0.3 && sw < 1.6 && !s.curve) {
        if (s.closed && s.pts.length >= 4 && w > 6 && h > 5 && w < 40 && h < 16) out.boxes.push(bb);
        for (let i = 1; i < s.pts.length; i++) out.thin.push({ a: s.pts[i - 1], b: s.pts[i], w: sw });
        if (s.closed) out.thin.push({ a: s.pts[s.pts.length - 1], b: s.pts[0], w: sw });
      }
    }
  }
  return out;
}

/** A filled thin quadrilateral (a thick line drawn as an area) → its centre line. */
function barOf(pts: P[]): Seg | null {
  const p = pts.filter((q, i) => i === 0 || dist(q, pts[i - 1]) > 0.05);
  if (p.length > 1 && dist(p[0], p[p.length - 1]) < 0.05) p.pop();
  if (p.length !== 4) return null;
  const edges = [0, 1, 2, 3].map((i) => ({ i, len: dist(p[i], p[(i + 1) % 4]) }));
  const short = [...edges].sort((a, b) => a.len - b.len);
  const w = (short[0].len + short[1].len) / 2;
  const long = (short[2].len + short[3].len) / 2;
  if (w < 1.2 || w > 3.4 || long < 1.4) return null;
  // the two short edges must be opposite
  if (Math.abs(short[0].i - short[1].i) !== 2) return null;
  const midOf = (i: number): P => [(p[i][0] + p[(i + 1) % 4][0]) / 2, (p[i][1] + p[(i + 1) % 4][1]) / 2];
  return { a: midOf(short[0].i), b: midOf(short[1].i), w };
}

// ---------------------------------------------------------------- sheet model

interface LegendEntry {
  code: string;
  text: string;
  ringed: boolean;
}

interface Sheet {
  page: number;
  diagram: number;
  sheet: number;
  title: string;
  words: Word[];
  shapes: Shapes;
  legend: Map<string, LegendEntry>;
  band?: Rect;
  busY?: number;
  left: number;
  right: number;
  tracks: { n: number; x: number }[];
  /** Footnotes: what a dashed wire and a "*" mean on this sheet. */
  dashedMeans?: string;
  starMeans?: string;
}

const LEGEND_X = 490;
const DRAW_MAX_X = 470;

function legendOf(ws: Word[], rings: { c: P; r: number }[]): { entries: Map<string, LegendEntry>; title: string; dashed?: string; star?: string } {
  const right = ws.filter((w) => w.x0 >= LEGEND_X && w.y0 > 40 && w.y1 < 570).sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
  const entries = new Map<string, LegendEntry>();
  if (!right.length) return { entries, title: '' };
  // rows by baseline
  const rows: Word[][] = [];
  for (const w of right) {
    const row = rows.find((r) => Math.abs(r[0].y1 - w.y1) < 2);
    if (row) row.push(w);
    else rows.push([w]);
  }
  for (const r of rows) r.sort((a, b) => a.x0 - b.x0);
  // the colour key ("ws = white") is not part of the legend
  for (let i = rows.length - 1; i >= 0; i--) if (rows[i][1]?.t === '=' || rows[i].some((w) => w.t === '=')) rows.splice(i, 1);
  rows.sort((a, b) => a[0].y0 - b[0].y0);
  // the description column: the left edge most legend rows share (it moves from sheet to sheet)
  const votes = new Map<number, number>();
  for (const r of rows) for (const w of r) votes.set(Math.round(w.x0), (votes.get(Math.round(w.x0)) ?? 0) + 1);
  const left = Math.min(...right.map((w) => w.x0));
  const descX = [...votes].filter(([x]) => x > left + 12).sort((a, b) => b[1] - a[1])[0]?.[0] ?? left + 30;
  // a two-line entry prints its code between its two description lines: give the code back to those lines
  const isDescRow = (r: Word[]) => r[0].x0 >= descX - 1.5;
  const midY = (r: Word[]) => (r[0].y0 + r[0].y1) / 2;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (r.length !== 1 || r[0].x1 >= descX - 3 || !(CODE.test(r[0].t) || /^\d{1,3}$/.test(r[0].t))) continue;
    const above = rows[i - 1] && isDescRow(rows[i - 1]) && midY(r) - midY(rows[i - 1]) < 7 ? rows[i - 1] : null;
    const below = rows[i + 1] && isDescRow(rows[i + 1]) && midY(rows[i + 1]) - midY(r) < 7 ? rows[i + 1] : null;
    if (!above && !below) continue;
    const merged = [r[0], ...(above ?? []), ...(below ?? [])];
    const start = above ? i - 1 : i;
    rows.splice(start, (above ? 1 : 0) + 1 + (below ? 1 : 0), merged);
    i = start;
  }
  // codes are right-aligned a little in from the title's left edge; a title line can start with a word that
  // looks like a code ("X contact relief relay, …")
  const codeStarts = rows.filter((r) => r.length > 1 && CODE.test(r[0].t) && r[0].x1 < descX - 3).map((r) => r[0].x0).sort((a, b) => a - b);
  const codeLeft = codeStarts.length ? codeStarts[Math.floor(codeStarts.length / 4)] : left;
  let title = '';
  let current: LegendEntry | null = null;
  let titleDone = false;
  let dashed: string | undefined;
  let star: string | undefined;
  for (const r of rows) {
    const first = r[0];
    const text = r.map((w) => w.t).join(' ');
    if (/^(?:-{2,}|–+)$/.test(first.t) && r.length > 1) {
      dashed = r.slice(1).map((w) => w.t).join(' ');
      current = null;
      continue;
    }
    if (first.t === '*' && r.length > 1) {
      star = r.slice(1).map((w) => w.t).join(' ');
      current = null;
      continue;
    }
    if (!titleDone && first.x0 < codeLeft - 4) {
      title = title ? `${title} ${text}` : text;
      continue;
    }
    // a code sits left of the description column on the description's baseline
    const desc = r.filter((w) => w.x0 >= descX - 1.5);
    const codeWords = r.filter((w) => w.x1 < descX - 3);
    const isCode = codeWords.length === 1 && desc.length > 0 && (CODE.test(first.t) || /^\d{1,3}$/.test(first.t));
    if (isCode) {
      titleDone = true;
      const text = desc.map((w) => w.t).join(' ');
      current = { code: first.t, text, ringed: /^\d+$/.test(first.t) || HARNESS_POINT.test(text) || rings.some((g) => dist(g.c, mid(first)) < g.r) };
      entries.set(first.t, current);
      continue;
    }
    if (!titleDone && first.x0 < descX - 3) {
      title = title ? `${title} ${text}` : text;
      continue;
    }
    // continuation of the previous entry's description
    if (current && first.x0 >= descX - 1.5) current.text = `${current.text} ${text}`;
  }
  for (const e of entries.values()) e.text = e.text.replace(/\s+/g, ' ').replace(/(\w)- (\w)/g, '$1-$2').trim();
  return { entries, title: title.trim(), dashed, star };
}

/** Joins touching collinear horizontal thin segments (the earth line is often drawn in pieces). */
function mergeHorizontal(thin: Seg[]): Seg[] {
  const hs = thin
    .filter((s) => Math.abs(s.a[1] - s.b[1]) < 0.3)
    .map((s) => ({ y: s.a[1], x0: Math.min(s.a[0], s.b[0]), x1: Math.max(s.a[0], s.b[0]), w: s.w }))
    .sort((a, b) => a.y - b.y || a.x0 - b.x0);
  const out: Seg[] = [];
  for (const h of hs) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.a[1] - h.y) < 0.4 && h.x0 <= last.b[0] + 1.5) last.b = [Math.max(last.b[0], h.x1), last.b[1]];
    else out.push({ a: [h.x0, h.y], b: [h.x1, h.y], w: h.w });
  }
  return out;
}

function readSheet(page: number, ws0: Word[], sh: Shapes, diagram: number, sheet: number): Sheet {
  const ws = joinSubscripts(ws0);
  const { entries, title, dashed, star } = legendOf(ws0, sh.rings.filter((r) => r.c[0] > LEGEND_X));
  const drawing = ws.filter((w) => w.x1 < DRAW_MAX_X && w.y0 > 40);
  // the fuse and relay band: the widest grey rectangles at the top
  const bandParts = sh.grey.filter((r) => r.y0 < 80 && r.x1 - r.x0 > 200);
  const band = bandParts.length
    ? { x0: Math.min(...bandParts.map((r) => r.x0)), y0: Math.min(...bandParts.map((r) => r.y0)), x1: Math.max(...bandParts.map((r) => r.x1)), y1: Math.max(...bandParts.map((r) => r.y1)) }
    : undefined;
  // the earth line: a long thin horizontal line with the current-track numbers printed just below it
  const trackWords = drawing.filter((w) => /^\d{1,3}$/.test(w.t));
  const bus = mergeHorizontal(sh.thin)
    .filter((s) => Math.abs(s.a[0] - s.b[0]) > 250 && s.a[1] > 400 && Math.max(s.a[0], s.b[0]) < DRAW_MAX_X)
    .map((s) => ({ s, n: trackWords.filter((w) => w.y0 > s.a[1] && w.y0 < s.a[1] + 14).length }))
    .filter((x) => x.n >= 3)
    .sort((a, b) => b.n - a.n)[0]?.s;
  const busY = bus?.a[1];
  const tracks = trackWords
    .filter((w) => busY !== undefined && w.y0 > busY && w.y0 < busY + 14)
    .map((w) => ({ n: Number(w.t), x: (w.x0 + w.x1) / 2 }))
    .sort((a, b) => a.x - b.x);
  const left = bus ? Math.min(bus.a[0], bus.b[0]) : (band?.x0 ?? 46);
  const right = bus ? Math.max(bus.a[0], bus.b[0]) : (band?.x1 ?? 410);
  return { page, diagram, sheet, title, words: drawing, shapes: sh, legend: entries, band, busY, left, right, tracks, dashedMeans: dashed, starMeans: star };
}

// ---------------------------------------------------------------- branches and their ends

export interface End {
  kind: 'pin' | 'splice' | 'ground' | 'edge' | 'track' | 'open';
  /** pin: connector id and pin; splice/ground: id; edge: side and letter; track: the track it continues at. */
  connector?: string;
  pin?: string;
  component?: string;
  id?: string;
  name?: string;
  side?: 'left' | 'right';
  letter?: string;
  target?: number;
  /** Current track this end is drawn at (for continuation matching). */
  track?: number;
  at: P;
  near?: string;
}

interface Branch {
  pts: P[];
  ends: [End, End];
  csa?: number;
  colour?: string;
  dashed: boolean;
  star: boolean;
}

function projT(s: Seg, p: P): number {
  const dx = s.b[0] - s.a[0];
  const dy = s.b[1] - s.a[1];
  const l2 = dx * dx + dy * dy || 1;
  return ((p[0] - s.a[0]) * dx + (p[1] - s.a[1]) * dy) / l2;
}

function distToSeg(s: Seg, p: P): number {
  const t = Math.max(0, Math.min(1, projT(s, p)));
  return dist(p, [s.a[0] + (s.b[0] - s.a[0]) * t, s.a[1] + (s.b[1] - s.a[1]) * t]);
}

/** Splits segments at points (dots, T-junctions) so every junction is a segment end; corners are left alone. */
function splitAt(segs: Seg[], points: P[], tol: number): Seg[] {
  let out = segs;
  for (const p of points) {
    const next: Seg[] = [];
    for (const s of out) {
      const t = projT(s, p);
      if (t > 0 && t < 1 && distToSeg(s, p) < tol) {
        const q: P = [s.a[0] + (s.b[0] - s.a[0]) * t, s.a[1] + (s.b[1] - s.a[1]) * t];
        if (dist(s.a, q) > 2.4 && dist(q, s.b) > 2.4) {
          next.push({ ...s, b: q }, { ...s, a: q });
          continue;
        }
      }
      next.push(s);
    }
    out = next;
  }
  return out;
}

const isVertical = (s: Seg) => Math.abs(s.a[0] - s.b[0]) < 0.6;
const isHorizontal = (s: Seg) => Math.abs(s.a[1] - s.b[1]) < 0.6;

/** A dashed wire is drawn solid with narrow white masks laid across it at regular spacing. */
function markDashes(segs: Seg[], white: Rect[]): void {
  for (const s of segs) {
    const v = isVertical(s);
    const h = isHorizontal(s);
    if (!v && !h) continue;
    const across = white.filter((r) => {
      const along = v ? r.y1 - r.y0 : r.x1 - r.x0;
      const wide = v ? r.x1 - r.x0 : r.y1 - r.y0;
      if (along > 3.2 || wide < s.w + 1 || wide > 10) return false;
      const c: P = [cx(r), cy(r)];
      const t = projT(s, c);
      return t > 0 && t < 1 && distToSeg(s, c) < 1.2;
    });
    if (across.length >= 2) s.dashed = true;
  }
}

function mid2(a: P, b: P): P {
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
}

function inRect(p: P, r: Rect, pad = 0): boolean {
  return p[0] >= r.x0 - pad && p[0] <= r.x1 + pad && p[1] >= r.y0 - pad && p[1] <= r.y1 + pad;
}

function labelPairs(ws: Word[]): { size: string; colour: string; c: P }[] {
  const sizes = ws.filter((w) => SIZE.test(w.t));
  const colours = ws.filter((w) => COLOUR.test(w.t));
  const out: { size: string; colour: string; c: P }[] = [];
  for (const s of sizes) {
    const scx = (s.x0 + s.x1) / 2;
    const c = colours.filter((w) => Math.abs((w.x0 + w.x1) / 2 - scx) < 5 && w.y0 >= s.y0 + 2 && w.y0 - s.y1 < 3).sort((a, b) => a.y0 - b.y0)[0];
    if (c) out.push({ size: s.t, colour: c.t, c: [scx, (s.y0 + c.y1) / 2] });
  }
  return out;
}

class UnionFind {
  parent: number[] = [];
  find(i: number): number {
    while (this.parent[i] !== undefined && this.parent[i] !== i) i = this.parent[i] = this.parent[this.parent[i]] ?? this.parent[i];
    return i;
  }
  union(a: number, b: number) {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent[rb] = ra;
  }
}

function trackAt(sh: Sheet, x: number): number | undefined {
  let best: { n: number; d: number } | undefined;
  for (const t of sh.tracks) {
    const d = Math.abs(t.x - x);
    if (!best || d < best.d) best = { n: t.n, d };
  }
  return best && best.d < 14 ? best.n : undefined;
}

function buildBranches(sh: Sheet): Branch[] {
  const g = sh.shapes;
  const inDrawing = (p: P) => p[0] < DRAW_MAX_X && p[1] > 40 && (sh.busY === undefined || p[1] < sh.busY + 4);
  // lines drawn inside a component's grey body are part of its symbol (a sensor's coil, a control unit's
  // internal valves), not harness wires
  const bodies = g.grey.filter((r) => !(sh.band && r.y0 < sh.band.y1));
  const symbol = (s: Seg) => bodies.some((r) => inRect(mid2(s.a, s.b), r, -1.5) && inRect(s.a, r, 1) && inRect(s.b, r, 1));
  let segs = g.thick.filter((s) => inDrawing(s.a) && inDrawing(s.b) && !symbol(s));
  markDashes(segs, g.white);
  const dots = g.dots.filter((d) => inDrawing(d) && !(sh.band && inRect(d, sh.band, -1)));
  // T-junctions: a segment end lying on another segment's interior joins it there
  const ends = segs.flatMap((s) => [s.a, s.b]);
  segs = splitAt(segs, [...dots, ...ends], 1.3);
  segs = segs.filter((s) => dist(s.a, s.b) > 0.4);

  // graph nodes by clustering segment ends
  const nodes: { p: P; segs: number[]; dot: boolean }[] = [];
  const nodeOf = (p: P): number => {
    for (let i = 0; i < nodes.length; i++) if (dist(nodes[i].p, p) < 2.4) return i;
    nodes.push({ p, segs: [], dot: false });
    return nodes.length - 1;
  };
  const segNodes = segs.map((s, i) => {
    const a = nodeOf(s.a);
    const b = nodeOf(s.b);
    nodes[a].segs.push(i);
    nodes[b].segs.push(i);
    return [a, b] as [number, number];
  });
  for (const d of dots) {
    let best = -1;
    let bd = 2.4;
    nodes.forEach((n, i) => {
      const dd = dist(n.p, d);
      if (dd < bd) (bd = dd), (best = i);
    });
    if (best >= 0) nodes[best].dot = true;
  }
  // thin lines join the dots they touch (a harness connection drawn across other wires)
  const thinDots = new Map<number, number[]>();
  g.thin.forEach((t, ti) => {
    // a thin line through a component body links that component's terminals in its symbol, not a harness
    if (bodies.some((r) => inRect(mid2(t.a, t.b), r, -1.5))) return;
    const touched = nodes.map((n, i) => ({ n, i })).filter((x) => x.n.dot && distToSeg(t, x.n.p) < 2.6).map((x) => x.i);
    if (touched.length) thinDots.set(ti, touched);
  });
  // a thin line joins dots only when it reaches two of them
  for (const [k, v] of thinDots) if (new Set(v).size < 2) thinDots.delete(k);
  const onThin = new Set([...thinDots.values()].flat());
  // a dot with a single line and no thin line is a terminal mark (fuse holder, component pin)
  for (const [i, n] of nodes.entries()) if (n.dot && n.segs.length < 2 && !onThin.has(i)) n.dot = false;
  // terminal marks stop a chain: wires drawn meeting at a component terminal are separate wires
  const termNode = new Set<number>();
  for (const t of g.terms) {
    let best = -1;
    let bd = 3;
    nodes.forEach((n, i) => {
      const dd = dist(n.p, t);
      if (dd < bd) (bd = dd), (best = i);
    });
    if (best >= 0 && !nodes[best].dot) termNode.add(best);
  }

  // branches: chains through plain bends, between dots, ends and junctions
  const stop = (i: number) => nodes[i].dot || termNode.has(i) || nodes[i].segs.length !== 2;
  const seen = new Set<number>();
  const chains: { nodes: number[]; segs: number[] }[] = [];
  for (let si = 0; si < segs.length; si++) {
    if (seen.has(si)) continue;
    seen.add(si);
    const chainSegs = [si];
    const walk = (from: number, seg: number): number[] => {
      const path: number[] = [];
      let node = segNodes[seg][0] === from ? segNodes[seg][1] : segNodes[seg][0];
      path.push(node);
      let cur = seg;
      while (!stop(node)) {
        const nxt = nodes[node].segs.find((x) => x !== cur);
        if (nxt === undefined || seen.has(nxt)) break;
        seen.add(nxt);
        chainSegs.push(nxt);
        cur = nxt;
        node = segNodes[nxt][0] === node ? segNodes[nxt][1] : segNodes[nxt][0];
        path.push(node);
      }
      return path;
    };
    const [a, b] = segNodes[si];
    const fwd = walk(a, si);
    const back = walk(b, si);
    chains.push({ nodes: [...back.reverse(), ...fwd], segs: chainSegs });
  }

  // labels on chains
  const labels = labelPairs(sh.words);
  const stars = sh.words.filter((w) => w.t === '*');
  const info = chains.map((c) => {
    const bsegs = c.segs.map((i) => segs[i]);
    const own = labels.filter((l) => bsegs.some((s) => distToSeg(s, l.c) < 4.5 && projT(s, l.c) > -0.05 && projT(s, l.c) < 1.05));
    return {
      ...c,
      bsegs,
      labels: own,
      dashed: bsegs.some((s) => s.dashed),
      star: stars.some((w) => bsegs.some((s) => distToSeg(s, mid(w)) < 9)),
      len: c.nodes.slice(1).reduce((acc, n, i) => acc + dist(nodes[n].p, nodes[c.nodes[i]].p), 0),
    };
  });

  // electrical nodes: unlabelled chains (splice buses, bends cut by a junction) and thin lines between
  // dots join the graph nodes they touch into one node
  const uf = new UnionFind();
  nodes.forEach((_, i) => (uf.parent[i] = i));
  for (const c of info) if (!c.labels.length) uf.union(c.nodes[0], c.nodes[c.nodes.length - 1]);
  for (const touched of thinDots.values()) for (const i of touched) if (nodes[i].dot) uf.union(touched[0], i);

  // local ends: what each free end, dot or junction touches by itself
  const local = new Map<number, End>();
  const prevOf = (ni: number): P => {
    const c = info.find((x) => x.nodes[0] === ni || x.nodes[x.nodes.length - 1] === ni)!;
    const k = c.nodes[0] === ni ? c.nodes[1] : c.nodes[c.nodes.length - 2];
    return nodes[k].p;
  };
  nodes.forEach((n, i) => {
    if (n.dot) {
      if (sh.busY !== undefined && Math.abs(n.p[1] - sh.busY) < 3.5) return local.set(i, busEnd(sh, n.p));
      const id = ringedAt(sh, n.p, 28);
      if (id) local.set(i, earthOrSplice(sh, id, n.p, trackAt(sh, n.p[0])));
      return;
    }
    // a free end, or a terminal mark several wires meet at
    if (n.segs.length === 1) local.set(i, freeEnd(sh, n.p, prevOf(i)));
    else if (termNode.has(i)) local.set(i, pinEnd(sh, n.p, [0, 0], trackAt(sh, n.p[0])));
  });

  // the name of each electrical node: its ringed connection or earth, else a component pin, else the rest
  const rank = (e: End) => (e.kind === 'splice' || e.kind === 'ground' ? (e.id === '31' ? 3 : 0) : e.kind === 'pin' ? 1 : e.kind === 'edge' || e.kind === 'track' ? 2 : 9);
  const named = new Map<number, End>();
  for (const [ni, e] of local) {
    const r = uf.find(ni);
    const cur = named.get(r);
    if (!cur || rank(e) < rank(cur)) named.set(r, e);
  }
  let anon = 0;
  const anonId = new Map<number, string>();
  const endAt = (ni: number): End => {
    const own = local.get(ni);
    if (own && own.kind !== 'open') return own;
    const r = uf.find(ni);
    const n = named.get(r);
    if (n && n.kind !== 'open') return { ...n, at: nodes[ni].p };
    if (own) return own;
    // a junction the sheet does not name: an unlabelled splice
    if (!anonId.has(r)) anonId.set(r, `${sh.diagram}.${sh.sheet}.${++anon}`);
    return { kind: 'splice', id: anonId.get(r)!, at: nodes[ni].p, track: trackAt(sh, nodes[ni].p[0]), near: 'unnamed junction' };
  };

  // wires: labelled chains, cut at in-line connectors
  const out: Branch[] = [];
  for (const c of info) {
    if (!c.labels.length) continue;
    const pts = c.nodes.map((n) => nodes[n].p);
    const marks = inlineMarks(sh, c.bsegs, pts);
    const pieces = splitPolyline(pts, marks.map((m) => m.at));
    const first = endAt(c.nodes[0]);
    const last = endAt(c.nodes[c.nodes.length - 1]);
    for (let k = 0; k < pieces.length; k++) {
      const pp = pieces[k];
      const half = (m: (typeof marks)[number], from: P): End => ({
        kind: 'pin',
        // the half the wire comes from above is "T24", the lower one "T24'"
        connector: from[1] < m.at[1] - 0.5 ? m.conn : `${m.conn}'`,
        pin: m.pin,
        at: m.at,
      });
      let a = k === 0 ? first : half(marks[k - 1], pp[1]);
      let b = k === pieces.length - 1 ? last : half(marks[k], pp[pp.length - 2]);
      // a component the sheet draws without pin numbers takes the pin of the plug its lead runs to
      const smallPlug = (m: (typeof marks)[number] | undefined, q: P) => !!m && Number(/^T(\d+)/.exec(m.conn)?.[1] ?? 99) <= 8 && dist(m.at, q) < 70;
      if (k === 0 && a.kind === 'pin' && a.pin?.startsWith('?') && smallPlug(marks[0], a.at)) a = { ...a, pin: marks[0].pin };
      if (k === pieces.length - 1 && b.kind === 'pin' && b.pin?.startsWith('?') && smallPlug(marks[marks.length - 1], b.at)) b = { ...b, pin: marks[marks.length - 1].pin };
      const lab = c.labels.find((l) => polyDist(pp, l.c) < 4.5) ?? c.labels[0];
      out.push({ pts: pp, ends: [a, b], csa: Number(lab.size.replace(',', '.')), colour: lab.colour, dashed: c.dashed, star: c.star });
    }
  }
  return out;
}

function polyDist(pts: P[], p: P): number {
  let best = Infinity;
  for (let i = 1; i < pts.length; i++) best = Math.min(best, distToSeg({ a: pts[i - 1], b: pts[i], w: 0 }, p));
  return best;
}

/** In-line connector pins printed beside a branch, away from its ends ("T24/19"). */
function inlineMarks(sh: Sheet, bsegs: Seg[], pts: P[]): { at: P; conn: string; pin: string; t: number }[] {
  const marks: { at: P; conn: string; pin: string; t: number }[] = [];
  const total = pts.slice(1).reduce((acc, p, i) => acc + dist(p, pts[i]), 0);
  for (const w of sh.words) {
    const m = TPIN.exec(w.t);
    if (!m) continue;
    const y = (w.y0 + w.y1) / 2;
    for (const s of bsegs) {
      if (!isVertical(s)) continue;
      const lo = Math.min(s.a[1], s.b[1]);
      const hi = Math.max(s.a[1], s.b[1]);
      const dx = w.x0 - s.a[0];
      if (dx > 1 && dx < 14 && y > lo + 5 && y < hi - 5) {
        const at: P = [s.a[0], y];
        let along = 0;
        for (let i = 1; i < pts.length; i++) {
          const seg: Seg = { a: pts[i - 1], b: pts[i], w: 0 };
          if (distToSeg(seg, at) < 1) {
            along += dist(pts[i - 1], at);
            break;
          }
          along += dist(pts[i - 1], pts[i]);
        }
        if (along > 6 && along < total - 6) marks.push({ at, conn: m[1], pin: m[2], t: along });
      }
    }
  }
  marks.sort((a, b) => a.t - b.t);
  return marks.filter((m, i) => i === 0 || m.t - marks[i - 1].t > 2);
}

function splitPolyline(pts: P[], at: P[]): P[][] {
  if (!at.length) return [pts];
  const out: P[][] = [];
  let cur: P[] = [pts[0]];
  let ai = 0;
  for (let i = 1; i < pts.length; i++) {
    const seg: Seg = { a: pts[i - 1], b: pts[i], w: 0 };
    while (ai < at.length && distToSeg(seg, at[ai]) < 1 && projT(seg, at[ai]) >= 0 && projT(seg, at[ai]) <= 1) {
      cur.push(at[ai]);
      out.push(cur);
      cur = [at[ai]];
      ai++;
    }
    cur.push(pts[i]);
  }
  out.push(cur);
  return out;
}

function ringedAt(sh: Sheet, q: P, maxD: number): string | undefined {
  const rings = sh.shapes.rings.filter((r) => r.c[0] < DRAW_MAX_X).map((r) => ({ r, d: dist(r.c, q) - r.r })).filter((x) => x.d < maxD).sort((a, b) => a.d - b.d);
  for (const { r } of rings) {
    const w = sh.words.find((x) => dist(mid(x), r.c) < r.r * 0.8);
    if (w) return w.t;
  }
  return undefined;
}

function earthOrSplice(sh: Sheet, id: string, at: P, track?: number): End {
  const name = sh.legend.get(id)?.text;
  if (/^Earth point|^Earth strap/i.test(name ?? '')) return { kind: 'ground', id, name, at, track };
  return { kind: 'splice', id, name, at, track };
}

/** A wire that reaches the earth line ends at the ringed earth point or earth connection printed there. */
function busEnd(sh: Sheet, p: P): End {
  const track = trackAt(sh, p[0]);
  const id = ringedAt(sh, [p[0], sh.busY! - 9], 20);
  if (id) return earthOrSplice(sh, id, p, track);
  return { kind: 'ground', id: '31', name: 'Earth (31), no earth point printed', at: p, track, near: 'earth line' };
}

/** What a free wire end touches: the earth line, the band, a page edge, a track box, a ring or a component pin. */
function freeEnd(sh: Sheet, p: P, prev: P): End {
  const track = trackAt(sh, p[0]);
  const dir: P = [p[0] - prev[0], p[1] - prev[1]];
  if (sh.busY !== undefined && Math.abs(p[1] - sh.busY) < 3.5 && dir[1] > 0) return busEnd(sh, p);
  // the fuse and relay band
  if (sh.band && p[1] <= sh.band.y1 + 3 && p[1] >= sh.band.y0 && p[0] >= sh.band.x0 - 2 && p[0] <= sh.band.x1 + 2 && dir[1] < 0) {
    const plate = sh.words
      .filter((w) => PLATE.test(w.t) && w.y0 >= sh.band!.y1 - 2 && w.y0 < sh.band!.y1 + 12 && w.x0 > p[0] - 4 && w.x0 < p[0] + 26)
      .sort((a, b) => a.x0 - b.x0)[0];
    if (plate) {
      const m = PLATE.exec(plate.t)!;
      return { kind: 'pin', connector: m[1], pin: m[2] ?? '1', component: PLATE_CODE, at: p, track };
    }
    const relay = sh.words.find((w) => RELAYPIN.test(w.t) && boxDist(w, p) < 12);
    return { kind: 'pin', connector: PLATE_CODE, pin: relay?.t ?? `?t${track ?? ''}`, component: PLATE_CODE, at: p, track, near: 'band' };
  }
  // page edge letter
  if (p[0] <= sh.left + 4 || p[0] >= sh.right - 4) {
    const side: 'left' | 'right' = p[0] <= sh.left + 4 ? 'left' : 'right';
    const letter = sh.words
      .filter((w) => /^[a-z]$/.test(w.t) && Math.abs((w.y0 + w.y1) / 2 - p[1]) < 4.5 && (side === 'left' ? w.x1 <= p[0] + 3 && p[0] - w.x1 < 18 : w.x0 >= p[0] - 3 && w.x0 - p[0] < 18))
      .sort((a, b) => Math.abs((a.y0 + a.y1) / 2 - p[1]) - Math.abs((b.y0 + b.y1) / 2 - p[1]))[0];
    if (letter) return { kind: 'edge', side, letter: letter.t, at: p, track };
  }
  // boxed track reference
  const box = sh.shapes.boxes.find((b) => inRect(p, b, 3.5));
  if (box) {
    const n = sh.words.find((w) => /^\d{1,3}$/.test(w.t) && inRect(mid(w), box, 1));
    if (n) return { kind: 'track', target: Number(n.t), at: p, track };
  }
  // a ring the wire runs into, or the ring a harness connection's dot and stub point to
  const onDot = sh.shapes.dots.some((d) => dist(d, p) < 2.6);
  const ring = ringedAt(sh, p, onDot ? 24 : 6);
  if (ring) return earthOrSplice(sh, ring, p, track);
  return pinEnd(sh, p, dir, track);
}

function pinEnd(sh: Sheet, p: P, dir: P, track?: number): End {
  // pin labels are printed beside the wire at its end, mostly on the right
  const beside = sh.words
    .filter((w) => {
      const y = (w.y0 + w.y1) / 2;
      const right = w.x0 - p[0];
      const leftGap = p[0] - w.x1;
      const overEnd = w.x0 < p[0] + 6 && w.x1 > p[0] - 6 && Math.abs(y - p[1]) <= 15;
      return (Math.abs(y - p[1]) <= 9.5 && ((right > -1.5 && right < 13) || (leftGap > -1.5 && leftGap < 9))) || overEnd;
    })
    // VW prints a pin's label to the right of its wire: those come first, nearest first
    .sort((a, b) => Number(b.x0 >= p[0] - 1.5) - Number(a.x0 >= p[0] - 1.5) || boxDist(a, p) - boxDist(b, p));
  const tpin = beside.find((w) => TPIN.test(w.t));
  const cpin = beside.find((w) => CPIN.test(w.t) && !TPIN.test(w.t) && sh.legend.has(CPIN.exec(w.t)![1]));
  const relay = beside.find((w) => RELAYPIN.test(w.t));
  const insideBody = (w: Word) => sh.shapes.grey.some((r) => !(sh.band && r.y0 < sh.band.y1) && inRect(mid(w), r, -3));
  const plain = beside.find((w) => PIN.test(w.t) && !SIZE.test(w.t) && !insideBody(w));
  // the component: the grey body the end touches, labelled by its code nearby; else the closest legend code
  const codeWords = sh.words.filter((w) => CODE.test(w.t) && sh.legend.has(w.t) && !sh.legend.get(w.t)!.ringed && !/^T\d/.test(w.t));
  const body = sh.shapes.grey
    .filter((r) => inRect(p, r, 10) && !(sh.band && r.y0 < sh.band.y1))
    .sort((a, b) => boxDist(a, p) - boxDist(b, p) || (a.x1 - a.x0) * (a.y1 - a.y0) - (b.x1 - b.x0) * (b.y1 - b.y0))[0];
  let component: string | undefined;
  if (cpin) component = CPIN.exec(cpin.t)![1];
  else if (body) {
    const nearBody = codeWords.map((w) => ({ w, d: boxDist(body, mid(w)) })).filter((x) => x.d < 18).sort((a, b) => a.d - b.d);
    // a control unit drawn with its internal parts (valves, pumps) inside its body owns the connector
    const inside = nearBody.filter((x) => x.d === 0);
    component = (inside.length > 1 ? inside.find((x) => /^J\d/.test(x.w.t)) : undefined)?.w.t ?? nearBody[0]?.w.t;
  }
  if (!component) component = codeWords.map((w) => ({ w, d: boxDist(w, p) })).filter((x) => x.d < 40).sort((a, b) => a.d - b.d)[0]?.w.t;
  if (tpin) {
    const m = TPIN.exec(tpin.t)!;
    return { kind: 'pin', connector: m[1], pin: m[2], component, at: p, track };
  }
  if (cpin) {
    const m = CPIN.exec(cpin.t)!;
    return { kind: 'pin', connector: m[1], pin: m[2], component: m[1], at: p, track };
  }
  if (component) {
    // fuses carry no pin numbers: the supply side is drawn above
    const isFuse = /^S\d+$/.test(component) && /fuse/i.test(sh.legend.get(component)?.text ?? '');
    const pin = isFuse ? (dir[1] > 0 ? '1' : '2') : (relay?.t ?? plain?.t ?? `?t${track ?? ''}`);
    return { kind: 'pin', connector: component, pin, component, at: p, track };
  }
  return { kind: 'open', at: p, track, near: sh.words.filter((w) => boxDist(w, p) < 16).slice(0, 5).map((w) => w.t).join(' ') };
}

// ---------------------------------------------------------------- whole publication

interface Fragment {
  diagram: number;
  sheet: number;
  circuit: string;
  b: Branch;
  dashedMeans?: string;
  starMeans?: string;
}

export interface VwImportOptions {
  title: string;
  vin: string;
  market: string;
  diagrams?: number[];
  debug?: string;
}

type Named = { name?: string };

export function importVw(pdf: string, opts: VwImportOptions): EwdData {
  const pageCount = Number(/Pages:\s+(\d+)/.exec(execFileSync('pdfinfo', [pdf]).toString())![1]);
  const allWords = readWords(pdf, 1, pageCount);
  // diagram and sheet of each page: "No. 14 / 4"
  const pages: { page: number; diagram: number; sheet: number }[] = [];
  for (const [page, ws] of allWords) {
    const top = ws.filter((w) => w.y1 < 45).sort((a, b) => a.x0 - b.x0);
    const i = top.findIndex((w) => w.t === 'No.');
    if (i < 0) continue;
    const m = /^(\d+)\/(\d+)/.exec(top.slice(i + 1).map((w) => w.t).join(''));
    if (m) pages.push({ page, diagram: Number(m[1]), sheet: Number(m[2]) });
  }
  const wanted = opts.diagrams ? new Set(opts.diagrams) : null;
  const data: EwdData = {
    publication: { title: opts.title, file: basename(pdf), vin: opts.vin, market: opts.market, pages: pageCount },
    circuits: [],
    components: {},
    connectors: {},
    wires: [],
    fuses: {},
    splices: {},
    grounds: {},
    stats: {},
  };
  const titles = new Map<number, string>();
  // T-connector codes belong to their diagram: "T2" in one diagram and "T2" in another can be different
  // connectors, so remember the legend text per diagram and decide the connector ids after reading them all
  const tLegend = new Map<string, Map<number, string>>();
  const frags: Fragment[] = [];
  const debugSheets: unknown[] = [];
  for (const pg of pages) {
    if (wanted && !wanted.has(pg.diagram)) continue;
    const ws = allWords.get(pg.page)!;
    if (pg.sheet === 1) {
      // the title page names the diagram and the date it applies from
      if (!titles.has(pg.diagram)) {
        const lines = ws.filter((w) => w.y0 > 40 && w.y0 < 180 && w.x0 < 520).sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
        const rows: string[] = [];
        let y = -1;
        for (const w of lines) {
          if (Math.abs(w.y0 - y) > 3) rows.push(w.t);
          else rows[rows.length - 1] += ` ${w.t}`;
          y = w.y0;
        }
        // title lines, "⇒ …" sub-titles, then the date it applies from
        const end = rows.findIndex((r) => /^(For alternatives|Relay locations|Note!|Fuse colours)/.test(r));
        const keep = (end > 0 ? rows.slice(0, end) : rows.slice(0, 4)).filter((r) => !/^Sharan|Current Flow Diagram|^No\./.test(r));
        titles.set(pg.diagram, keep.join(', ').replace(/\s+/g, ' ').replace(/ ,/g, ',').replace(/, ⇒/g, ' ⇒'));
      }
      continue;
    }
    const sh = readSheet(pg.page, ws, readShapes(pdf, pg.page), pg.diagram, pg.sheet);
    const circuit = `No. ${pg.diagram}/${pg.sheet}`;
    const branches = buildBranches(sh);
    for (const b of branches) frags.push({ diagram: pg.diagram, sheet: pg.sheet, circuit, b, dashedMeans: sh.dashedMeans, starMeans: sh.starMeans });
    const comps = new Set<string>();
    for (const [code, e] of sh.legend) {
      if (e.ringed) {
        if (/^Earth point|^Earth strap/i.test(e.text)) ((data.grounds[code] ??= { wires: [] }) as Named).name ??= e.text;
        else ((data.splices[code] ??= { wires: [] }) as Named).name ??= e.text;
        continue;
      }
      if (/^T\d/.test(code)) {
        // multi-pin connectors named in the legend ("T24 24-pin connector, on engine left")
        (tLegend.get(code) ?? tLegend.set(code, new Map()).get(code)!).set(pg.diagram, e.text);
        continue;
      }
      comps.add(code);
      const c = (data.components[code] ??= { name: e.text, connectors: [], circuits: [] });
      if (e.text.length > c.name.length) c.name = e.text;
      if (!c.circuits.includes(circuit)) c.circuits.push(circuit);
    }
    data.circuits.push({ id: circuit, section: `No. ${pg.diagram} ${titles.get(pg.diagram) ?? ''}`.trim(), title: sh.title, sheet: `${pg.sheet}`, page: pg.page, components: [...comps] });
    // fuse ratings printed under the fuse code ("S205" over "15A")
    for (const w of sh.words) {
      if (!/^S\d+$/.test(w.t) || !/fuse/i.test(sh.legend.get(w.t)?.text ?? '')) continue;
      const amps = sh.words.find((a) => AMPS.test(a.t) && a.y0 >= w.y0 - 1 && a.y0 - w.y1 < 6 && Math.abs(a.x0 - w.x0) < 14);
      const f = (data.fuses[w.t] ??= { between: [], sheets: [] });
      if (amps && f.rating === undefined) f.rating = Number(AMPS.exec(amps.t)![1].replace(',', '.'));
      if (!f.sheets.includes(circuit)) f.sheets.push(circuit);
    }
    if (opts.debug)
      debugSheets.push({ page: pg.page, circuit, band: sh.band, busY: sh.busY, left: sh.left, right: sh.right, branches: branches.map((b) => ({ pts: b.pts, ends: b.ends, csa: b.csa, colour: b.colour, dashed: b.dashed, star: b.star })) });
  }

  // ---- connector ids: one id per T code while every diagram describes the same connector; when the legends
  // describe different connectors, each one gets the number of the first diagram naming it ("T2.20")
  const words = (s: string) => new Set(s.toLowerCase().replace(/funcion/g, 'function').split(/[^a-z0-9]+/).filter((w) => w.length > 2));
  const alike = (a: Set<string>, b: Set<string>) => {
    let n = 0;
    for (const w of a) if (b.has(w)) n++;
    return n / Math.max(1, a.size + b.size - n) >= 0.75;
  };
  // the components a connector code's pins sit on, per diagram: a control unit's plug is the same plug in every
  // diagram even when one legend names it in full and another only as "68-pin connector"
  const onComp = new Map<string, Set<string>>();
  for (const f of frags)
    for (const e of f.b.ends)
      if (e.kind === 'pin' && e.component && /^T\d/.test(e.connector!) && !/^T\d/.test(e.component)) {
        const k = `${e.connector!.replace(/'$/, '')}|${f.diagram}`;
        (onComp.get(k) ?? onComp.set(k, new Set()).get(k)!).add(e.component);
      }
  const tId = new Map<string, string>();
  const tGroups = new Map<string, number>();
  for (const [code, byDiagram] of tLegend) {
    const groups: { name: string; words: Set<string>; comps: Set<string>; diagrams: number[] }[] = [];
    for (const [d, name] of [...byDiagram].sort((a, b) => a[0] - b[0])) {
      const w = words(name);
      const comps = onComp.get(`${code}|${d}`) ?? new Set<string>();
      const g = groups.find((x) => alike(x.words, w) || [...comps].some((c) => x.comps.has(c)));
      if (g) {
        g.diagrams.push(d);
        for (const c of comps) g.comps.add(c);
        if (name.length > g.name.length) g.name = name;
      } else groups.push({ name, words: w, comps: new Set(comps), diagrams: [d] });
    }
    tGroups.set(code, groups.length);
    for (const g of groups) {
      const id = groups.length === 1 ? code : `${code}.${g.diagrams[0]}`;
      for (const d of g.diagrams) tId.set(`${code}|${d}`, id);
      ((data.connectors[id] ??= { component: null, pins: {} }) as Named).name ??= g.name;
    }
  }
  const connectorId = (conn: string, diagram: number) => {
    const half = conn.endsWith("'") ? "'" : '';
    const base = half ? conn.slice(0, -1) : conn;
    if (!/^T\d/.test(base)) return conn;
    const id = tId.get(`${base}|${diagram}`) ?? ((tGroups.get(base) ?? 1) === 1 ? base : `${base}.${diagram}`);
    return id + half;
  };

  // ---- continuations: page-edge letters (to the neighbouring sheet) and boxed track references
  interface Run {
    frags: Fragment[];
    ends: End[];
  }
  const runs: Run[] = frags.map((f) => ({ frags: [f], ends: [...f.b.ends] }));
  const parent = new Map<Run, Run>();
  const find = (r: Run): Run => {
    while (parent.has(r)) r = parent.get(r)!;
    return r;
  };
  let joined = 0;
  const joinRuns = (x: Run, y: Run) => {
    const a = find(x);
    const b = find(y);
    if (a === b) return;
    parent.set(b, a);
    a.frags.push(...b.frags);
    a.ends.push(...b.ends);
    joined++;
  };
  const unresolved: string[] = [];
  // page-edge letters: a letter at a sheet's right edge continues at the same letter on the left edge of the
  // next sheet that prints it (a diagram can interleave sheets of another group), in drawing order
  const edges = new Map<string, { sheet: number; run: Run; y: number }[]>();
  for (const r of runs)
    for (const e of r.ends)
      if (e.kind === 'edge') {
        const k = `${r.frags[0].diagram}|${e.letter}|${e.side}`;
        (edges.get(k) ?? edges.set(k, []).get(k)!).push({ sheet: r.frags[0].sheet, run: r, y: e.at[1] });
      }
  for (const [k, rights] of edges) {
    if (!k.endsWith('|right')) continue;
    const lefts = [...(edges.get(k.replace(/\|right$/, '|left')) ?? [])].sort((a, b) => a.sheet - b.sheet || a.y - b.y);
    for (const r of [...rights].sort((a, b) => a.sheet - b.sheet || a.y - b.y)) {
      const i = lefts.findIndex((l) => l.sheet > r.sheet);
      if (i < 0) {
        unresolved.push(`${k}@${r.sheet}`);
        continue;
      }
      joinRuns(r.run, lefts[i].run);
      lefts.splice(i, 1);
    }
    for (const l of lefts) unresolved.push(`${k.replace(/\|right$/, '|left')}@${l.sheet}`);
  }
  // boxed track references: a box "[N]" at track T meets the box "[T]" drawn at track N
  const refs = new Map<string, Run[]>();
  for (const r of runs)
    for (const e of r.ends)
      if (e.kind === 'track' && e.track !== undefined) {
        const k = `${r.frags[0].diagram}|${e.track}>${e.target}`;
        (refs.get(k) ?? refs.set(k, []).get(k)!).push(r);
      }
  for (const [k, list] of refs) {
    const [d, pair] = k.split('|');
    const [from, to] = pair.split('>');
    const other = refs.get(`${d}|${to}>${from}`);
    if (!other?.length) {
      unresolved.push(`${k} (track)`);
      continue;
    }
    if (Number(from) > Number(to)) continue;
    for (let i = 0; i < Math.min(list.length, other.length); i++) joinRuns(list[i], other[i]);
  }
  const finalRuns = runs.filter((r) => !parent.has(r));

  // ---- wires
  const wires = new Map<string, EwdWire>();
  let open1 = 0;
  // a T-connector whose pins reach several components is a junction plug (the diagnosis socket), not a part's own plug
  const pinComps = new Map<string, Set<string>>();
  for (const r of finalRuns) {
    const diagram = r.frags[0].diagram;
    const keyOf = (e: End) => (e.kind === 'pin' ? `${connectorId(e.connector!, diagram)}-${e.pin}` : e.kind === 'splice' || e.kind === 'ground' ? e.id! : '');
    const ends = r.ends.filter((e) => e.kind === 'pin' || e.kind === 'splice' || e.kind === 'ground');
    const lab = r.frags.find((f) => f.b.colour)!;
    const endKeys = [...new Set(ends.map(keyOf))].filter(Boolean).slice(0, 2);
    if (endKeys.length < 2) open1++;
    const id = endKeys.length === 2 ? `W:${[...endKeys].sort().join('~')}` : `W:${endKeys[0] ?? 'none'}@${lab.circuit}#${Math.round(lab.b.pts[0][0])},${Math.round(lab.b.pts[0][1])}`;
    const sheets = [...new Set(r.frags.map((f) => f.circuit))];
    const prev = wires.get(id);
    if (prev) {
      for (const s of sheets) if (!prev.sheets.includes(s)) prev.sheets.push(s);
      continue;
    }
    const variant = r.frags.find((f) => f.b.dashed) ? r.frags.find((f) => f.b.dashed)!.dashedMeans : r.frags.find((f) => f.b.star)?.starMeans;
    wires.set(id, { id, colour: lab.b.colour!, csa: lab.b.csa ?? 0, ...(variant ? { option: variant } : {}), ends: endKeys, sheets });
    for (const e of ends) {
      if (e.kind === 'splice') ((data.splices[e.id!] ??= { wires: [] }) as Named).name ??= e.name;
      if (e.kind === 'ground') ((data.grounds[e.id!] ??= { wires: [] }) as Named).name ??= e.name;
      if (e.kind !== 'pin') continue;
      const conn = connectorId(e.connector!, diagram);
      const c = (data.connectors[conn] ??= { component: null, pins: {} });
      const inline = conn.endsWith("'") || (!e.component && /^T\d/.test(conn));
      if (!inline && e.component && !c.component) c.component = e.component;
      if (e.component && /^T\d/.test(conn)) (pinComps.get(conn) ?? pinComps.set(conn, new Set()).get(conn)!).add(e.component);
    }
  }
  for (const [conn, comps] of pinComps) if (comps.size > 1 && data.connectors[conn]) data.connectors[conn].component = null;
  data.wires = [...wires.values()].sort((a, b) => a.id.localeCompare(b.id));
  for (const w of data.wires)
    for (const e of w.ends) {
      if (data.splices[e]) data.splices[e].wires.push(w.id);
      else if (data.grounds[e]) data.grounds[e].wires.push(w.id);
      else {
        const i = e.lastIndexOf('-');
        const conn = e.slice(0, i);
        const pin = e.slice(i + 1);
        const c = (data.connectors[conn] ??= { component: null, pins: {} });
        const pp = (c.pins[pin] ??= { wires: [] });
        if (!pp.wires.includes(w.id)) pp.wires.push(w.id);
      }
    }
  // in-line connector halves mate; components list their connectors
  for (const [id, c] of Object.entries(data.connectors)) {
    if (id.endsWith("'")) {
      const upper = id.slice(0, -1);
      c.mates = upper;
      c.component = null;
      if (data.connectors[upper]) {
        data.connectors[upper].mates = id;
        data.connectors[upper].component = null;
      }
    }
  }
  for (const [id, c] of Object.entries(data.connectors)) {
    if (!c.component) continue;
    const comp = data.components[c.component];
    if (comp && !comp.connectors.includes(id)) comp.connectors.push(id);
  }
  for (const [k, s] of Object.entries(data.splices)) if (!s.wires.length) delete data.splices[k];
  for (const [k, g] of Object.entries(data.grounds)) if (!g.wires.length) delete data.grounds[k];
  for (const [k, c] of Object.entries(data.connectors)) if (!Object.keys(c.pins).length) delete data.connectors[k];
  const pinsTotal = Object.values(data.connectors).reduce((n, c) => n + Object.keys(c.pins).length, 0);
  data.stats = {
    sheets: data.circuits.length,
    components: Object.keys(data.components).length,
    connectors: Object.keys(data.connectors).length,
    connectorsWithComponent: Object.values(data.connectors).filter((c) => c.component).length,
    inlineConnectors: Object.values(data.connectors).filter((c) => c.mates).length,
    pins: pinsTotal,
    wires: data.wires.length,
    wiresBothEnds: data.wires.filter((w) => w.ends.length >= 2).length,
    wiresOneEnd: data.wires.filter((w) => w.ends.length === 1).length,
    fuses: Object.keys(data.fuses).length,
    splices: Object.keys(data.splices).length,
    grounds: Object.keys(data.grounds).length,
    continuationsJoined: joined,
    continuationsUnresolved: unresolved.length,
    wiresWithAnOpenEnd: open1,
  };
  if (opts.debug) {
    mkdirSync(opts.debug, { recursive: true });
    writeFileSync(join(opts.debug, 'sheets.json'), JSON.stringify(debugSheets));
    writeFileSync(join(opts.debug, 'unresolved.json'), JSON.stringify(unresolved, null, 1));
  }
  return data;
}

// ---------------------------------------------------------------- CLI
if (process.argv[1]?.endsWith('import-vw.ts')) {
  const [pdf, out] = process.argv.slice(2);
  const arg = (name: string, def = '') => {
    const i = process.argv.indexOf(`--${name}`);
    return i > 0 ? process.argv[i + 1] : def;
  };
  if (!pdf || !out) {
    console.error('usage: tsx tools/ewd/import-vw.ts <diagrams.pdf> <out.json> [--diagrams 1,2,14] [--title ..] [--vin ..] [--market ..] [--debug dir]');
    process.exit(1);
  }
  const diagrams = arg('diagrams') ? arg('diagrams').split(',').map(Number) : undefined;
  const data = importVw(pdf, { title: arg('title', 'Current Flow Diagram'), vin: arg('vin'), market: arg('market'), diagrams, debug: arg('debug') || undefined });
  writeFileSync(out, JSON.stringify(data));
  console.log(data.stats);
}
