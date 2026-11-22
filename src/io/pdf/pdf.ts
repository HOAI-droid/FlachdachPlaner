/**
 * Minimaler PDF-Schreiber (PLAN Schritt 28): Vektorlinien, Flächen, Text in Helvetica (Basis-14, WinAnsi).
 * Keine Abhängigkeit. Alle Maße in Millimetern, Ursprung unten links, y nach oben.
 */

export interface Punkt { readonly x: number; readonly y: number }

export interface LinienOpt {
  /** Strichstärke in mm. */
  breite?: number;
  farbe?: string;
  /** Strichmuster in mm (an, aus, …). */
  strich?: readonly number[];
  zu?: boolean;
}
export interface FlaechenOpt extends LinienOpt {
  /** Füllfarbe; fehlt sie, wird nur der Rand gezeichnet. */
  fuell?: string;
}
export interface TextOpt {
  /** Schriftgröße in mm. */
  groesse?: number;
  fett?: boolean;
  anker?: "l" | "m" | "r";
  /** Drehung gegen den Uhrzeigersinn (rad). */
  winkel?: number;
  farbe?: string;
}

const PT = 72 / 25.4;
const f = (n: number): string => (Math.round(n * 1000) / 1000).toString();

// Helvetica-Laufweiten (1/1000 em), ASCII 32…126.
const W = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
  1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
  333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
  556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];
const BASIS: Record<string, string> = { ä: "a", ö: "o", ü: "u", Ä: "A", Ö: "O", Ü: "U", ß: "B" };

/** Eingabetext → WinAnsi-Byte je Zeichen (nicht darstellbare Zeichen werden ersetzt). */
function winAnsi(s: string): number[] {
  const out: number[] = [];
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    if (c === 0x202f || c === 0xa0) out.push(0x20);
    else if (c === 0x2212) out.push(0x2d);
    else if (c === 0x2013) out.push(0x96);
    else if (c === 0x2014) out.push(0x97);
    else if (c === 0x2026) out.push(0x85);
    else if (c === 0x20ac) out.push(0x80);
    else if (c < 256) out.push(c);
    else out.push(0x3f);
  }
  return out;
}

/** Textbreite in mm. */
export function textBreite(s: string, groesse: number, fett = false): number {
  let w = 0;
  for (const b of winAnsi(s)) {
    const ch = String.fromCharCode(b);
    const base = BASIS[ch];
    if (base) w += base === "B" ? 611 : (W[base.charCodeAt(0) - 32] ?? 556);
    else if (b === 0xd8) w += 778;
    else if (b >= 32 && b <= 126) w += W[b - 32]!;
    else if (b === 0xb7) w += 278;
    else if (b === 0xb0) w += 400;
    else w += 556;
  }
  return (w / 1000) * groesse * (fett ? 1.06 : 1);
}

function farbOps(hex: string, strich: boolean): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  const v = m ? m[1]! : "000000";
  const c = [0, 2, 4].map((i) => f(parseInt(v.slice(i, i + 2), 16) / 255));
  return `${c.join(" ")} ${strich ? "RG" : "rg"}`;
}

export class PdfSeite {
  private readonly ops: string[] = [];
  constructor(readonly breite: number, readonly hoehe: number) {}

  private stil(o: LinienOpt): string {
    const strich = o.strich && o.strich.length > 0 ? `[${o.strich.map((v) => f(v * PT)).join(" ")}] 0 d` : "[] 0 d";
    return `${f((o.breite ?? 0.25) * PT)} w ${farbOps(o.farbe ?? "#000000", true)} ${strich} 1 j 1 J`;
  }
  private pfad(ringe: readonly (readonly Punkt[])[], zu: boolean): string {
    const s: string[] = [];
    for (const r of ringe) {
      r.forEach((p, i) => s.push(`${f(p.x * PT)} ${f(p.y * PT)} ${i ? "l" : "m"}`));
      if (zu) s.push("h");
    }
    return s.join("\n");
  }

