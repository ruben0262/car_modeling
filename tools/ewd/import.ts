/**
 * Electrical Wiring Diagram (EWD) importer.
 *
 * Reads a Land Rover EWD publication (PDF with a text layer) and extracts
 * the netlist it prints: components and their translation codes, connectors
 * and pins, wires (id, colour, cross-section, option code) with the
 * endpoints drawn on the same baseline, splices, grounds, fuses and in-line
 * connector pairs. Geometry of the drawing is used only to associate words
 * with each other; nothing is inferred that the sheet does not print.
 *
 *   npx tsx tools/ewd/import.ts <ewd.pdf> <out.json> --title "..." --vin "080379>" --market RHD
 *
 * Requires `pdftotext` (poppler-utils).
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import type { EwdData, EwdWire } from '../../src/shared/wiring';

interface Word {
  t: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  yc: number;
}

const PIN = /^C\d[A-Z0-9]{1,8}-\d{1,3}[A-Z]?$/;
const WIRE = /^([A-Z0-9]{2,12}),([A-Z]{1,2}(?:-[A-Z]{1,2})?),(\d+(?:\.\d+)?)((?:,[A-Za-z0-9_]+)*)$/;
/** Early issues print wires without an id: "RD,25.0" or, in power and ground distribution, "RD,25.0,610" (length in mm). */
const BARE_WIRE = /^([A-Z]{1,2}(?:-[A-Z]{1,2})?),(\d+(?:\.\d+)?)(?:,(\d+))?$/;
const isWireLabel = (t: string) => WIRE.test(t) || BARE_WIRE.test(t);
const SPLICE = /^S\d[A-Z0-9]{2,9}$/;
const GROUND = /^G\d[A-Z0-9]{2,9}(?:-\d+)?$/;
const FUSE = /^F[A-Z]{0,2}\d{1,3}$/;
const CODE = /^\(([A-Z]\d{3})\)$/;
const SECTION = /^\d{3}-\d{2}$/;
/** Furthest a wire label is printed from the endpoint it belongs to (pt). */
const MAX_GAP = Number(process.env.EWD_MAX_GAP ?? 140);
const SIGNALS = /^(SIG|GND|IGN|BATT|LIN|CAN|CANH|CANL|HI|LO|H|L|\+|-|5V|12V|VREF|RTN|SUPPLY|POWER|OUT|IN|SHIELD|WAKE|MOST|PWM|DATA|SCK|TX|RX)$/;

function isEndpoint(t: string): boolean {
  return PIN.test(t) || SPLICE.test(t) || GROUND.test(t);
}

function parsePages(xml: string): Word[][] {
  const pages: Word[][] = [];
  for (const chunk of xml.split('<page ').slice(1)) {
    const words: Word[] = [];
    for (const m of chunk.matchAll(/<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]*)<\/word>/g)) {
      const t = m[5].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');
      const [x0, y0, x1, y1] = [m[1], m[2], m[3], m[4]].map(Number);
      words.push({ t, x0, y0, x1, y1, yc: (y0 + y1) / 2 });
    }
    pages.push(words);
  }
  return pages;
}

const sameLine = (a: Word, b: Word) => Math.abs(a.yc - b.yc) < 2.2;

