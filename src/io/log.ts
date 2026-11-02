// The debug log (opt in, Settings → Debug log): `log(event, data)` from anywhere, a no-op while
// off. Lines are kept in memory and written to IndexedDB (`srr.log.v1`) every 3 s and when the
// page hides; two parts of about 256 KB, the oldest dropped (core/log.ts). Nothing is sent
// anywhere: the user saves or copies it. Turning it off deletes it.
import { del, get, set } from 'idb-keyval';
import { create } from 'zustand';
import {
  appendLog,
  emptyLog,
  logLine,
  logSize,
  logText,
  screenOf,
  type LogParts,
} from '../core/log';
import { isNative } from '../native';

const STORE = 'srr.log.v1';
/** On or off, read before anything renders (localStorage, like the language). */
const SWITCH = 'srr.logging.v1';

interface LogState {
  on: boolean;
  /** Characters kept, about bytes; updated on each write. */
  size: number;
}

const readSwitch = () => {
  try {
    return localStorage.getItem(SWITCH) === '1';
  } catch {
    return false;
  }
};

export const useLog = create<LogState>()(() => ({ on: readSwitch(), size: 0 }));

let buffer: string[] = [];
let timer: ReturnType<typeof setTimeout> | undefined;
let writing: Promise<void> = Promise.resolve();

/** Writes what is buffered (one write at a time, in order). */
function flush(): Promise<void> {
  clearTimeout(timer);
  timer = undefined;
  if (!buffer.length) return writing;
  const lines = buffer;
  buffer = [];
  writing = writing.then(async () => {
    try {
      const next = appendLog((await get<LogParts>(STORE)) ?? emptyLog(), lines);
      if (!useLog.getState().on) return;
      await set(STORE, next);
      useLog.setState({ size: logSize(next) });
    } catch {
      // Storage full or gone: the log is a help, never a reason to fail.
    }
  });
  return writing;
}

/** One event. `data` is scrubbed (no keys or secrets, long values shortened). */
export function log(event: string, data?: unknown) {
  if (!useLog.getState().on) return;
  buffer.push(logLine(Date.now(), event, data));
  timer ??= setTimeout(() => void flush(), 3000);
}

/** Times a promise: `<event>` with its ms, or `<event>.fail` with the error. */
export async function logged<T>(event: string, data: unknown, run: () => Promise<T>): Promise<T> {
  const t0 = performance.now();
  try {
    const out = await run();
    log(event, { ...(data as object), ms: Math.round(performance.now() - t0) });
    return out;
  } catch (e) {
    log(`${event}.fail`, { ...(data as object), ms: Math.round(performance.now() - t0), e });
    throw e;
  }
}

function about() {
  return {
    version: __BUILD__.version,
    sha: __BUILD__.sha,
    native: isNative,
    ua: navigator.userAgent,
    lang: navigator.language,
    screen: `${screen.width}x${screen.height}@${devicePixelRatio}`,
    viewport: `${innerWidth}x${innerHeight}`,
    online: navigator.onLine,
    tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
  };
}

export async function setLogging(on: boolean) {
  try {
    if (on) localStorage.setItem(SWITCH, '1');
    else localStorage.removeItem(SWITCH);
  } catch {
    // Private mode: on for this visit only.
  }
  if (on) {
    useLog.setState({ on: true });
    log('log.on', about());
    await flush();
  } else {
    useLog.setState({ on: false, size: 0 });
    buffer = [];
    await writing;
    await del(STORE).catch(() => undefined);
  }
}

export async function clearLog() {
  buffer = [];
  await writing;
  await del(STORE).catch(() => undefined);
  useLog.setState({ size: 0 });
  log('log.cleared', about());
}

/** The whole log as text, everything buffered included. */
export async function readLog(): Promise<string> {
  await flush();
  return logText((await get<LogParts>(STORE).catch(() => undefined)) ?? emptyLog());
}

const fileName = () =>
  `rail-day-trip-log-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.txt`;

/** In the app the file goes through the cache under one name: each export replaces the last. */
const APP_FILE = 'rail-day-trip-log.txt';

/** Hands the log over as a file: the share sheet in the app, a download in the browser. */
export async function saveLog(): Promise<void> {
  log('log.export');
  const text = await readLog();
  const name = fileName();
  if (isNative) {
    const [{ Filesystem, Directory, Encoding }, { Share }] = await Promise.all([
      import('@capacitor/filesystem'),
      import('@capacitor/share'),
    ]);
    const { uri } = await Filesystem.writeFile({
      path: APP_FILE,
      data: text,
      directory: Directory.Cache,
      encoding: Encoding.UTF8,
    });
    try {
      await Share.share({ title: name, files: [uri] });
    } catch (e) {
      // Closing the share sheet is no failure.
      if (!/cancel/i.test(e instanceof Error ? e.message : String(e))) throw e;
    }
    return;
  }
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function copyLog(): Promise<void> {
  log('log.copy');
  await navigator.clipboard.writeText(await readLog());
}

let started = false;

/** Hooks the app-wide events once (errors, screens, visibility, network); each logs only while on. */
export function startLog() {
  if (started || typeof window === 'undefined') return;
  started = true;
  void get<LogParts>(STORE)
    .then((l) => useLog.setState({ size: l ? logSize(l) : 0 }))
    .catch(() => undefined);
  log('app.open', { ...about(), screen: screenOf(location.hash) });
  window.addEventListener('error', (e) =>
    log('error', { message: e.message, at: `${e.filename}:${e.lineno}:${e.colno}`, e: e.error }),
  );
  window.addEventListener('unhandledrejection', (e) => log('error.promise', { e: e.reason }));
  window.addEventListener('hashchange', () => log('screen', { to: screenOf(location.hash) }));
  document.addEventListener('visibilitychange', () => {
    log(document.visibilityState === 'hidden' ? 'app.hidden' : 'app.shown');
    if (document.visibilityState === 'hidden') void flush();
  });
  window.addEventListener('pagehide', () => void flush());
  window.addEventListener('online', () => log('net.online'));
  window.addEventListener('offline', () => log('net.offline'));
  for (const level of ['error', 'warn'] as const) {
    const orig = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      log(`console.${level}`, { args });
      orig(...args);
    };
  }
}