  linie(pts: readonly Punkt[], o: LinienOpt = {}): void {
    if (pts.length < 2) return;
    this.ops.push(`q ${this.stil(o)}\n${this.pfad([pts], o.zu ?? false)}\nS Q`);
  }
  /** Fläche aus Ringen (Even-Odd, Löcher möglich). */
  flaeche(ringe: readonly (readonly Punkt[])[], o: FlaechenOpt = {}): void {
    const rand = o.breite !== 0;
    const op = o.fuell ? (rand ? "B*" : "f*") : "S";
    const fill = o.fuell ? `${farbOps(o.fuell, false)} ` : "";
    this.ops.push(`q ${fill}${this.stil(o)}\n${this.pfad(ringe, true)}\n${op} Q`);
  }
  kreis(c: Punkt, r: number, o: FlaechenOpt = {}): void {
    const k = 0.5523 * r, x = c.x, y = c.y;
    const bez = (a: number, b: number, c2: number, d: number, e: number, g: number) =>
      `${f(a * PT)} ${f(b * PT)} ${f(c2 * PT)} ${f(d * PT)} ${f(e * PT)} ${f(g * PT)} c`;
    const p = [
      `${f((x + r) * PT)} ${f(y * PT)} m`,
      bez(x + r, y + k, x + k, y + r, x, y + r), bez(x - k, y + r, x - r, y + k, x - r, y),
      bez(x - r, y - k, x - k, y - r, x, y - r), bez(x + k, y - r, x + r, y - k, x + r, y), "h",
    ].join("\n");
    const op = o.fuell ? (o.breite === 0 ? "f" : "B") : "S";
    this.ops.push(`q ${o.fuell ? farbOps(o.fuell, false) + " " : ""}${this.stil(o)}\n${p}\n${op} Q`);
  }
  text(s: string, x: number, y: number, o: TextOpt = {}): void {
    const g = o.groesse ?? 2.5, fett = o.fett ?? false;
    const w = textBreite(s, g, fett);
    const ax = o.anker === "m" ? -w / 2 : o.anker === "r" ? -w : 0;
    const a = o.winkel ?? 0, c = Math.cos(a), sn = Math.sin(a);
    const bytes = winAnsi(s).map((b) => (b === 0x28 || b === 0x29 || b === 0x5c ? `\\${String.fromCharCode(b)}` : b < 32 || b > 126 ? `\\${b.toString(8).padStart(3, "0")}` : String.fromCharCode(b))).join("");
    // Verschiebung des Ankers entlang der Textrichtung
    const tx = x + ax * c, ty = y + ax * sn;
    this.ops.push(`q BT ${farbOps(o.farbe ?? "#000000", false)} /${fett ? "F2" : "F1"} ${f(g * PT)} Tf ${f(c)} ${f(sn)} ${f(-sn)} ${f(c)} ${f(tx * PT)} ${f(ty * PT)} Tm (${bytes}) Tj ET Q`);
  }
  inhalt(): string { return this.ops.join("\n"); }
}

export class PdfDokument {
  readonly seiten: PdfSeite[] = [];
  constructor(private readonly titel = "") {}
  seite(breite: number, hoehe: number): PdfSeite { const s = new PdfSeite(breite, hoehe); this.seiten.push(s); return s; }

  bytes(): Uint8Array {
    // Objekte: 1 Katalog, 2 Seitenbaum, 3/4 Schriften, 5 Info, danach je Seite (Seite, Inhalt)
    const teile: string[] = [];
    const offs: number[] = [];
    let len = 0;
    const emit = (s: string) => { teile.push(s); len += s.length; };
    const obj = (nr: number, body: string) => { offs[nr] = len; emit(`${nr} 0 obj\n${body}\nendobj\n`); };
    emit("%PDF-1.4\n%âãÏÓ\n");
    const kinder = this.seiten.map((_, i) => `${6 + i * 2} 0 R`).join(" ");
    obj(1, "<< /Type /Catalog /Pages 2 0 R >>");
    obj(2, `<< /Type /Pages /Kids [${kinder}] /Count ${this.seiten.length} >>`);
    obj(3, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
    obj(4, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
    obj(5, `<< /Title <${titelHex(this.titel)}> /Producer (FlachdachPlaner) >>`);
    this.seiten.forEach((s, i) => {
      const nr = 6 + i * 2, inhalt = s.inhalt();
      obj(nr, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${f(s.breite * PT)} ${f(s.hoehe * PT)}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${nr + 1} 0 R >>`);
      obj(nr + 1, `<< /Length ${inhalt.length} >>\nstream\n${inhalt}\nendstream`);
    });
    const n = 6 + this.seiten.length * 2;
    const xref = len;
    let x = `xref\n0 ${n}\n0000000000 65535 f \n`;
    for (let i = 1; i < n; i++) x += `${String(offs[i]).padStart(10, "0")} 00000 n \n`;
    emit(`${x}trailer\n<< /Size ${n} /Root 1 0 R /Info 5 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
    // Alle Zeichen < 256 (Latin-1) → Byte; Textinhalt ist per Escape reines ASCII.
    const out = new Uint8Array(len);
    let p = 0;
    for (const t of teile) for (let i = 0; i < t.length; i++) out[p++] = t.charCodeAt(i) & 0xff;
    return out;
  }
}

/** PDF-Textstring als UTF-16BE mit BOM (Hex), damit Umlaute im Titel erhalten bleiben. */
function titelHex(t: string): string {
  let h = "FEFF";
  for (let i = 0; i < t.length; i++) h += t.charCodeAt(i).toString(16).toUpperCase().padStart(4, "0");
  return h;
}
