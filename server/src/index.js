// 7 Fichas multiplayer server (Cloudflare Worker, free plan).
//   POST /rooms               → { code }   create a room
//   GET  /rooms/CODE/info     → { exists, phase, seats }
//   GET  /rooms/CODE/ws       → WebSocket into that room's GameRoom
// See docs/MULTIPLAYER.md.

import { GameRoom } from './GameRoom.js';

export { GameRoom };

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I
const CODE_RE = /^[A-HJ-NP-Z2-9]{6}$/;

// Browser pages allowed to use the server. Non-browser clients (no Origin
// header — tests, tools) are allowed too; this only stops other websites.
const ALLOWED_ORIGINS = new Set([
    'https://maralons0.github.io',
    'http://localhost:8791',
    'http://127.0.0.1:8791',
]);

function originOk(origin) {
    return !origin || ALLOWED_ORIGINS.has(origin);
}

function corsHeaders(origin) {
    if (!origin || !ALLOWED_ORIGINS.has(origin)) return {};
    return {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Vary': 'Origin',
    };
}

function newCode() {
    const b = new Uint8Array(6);
    crypto.getRandomValues(b);
    return [...b].map(x => CODE_ALPHABET[x % CODE_ALPHABET.length]).join('');
}

const json = (body, status, headers) => new Response(JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json', ...headers },
});

export default {
    async fetch(request, env) {
        const url = new URL(request.url);
        const origin = request.headers.get('Origin');
        const cors = corsHeaders(origin);

        if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
        if (!originOk(origin)) return json({ error: 'origin-not-allowed' }, 403, cors);

        if (url.pathname === '/rooms' && request.method === 'POST') {
            for (let attempt = 0; attempt < 5; attempt++) {
                const code = newCode();
                const room = env.ROOMS.get(env.ROOMS.idFromName(code));
                const r = await room.fetch(`https://room/init?code=${code}`, { method: 'POST' });
                if (r.ok) return json({ code }, 200, cors);
            }
            return json({ error: 'no-code' }, 500, cors);
        }

        const m = url.pathname.match(/^\/rooms\/([^/]+)\/(info|ws)$/);
        if (m) {
            if (!CODE_RE.test(m[1])) return json({ error: 'bad-code' }, 400, cors);
            const room = env.ROOMS.get(env.ROOMS.idFromName(m[1]));
            if (m[2] === 'ws') return room.fetch(new Request('https://room/ws', request));
            const r = await room.fetch('https://room/info');
            return json(await r.json(), r.status, cors);
        }

        return json({ error: 'not-found' }, 404, cors);
    },
};
