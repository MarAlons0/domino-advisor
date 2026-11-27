// One record across a person's devices — the Worker side (docs/CROSS_DEVICE_STATS.md).
//   POST /records         → 201 { code }                        a new, empty record
//   POST /records/sync    { code, device, batch?, leave? }      → { totals, resetAt, devices, syncedAt }
//   POST /records/delete  { code }                              → { ok }
// The code is only ever in a body, never in a URL. Each record is a
// StatsRecord Durable Object named by a hash of its code; malformed requests
// are refused here, before they reach one.

import { MAX_BODY, cleanSync, newRecordCode, normalizeCode, recordName } from './StatsRecordStore.js';
import { readJson } from './suggestions.js';

export async function handleRecords(request, env, url, cors) {
    const reply = (body, status = 200) => new Response(JSON.stringify(body), {
        status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...cors },
    });
    if (request.method !== 'POST') return reply({ error: 'not-found' }, 404);
    if (!env.RECORDS) return reply({ error: 'not-available' }, 503);
    const record = async (code) => {
        const stub = env.RECORDS.get(env.RECORDS.idFromName(await recordName(code)));
        return (path, body) => stub.fetch(`https://record${path}`, { method: 'POST', body: JSON.stringify(body) });
    };

    if (url.pathname === '/records') {
        for (let attempt = 0; attempt < 5; attempt++) {
            const code = newRecordCode();
            const r =await (await record(code))('/create', {});
            if (r.status === 201) return reply({ code }, 201);
        }
        return reply({ error: 'no-code' }, 500);
    }

    if (url.pathname !== '/records/sync' && url.pathname !== '/records/delete') return reply({ error: 'not-found' }, 404);
    const { data, error } = await readJson(request, MAX_BODY);
    if (error) return reply({ error }, error === 'too-large' ? 413 : 400);
    const code = normalizeCode(data?.code);
    if (!code) return reply({ error: 'bad-code' }, 400);

    if (url.pathname === '/records/sync') {
        const clean = cleanSync(data);
        if (clean.error) return reply({ error: clean.error }, 400);
        const r = await (await record(code))('/sync', clean.value);
        return reply(await r.json(), r.status);
    }

    const r = await (await record(code))('/delete', {});
    return reply(await r.json(), r.status);
}