/** Reassembles a component label ending in "(X123)": words to its left on the same line plus wrapped lines above. */
function labelFor(code: Word, words: Word[]): string {
  const left = words
    .filter((w) => sameLine(w, code) && w.x1 <= code.x0 + 1 && code.x0 - w.x1 < 60 && !isEndpoint(w.t) && !WIRE.test(w.t))
    .sort((a, b) => b.x0 - a.x0);
  const parts: Word[] = [];
  let edge = code.x0;
  for (const w of left) {
    if (edge - w.x1 > 8) break;
    parts.unshift(w);
    edge = w.x0;
  }
  const lineStart = parts.length ? parts[0].x0 : code.x0;
  let text = parts.map((w) => w.t).join(' ');
  // labels wrap only after a hyphen ("Sensor-Tire-" / "Rear-LH (T293)"), so a line
  // above belongs to this label only when it ends with "-"
  let y = (parts[0] ?? code).y0;
  for (let k = 0; k < 3; k++) {
    const above = words
      .filter((w) => w.y1 <= y + 0.5 && y - w.y1 < 4 && Math.abs(w.x0 - lineStart) < 40 && !isEndpoint(w.t) && !WIRE.test(w.t) && !CODE.test(w.t))
      .sort((a, b) => a.x0 - b.x0);
    if (!above.length) break;
    const lineText = above.map((w) => w.t).join(' ');
    const stacked = above.every((w) => y - w.y1 < 1.6);
    const nameLike = /[a-z]/.test(lineText) && !/Amps|Sheet\d|^\d/.test(lineText) && !above.some((w) => SIGNALS.test(w.t) || FUSE.test(w.t));
    if (!stacked || !nameLike) break;
    text = lineText.endsWith('-') ? lineText + text : `${lineText} ${text}`;
    y = Math.min(...above.map((w) => w.y0));
  }
  return text.replace(/\s+/g, ' ').replace(/- /g, '-').trim();
}

