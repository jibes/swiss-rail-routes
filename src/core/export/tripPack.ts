// The compact form of a `#/s/` link (0.21.0): the same trip as before, packed as numbers instead
// of JSON text. Stations by their SLOID (or UIC) number, the stable key DIDOK and OJP share, not a
// row of the bundled index (rows move with every data update); each station once, in a table the
// rest points into. Rides by their packed journey id, boarding and alighting stop and times, as
// minute steps; strings (lines, categories, scenic lines) once each. Platforms and product names
// are left out: they come back when the link opens (refresh.ts). A CRC-16 over the bytes tells a
// link cut short from a trip, and the text ends in `z`, a letter link detectors keep: base64url can
// end in `-` or `_`, which they drop from the end of a link (the cause of links that "broke").

export class Writer {
  readonly bytes: number[] = [];
  uv(n: number) {
    if (!Number.isInteger(n) || n < 0) throw new Error(`uv ${n}`);
    while (n >= 0x80) {
      this.bytes.push((n % 0x80) | 0x80);
      n = Math.floor(n / 0x80);
    }
    this.bytes.push(n);
  }
  /** Signed: zigzag. */
  sv(n: number) {
    this.uv(n < 0 ? -n * 2 - 1 : n * 2);
  }
  str(s: string) {
    const b = new TextEncoder().encode(s);
    this.uv(b.length);
    for (const x of b) this.bytes.push(x);
  }
}

export class Reader {
  private i = 0;
  constructor(private readonly b: Uint8Array) {}
  uv(): number {
    let n = 0;
    let mul = 1;
    for (;;) {
      if (this.i >= this.b.length) throw new Error('short');
      const x = this.b[this.i++]!;
      n += (x & 0x7f) * mul;
      if (x < 0x80) return n;
      mul *= 0x80;
      if (mul > 2 ** 49) throw new Error('long');
    }
  }
  byte(): number {
    if (this.i >= this.b.length) throw new Error('short');
    return this.b[this.i++]!;
  }
  sv(): number {
    const n = this.uv();
    return n % 2 ? -(n + 1) / 2 : n / 2;
  }
  str(): string {
    const n = this.uv();
    if (this.i + n > this.b.length) throw new Error('short');
    const s = new TextDecoder().decode(this.b.subarray(this.i, this.i + n));
    this.i += n;
    return s;
  }
  get done() {
    return this.i === this.b.length;
  }
}

/** CRC-16/CCITT-FALSE. */
export function crc16(b: ArrayLike<number>): number {
  let c = 0xffff;
  for (let i = 0; i < b.length; i++) {
    c ^= b[i]! << 8;
    for (let k = 0; k < 8; k++) c = c & 0x8000 ? ((c << 1) ^ 0x1021) & 0xffff : (c << 1) & 0xffff;
  }
  return c;
}

const SLOID = /^ch:1:sloid:(\d+)$/;
const QUAY = /^ch:1:sloid:(\d+):(\d+):(\d+)$/;
const DIGITS = /^[1-9]\d*$/;
const PLAIN = /^(0|[1-9]\d*)$/;

/**
 * A stop ref as one number where it can be: a SLOID station, a SLOID platform, a UIC number, or
 * as written; `named` (the link carries its own name for it) rides along in the lowest bit.
 */
export function writeRef(w: Writer, ref: string, named: boolean) {
  const n = named ? 1 : 0;
  let m: RegExpExecArray | null;
  if ((m = SLOID.exec(ref)) && PLAIN.test(m[1]!)) w.uv(Number(m[1]) * 8 + n);
  else if ((m = QUAY.exec(ref)) && PLAIN.test(m[1]!) && PLAIN.test(m[2]!) && PLAIN.test(m[3]!)) {
    w.uv(Number(m[1]) * 8 + 2 + n);
    w.uv(Number(m[2]));
    w.uv(Number(m[3]));
  } else if (DIGITS.test(ref) && Number.isSafeInteger(Number(ref))) w.uv(Number(ref) * 8 + 4 + n);
  else {
    w.uv(6 + n);
    w.str(ref);
  }
}

export function readRef(r: Reader): { ref: string; named: boolean } {
  const v = r.uv();
  const n = Math.floor(v / 8);
  const named = v % 2 === 1;
  switch ((v % 8) >> 1) {
    case 0:
      return { ref: `ch:1:sloid:${n}`, named };
    case 1:
      return { ref: `ch:1:sloid:${n}:${r.uv()}:${r.uv()}`, named };
    case 2:
      return { ref: String(n), named };
    default:
      return { ref: r.str(), named };
  }
}

const SJYID = /^ch:1:sjyid:(\d+):(\d+)(?:-(\d+))?$/;
const PLANNED = /^ch:1:sjyid:(\d+):plan:(\d+)$/;
const PLANNED_UUID =
  /^ch:1:sjyid:(\d+):plan:([0-9a-f]{8})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{12})$/;
