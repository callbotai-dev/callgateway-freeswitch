'use strict'; // Modo estricto.

const esl = require('./esl'); // Cliente ESL (originate / hangup)

const express = require('express'); // Importa Express.
const app = express(); // Crea la app HTTP.

app.use(express.urlencoded({ extended: false })); // Acepta x-www-form-urlencoded.
app.use(express.text({ type: '*/*', limit: '256kb' })); // Fallback texto crudo.

app.use(express.json({ limit: '256kb' })); // Parsea JSON con límite.

const PORT = process.env.PORT || 8088; // Puerto del gateway.
const TOKEN = process.env.GATEWAY_TOKEN || ''; // Token compartido.

function requireAuth(req, res, next) { // Middleware auth.
    if (!TOKEN) return next(); // Si no hay token, no protege (dev).
    const auth = req.header('authorization') || ''; // Lee header.
    const ok = auth === `Bearer ${TOKEN}`; // Valida Bearer.
    if (!ok) return res.status(401).json({ error: 'unauthorized' }); // Deniega.
    return next(); // Continúa.
}

app.get('/health', (req, res) => { // Endpoint salud.
    res.json({ ok: true, service: 'callgateway' }); // Respuesta.
});

app.post('/dial', requireAuth, async (req, res) => {
    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
        const { session_id, to, meta = {} } = body || {};
        if (!session_id || !to) return res.status(400).json({ error: 'missing session_id/to' });

        // Origina por ESL → devuelve UUID FS
        const uuid = await esl.originate(to, { session_id, ...meta });

        return res.json({
            provider: 'freeswitch',
            provider_call_id: uuid,
            status: 'queued',
            session_id,
            to,
            meta,
        });
    } catch (e) {
        return res.status(500).json({ error: 'dial_failed', detail: String(e.message || e) });
    }
});

app.post('/hangup', requireAuth, async (req, res) => {
    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
        const { session_id, provider_call_id, reason } = body || {};
        if (!provider_call_id) return res.status(400).json({ error: 'missing provider_call_id' });

        await esl.hangup(provider_call_id);
        return res.json({ ok: true, session_id, provider_call_id, reason: reason || 'hangup' });
    } catch (e) {
        return res.status(500).json({ error: 'hangup_failed', detail: String(e.message || e) });
    }
});

app.listen(PORT, () => { // Arranca servidor.
    console.log(`[callgateway] listening on :${PORT}`); // Log.
});