export function importEwd(pdf: string, meta: { title: string; vin: string; market: string }): EwdData {
  const xml = execFileSync('pdftotext', ['-bbox', pdf, '-'], { maxBuffer: 1 << 28 }).toString('utf8');
  const pages = parsePages(xml);
  const data: EwdData = {
    publication: { ...meta, file: basename(pdf), pages: pages.length },
    circuits: [],
    components: {},
    connectors: {},
    wires: [],
    fuses: {},
    splices: {},
    grounds: {},
    stats: {},
  };
  const wires = new Map<string, EwdWire>();
  const pinVotes = new Map<string, Map<string, number>>();
  const signalOf = new Map<string, string>();
  const endVotes = new Map<string, Map<string, number>>();

  pages.forEach((words, pi) => {
    if (!words.length) return;
    const top = Math.min(...words.map((w) => w.y0));
    const header = words.filter((w) => w.y0 < top + 4).sort((a, b) => a.x0 - b.x0);
    const sectionWord = header.find((w) => SECTION.test(w.t));
    // engineering issues (JLR Engineering Electrical Circuit Diagrams) head each sheet
    // "<NAME> CIRCUIT <drawing no.>" and number it "System Page 01 of 03" in the footer
    const eng = sectionWord ? null : header.map((w) => w.t).join(' ').match(/^(.*?\bCIRCUIT)\b\s*([0-9A-Z]{4}-[0-9A-Z]{5}-[A-Z0-9]{1,2}-[A-Z0-9]{1,2})?/);
    if (!sectionWord && !eng) return; // not a circuit sheet
    if (!words.some((w) => CODE.test(w.t))) return; // contents/index pages carry no components
    const bottom = Math.max(...words.map((w) => w.y1));
    const footer = words.filter((w) => w.y1 > bottom - 4).sort((a, b) => a.x0 - b.x0);
    const footerText = footer.map((w) => w.t).join(' ');
    const sheetMatch = footerText.match(/\((\d+)\s*\/\s*(\d+)\)/) ?? footerText.match(/System Page (\d+) of (\d+)/);
    // header: "<code> - <SECTION NAME> <Circuit title>" — the title is the right-hand group
    const gapAt = header.findIndex((w, i) => i > 0 && w.x0 - header[i - 1].x1 > 40);
    const sectionName = header
      .slice(1, gapAt > 0 ? gapAt : undefined)
      .map((w) => w.t)
      .join(' ')
      .replace(/^- /, '');
    const title = gapAt > 0 ? header.slice(gapAt).map((w) => w.t).join(' ') : '';
    const sheet = sheetMatch ? `${sheetMatch[1]}/${sheetMatch[2]}` : '1/1';
    const circuitId = eng ? `${eng[1]} ${sheet}` : `${sectionWord!.t} ${title || sectionName} ${sheet}`.trim();
    const body = words.filter((w) => w.y0 >= top + 4 && w.y1 <= bottom - 4);
    const circuitComponents = new Set<string>();

    // components (label + code) on this sheet
    const labels: { code: string; name: string; box: { x0: number; y0: number; x1: number; y1: number } }[] = [];
    for (const w of body) {
      const m = CODE.exec(w.t);
      if (!m) continue;
      const name = labelFor(w, body);
      labels.push({ code: m[1], name, box: { x0: w.x0 - 60, y0: w.y0 - 12, x1: w.x1, y1: w.y1 } });
      circuitComponents.add(m[1]);
      const c = (data.components[m[1]] ??= { name, connectors: [], circuits: [] });
      if (name.length > c.name.length) c.name = name;
      if (!c.circuits.includes(circuitId)) c.circuits.push(circuitId);
    }

    // pins → nearest component label (votes accumulate across sheets)
    for (const w of body) {
      if (!PIN.test(w.t)) continue;
      const conn = w.t.slice(0, w.t.lastIndexOf('-'));
      const cx = (w.x0 + w.x1) / 2;
      let best: string | null = null;
      let bestD = 90;
      for (const l of labels) {
        const dx = Math.max(l.box.x0 - cx, 0, cx - l.box.x1);
        const dy = Math.max(l.box.y0 - w.yc, 0, w.yc - l.box.y1);
        const d = Math.hypot(dx, dy * 1.4);
        if (d < bestD) {
          bestD = d;
          best = l.code;
        }
      }
      if (best) {
        const votes = pinVotes.get(conn) ?? new Map<string, number>();
        votes.set(best, (votes.get(best) ?? 0) + 1);
        pinVotes.set(conn, votes);
      }
      // signal name printed beside the pin, inside the component outline
      const sig = body.find((s) => sameLine(s, w) && SIGNALS.test(s.t) && Math.min(Math.abs(s.x0 - w.x1), Math.abs(w.x0 - s.x1)) < 30);
      if (sig) signalOf.set(w.t, sig.t);
      const pinNo = w.t.slice(conn.length + 1);
      const c = (data.connectors[conn] ??= { component: null, pins: {} });
      c.pins[pinNo] ??= { wires: [] };
    }

    // in-line connector pairs: two pins side by side, same pin number, no wire between
    const pins = body.filter((w) => PIN.test(w.t)).sort((a, b) => a.x0 - b.x0);
    for (const a of pins)
      for (const b of pins) {
        if (a === b || !sameLine(a, b) || b.x0 < a.x1 || b.x0 - a.x1 > 14) continue;
        const [ca, pa] = [a.t.slice(0, a.t.lastIndexOf('-')), a.t.slice(a.t.lastIndexOf('-') + 1)];
        const [cb, pb] = [b.t.slice(0, b.t.lastIndexOf('-')), b.t.slice(b.t.lastIndexOf('-') + 1)];
        if (pa === pb && ca !== cb) {
          data.connectors[ca].mates = cb;
          data.connectors[cb].mates = ca;
        }
      }

    // wires: nearest endpoint on each side, same baseline
    for (const w of body) {
      const labelled = WIRE.exec(w.t);
      const bare = labelled ? null : BARE_WIRE.exec(w.t);
      if (!labelled && !bare) continue;
      // an unlabelled wire gets a provisional id here and a stable one from its two ends below
      const [, id, colour, csa, rest] = labelled ?? [w.t, `?${pi}:${Math.round(w.x0)}:${Math.round(w.yc)}`, bare![1], bare![2], bare![3] ? `,${bare![3]}` : ''];
      const extras = rest.split(',').filter(Boolean);
      const option = extras.find((e) => !/^\d+$/.test(e));
      const length = extras.find((e) => /^\d+$/.test(e));
      const onLine = body.filter((o) => o !== w && sameLine(o, w));
      const leftEnd = onLine.filter((o) => o.x1 <= w.x0 + 1 && w.x0 - o.x1 < MAX_GAP && isEndpoint(o.t)).sort((a, b) => b.x1 - a.x1)[0];
      const rightEnd = onLine.filter((o) => o.x0 >= w.x1 - 1 && o.x0 - w.x1 < MAX_GAP && isEndpoint(o.t)).sort((a, b) => a.x0 - b.x0)[0];
      // an endpoint only counts if no other wire label sits between it and this label
      const clear = (e: Word | undefined, side: 'l' | 'r') =>
        e && !onLine.some((o) => isWireLabel(o.t) && (side === 'l' ? o.x0 > e.x1 && o.x1 < w.x0 : o.x0 > w.x1 && o.x1 < e.x0)) ? e.t : null;
      const ends = [clear(leftEnd, 'l'), clear(rightEnd, 'r')].filter((e): e is string => !!e);
      const rec = wires.get(id) ?? { id, colour, csa: Number(csa), ends: [], sheets: [] };
      if (option && !rec.option) rec.option = option;
      if (length && !rec.length) rec.length = Number(length);
      const votes = endVotes.get(id) ?? new Map<string, number>();
      for (const e of ends) votes.set(e, (votes.get(e) ?? 0) + 1);
      endVotes.set(id, votes);
      if (!rec.sheets.includes(circuitId)) rec.sheets.push(circuitId);
      wires.set(id, rec);
    }

    // fuses: rating printed below/next to the fuse id; flanked by box terminals
    for (const w of body) {
      if (!FUSE.test(w.t)) continue;
      const rating = body.find((r) => /^\d+(\.\d+)?$/.test(r.t) && r.y0 >= w.y0 - 1 && r.y0 - w.y1 < 12 && Math.abs(r.x0 - w.x0) < 20 && body.some((a) => a.t === 'Amps' && sameLine(a, r)));
      const onLine = body.filter((o) => sameLine(o, w) && PIN.test(o.t));
      const l = onLine.filter((o) => o.x1 <= w.x0 + 1).sort((a, b) => b.x1 - a.x1)[0];
      const r = onLine.filter((o) => o.x0 >= w.x1 - 1).sort((a, b) => a.x0 - b.x0)[0];
      const f = (data.fuses[w.t] ??= { between: [], sheets: [] });
      if (rating && f.rating === undefined) f.rating = Number(rating.t);
      for (const p of [l, r]) if (p && !f.between.includes(p.t)) f.between.push(p.t);
      if (!f.sheets.includes(circuitId)) f.sheets.push(circuitId);
    }

    data.circuits.push({
      id: circuitId,
      section: eng ? `${eng[1]}${eng[2] ? ` (${eng[2]})` : ''}` : `${sectionWord!.t} ${sectionName}`.trim(),
      title: eng ? eng[1] : title || sectionName,
      sheet,
      page: pi + 1,
      components: [...circuitComponents],
    });
  });

  // resolve connector ownership and pin → wire index
  for (const [conn, votes] of pinVotes) {
    const [code] = [...votes].sort((a, b) => b[1] - a[1])[0];
    const c = data.connectors[conn];
    // in-line connectors sit between harnesses, not on a component
    if (c && !c.mates) {
      c.component = code;
      const comp = data.components[code];
      if (comp && !comp.connectors.includes(conn)) comp.connectors.push(conn);
    }
  }
  // a wire is one conductor: keep its two best-supported ends (first seen wins ties)
  for (const [id, votes] of endVotes) {
    const ranked = [...votes].sort((a, b) => b[1] - a[1]);
    const keep: string[] = [];
    for (const [e] of ranked) {
      // never keep both a ground eyelet and its bare id
      if (keep.some((k) => k.replace(/-\d+$/, '') === e.replace(/-\d+$/, '') && (GROUND.test(k) || GROUND.test(e)))) continue;
      keep.push(e);
      if (keep.length === 2) break;
    }
    wires.get(id)!.ends = keep;
  }
  // unlabelled wires: a conductor drawn again without its id is merged into the labelled wire with the same
  // ends; otherwise its id is built from its ends, so its appearances on several sheets merge with each other
  const byEnds = new Map<string, string>();
  const byPin = new Map<string, string[]>();
  for (const [id, rec] of wires) {
    if (id.startsWith('?')) continue;
    if (rec.ends.length === 2) byEnds.set([...rec.ends].sort().join('~'), id);
    for (const e of rec.ends) if (PIN.test(e)) byPin.set(e, [...(byPin.get(e) ?? []), id]);
  }
  const merge = (into: EwdWire, rec: EwdWire) => {
    for (const sh of rec.sheets) if (!into.sheets.includes(sh)) into.sheets.push(sh);
    if (rec.length && !into.length) into.length = rec.length;
  };
  const unlabelled = [...wires].filter(([id]) => id.startsWith('?'));
  // two-ended first, so one-ended fragments can join them
  unlabelled.sort((a, b) => b[1].ends.length - a[1].ends.length);
  for (const [id, rec] of unlabelled) {
    wires.delete(id);
    const key = [...rec.ends].sort().join('~');
    const same = rec.ends.length === 2 ? byEnds.get(key) : undefined;
    const onPin = rec.ends.length === 1 && PIN.test(rec.ends[0]) ? (byPin.get(rec.ends[0]) ?? []) : [];
    const target = same ?? (onPin.length === 1 ? onPin[0] : undefined);
    if (target && wires.has(target)) {
      merge(wires.get(target)!, rec);
      continue;
    }
    const stable = rec.ends.length === 2 ? `W:${key}` : rec.ends.length === 1 ? `W:${rec.ends[0]}` : `W:none@${id.slice(1)}`;
    const prev = wires.get(stable);
    if (prev) merge(prev, rec);
    else {
      wires.set(stable, { ...rec, id: stable });
      if (rec.ends.length === 2) byEnds.set(key, stable);
      for (const e of rec.ends) if (PIN.test(e)) byPin.set(e, [...(byPin.get(e) ?? []), stable]);
    }
  }
  data.wires = [...wires.values()].sort((a, b) => a.id.localeCompare(b.id));
  for (const w of data.wires)
    for (const e of w.ends) {
      if (PIN.test(e)) {
        const conn = e.slice(0, e.lastIndexOf('-'));
        const pin = e.slice(conn.length + 1);
        const c = (data.connectors[conn] ??= { component: null, pins: {} });
        const p = (c.pins[pin] ??= { wires: [] });
        if (!p.wires.includes(w.id)) p.wires.push(w.id);
        const sig = signalOf.get(e);
        if (sig) p.signal = sig;
      } else if (SPLICE.test(e)) (data.splices[e] ??= { wires: [] }).wires.push(w.id);
      else if (GROUND.test(e)) (data.grounds[e.replace(/-\d+$/, '')] ??= { wires: [] }).wires.push(w.id);
    }
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
  };
  return data;
}

// ---------------------------------------------------------------- CLI
if (process.argv[1]?.endsWith('import.ts')) {
  const [pdf, out] = process.argv.slice(2);
  const arg = (name: string, def: string) => {
    const i = process.argv.indexOf(`--${name}`);
    return i > 0 ? process.argv[i + 1] : def;
  };
  if (!pdf || !out) {
    console.error('usage: tsx tools/ewd/import.ts <ewd.pdf> <out.json> [--title ..] [--vin ..] [--market ..]');
    process.exit(1);
  }
  const data = importEwd(pdf, { title: arg('title', 'Electrical Wiring Diagrams'), vin: arg('vin', ''), market: arg('market', '') });
  writeFileSync(out, JSON.stringify(data));
  console.log(data.stats);
}