const DATED = /^(\d{4}-\d{2}-\d{2}):(.+)$/;
const dayDiff = (a: string, b: string) => Math.round((Date.parse(a) - Date.parse(b)) / 86_400_000);
const addDays = (d: string, n: number) =>
  new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** Digits with up to 7 leading zeros as one number (`01129` → 1129·8 + 1). */
const zeros = (d: string) => d.length - d.replace(/^0+(?=\d)/, '').length;
const packable = (d: string) => zeros(d) < 8 && Number.isSafeInteger(Number(d) * 8);
const writeDigits = (w: Writer, d: string) => w.uv(Number(d) * 8 + zeros(d));
function readDigits(r: Reader) {
  const v = r.uv();
  return '0'.repeat(v % 8) + String(Math.floor(v / 8));
}

/** The forms a journey id comes in (seen in OJP's answers, Nov 2026), and as written. */
const enum J {
  Number,
  NumberRun,
  Planned,
  PlannedUuid,
  Dated,
  Raw,
}
const KINDS = 6;
const NEAR = 3 * (KINDS - 1);

/**
 * A dated journey id (`<day>:ch:1:sjyid:<operator>:<number>-<run>`, `…:plan:<number>`, `…:plan:
 * <uuid>`): its form and the day's offset from the trip's in one number, the operator through the
 * string table (`str` writes its index), the rest as numbers or bytes; anything else as written.
 */
export function writeJourney(w: Writer, j: string, date: string, str: (s: string) => void) {
  const dated = DATED.exec(j);
  const rest = dated?.[2] ?? '';
  const n = dated ? SJYID.exec(rest) : null;
  const p = dated ? PLANNED.exec(rest) : null;
  const u = dated ? PLANNED_UUID.exec(rest) : null;
  const kind =
    n && packable(n[2]!) && (n[3] === undefined || packable(n[3]))
      ? n[3] === undefined
        ? J.Number
        : J.NumberRun
      : p && packable(p[2]!)
        ? J.Planned
        : u
          ? J.PlannedUuid
          : dated
            ? J.Dated
            : J.Raw;
  const off = dated ? dayDiff(dated[1]!, date) : 0;
  if (kind !== J.Raw && Math.abs(off) <= 1) w.uv(kind * 3 + off + 1);
  else {
    w.uv(NEAR + kind);
    if (kind !== J.Raw) w.sv(off);
  }
  if (kind === J.Number || kind === J.NumberRun) {
    str(n![1]!);
    writeDigits(w, n![2]!);
    if (kind === J.NumberRun) writeDigits(w, n![3]!);
  } else if (kind === J.Planned) {
    str(p![1]!);
    writeDigits(w, p![2]!);
  } else if (kind === J.PlannedUuid) {
    str(u![1]!);
    const hex = u!.slice(2).join('');
    for (let i = 0; i < 32; i += 2) w.bytes.push(parseInt(hex.slice(i, i + 2), 16));
  } else w.str(kind === J.Dated ? rest : j);
}

export function readJourney(r: Reader, date: string, str: () => string): string {
  const code = r.uv();
  const kind: J = code < NEAR ? Math.floor(code / 3) : code - NEAR;
  if (kind > J.Raw) throw new Error('journey');
  const off = code < NEAR ? (code % 3) - 1 : kind !== J.Raw ? r.sv() : 0;
  const day = `${addDays(date, off)}:`;
  switch (kind) {
    case J.Number:
    case J.NumberRun: {
      const op = str();
      const num = readDigits(r);
      const run = kind === J.NumberRun ? `-${readDigits(r)}` : '';
      return `${day}ch:1:sjyid:${op}:${num}${run}`;
    }
    case J.Planned:
      return `${day}ch:1:sjyid:${str()}:plan:${readDigits(r)}`;
    case J.PlannedUuid: {
      const op = str();
      const hex = Array.from({ length: 16 }, () => r.byte().toString(16).padStart(2, '0')).join('');
      const g = [0, 8, 12, 16, 20, 32].map((x, i, a) => hex.slice(x, a[i + 1])).slice(0, 5);
      return `${day}ch:1:sjyid:${op}:plan:${g.join('-')}`;
    }
    case J.Dated:
      return `${day}${r.str()}`;
    default:
      return r.str();
  }
}

/** The train number a journey id holds (`…:10375-010` → `10375`), to leave out when the same. */
export function journeyNumber(j?: string): string | undefined {
  const rest = j && DATED.exec(j)?.[2];
  const m = rest ? (SJYID.exec(rest) ?? PLANNED.exec(rest)) : null;
  return m ? String(Number(m[2])) : undefined;
}

/** Bytes → link text: header byte, body, CRC-16, base64url, and the closing `z`. */
export const LINK_END = 'z';
