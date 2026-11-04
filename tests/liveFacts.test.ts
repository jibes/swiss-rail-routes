// Report-only checks against the live Worker, for facts no recorded answer shows (live.yml):
// whether same-day answers carry <EstimatedTime> (and the parser turns them into depEst/arrEst),
// and whether <Cancelled> / <NotServicedStop> still come by those names. Never fails: on a quiet
// day there may be no delays and nothing cancelled. With LIVE_FACTS_SAVE=<file>, an answer that has
// estimates is stored (tracks thinned) as a parser fixture.
// Run: OJP_LIVE_URL=https://srr-ojp….workers.dev npx vitest run tests/liveFacts.test.ts
// (LIVE_FACTS_SAVE=<file.xml.gz> to store one). Without OJP_LIVE_URL it skips: tests never hit
// the network.
import { appendFileSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { it } from 'vitest';
import { parseTrips } from '../src/core/ojp/parse';
import type { TripQuery } from '../src/core/ojp/request';
import { thinTracks } from './acceptance/ojp';

const url = process.env.OJP_LIVE_URL?.replace(/[/]$/, '') ?? '';
const save = process.env.LIVE_FACTS_SAVE ?? '';

it.skipIf(!url)(
  'live facts: estimates and cancellations (report only)',
  async () => {
    // Busy lines in the next half hour, Zurich time: delays are likeliest there.
    const local = (ms: number) =>
      new Intl.DateTimeFormat('sv-SE', {
        timeZone: 'Europe/Zurich',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      })
        .format(ms)
        .replace(' ', 'T');
    const at = local(Date.now() + 5 * 60_000);
    const stop = (sloid: number, name: string) => ({ ref: `ch:1:sloid:${sloid}`, name });
    const pairs = [
      [stop(3000, 'Zürich HB'), stop(7000, 'Bern')],
      [stop(7000, 'Bern'), stop(7492, 'Interlaken Ost')],
      [stop(5000, 'Luzern'), stop(3000, 'Zürich HB')],
      [stop(1008, 'Genève'), stop(1120, 'Lausanne')],
    ] as const;

    const lines: string[] = [`### Live facts (${at}, Zurich)`, ''];
    let estimates = 0;
    let parsedEst = 0;
    let cancelled = 0;
    let notServiced = 0;
    let best = { worth: 0, xml: '', name: '' };
    for (const [origin, destination] of pairs) {
      const q: TripQuery = {
        origin,
        destination,
        vias: [],
        notVias: [],
        time: at,
        arriveBy: false,
        results: 6,
      };
      try {
        const res = await fetch(`${url}/trip`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(q),
        });
        const xml = await res.text();
        if (!res.ok) throw new Error(`${res.status} ${xml.slice(0, 120)}`);
        const est = (xml.match(/<(?:\w+:)?EstimatedTime>/g) ?? []).length;
        const cs = parseTrips(xml);
        const pe = cs
          .flatMap((c) => c.sections)
          .flatMap((s) => [s.from, ...s.intermediate, s.to])
          .filter((x) => x.depEst || x.arrEst).length;
        const can = (xml.match(/<(?:\w+:)?Cancelled>/g) ?? []).length;
        const ns = (xml.match(/<(?:\w+:)?NotServicedStop>/g) ?? []).length;
        estimates += est;
        parsedEst += pe;
        cancelled += can;
        notServiced += ns;
        lines.push(
          `- ${origin.name} → ${destination.name}: ${cs.length} connections, ${est} <EstimatedTime>, ${pe} calls with an estimate parsed, ${can} <Cancelled>, ${ns} <NotServicedStop>`,
        );
        // Kept: the answer with the most to test, a stop not served counting most.
        const worth = est && pe ? est + 100 * (ns + can) : 0;
        if (save && worth > best.worth)
          best = { worth, xml, name: `${origin.name} → ${destination.name}` };
      } catch (e) {
        lines.push(
          `- ${origin.name} → ${destination.name}: no answer (${String(e).slice(0, 120)})`,
        );
      }
    }
    if (save && best.xml) {
      writeFileSync(save, gzipSync(thinTracks(best.xml)));
      lines.push('', `Saved ${best.name} as ${save}.`);
    }
    const warn: string[] = [];
    if (!estimates)
      warn.push('No <EstimatedTime> in any answer: no delays now, or OJP stopped sending them.');
    else if (!parsedEst)
      warn.push('Answers carry <EstimatedTime>, but the parser read none: check parse.ts.');
    if (!cancelled && !notServiced)
      lines.push(
        '',
        'Nothing cancelled or skipped right now (Cancelled / NotServicedStop not seen).',
      );
    for (const w of warn) console.log(`::warning::${w}`);
    lines.push('', ...warn.map((w) => `**Warning:** ${w}`));
    console.log(lines.join('\n'));
    if (process.env.GITHUB_STEP_SUMMARY)
      appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join('\n') + '\n');
  },
  120_000,
);
