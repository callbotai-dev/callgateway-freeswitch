'use strict'; // Modo estricto.

const esl = require('./esl'); // Cliente ESL (originate / hangup)

const express = require('express'); // Importa Express.
const app = express(); // Crea la app HTTP.

const { callWithGate } = require('./esl/calls/callWithGate'); // Importa gate+wait ANSWER.

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

app.post('/dial', async (req, res) => { // Endpoint /dial.
    try { // Manejo seguro de errores.
        const body = req.body || {}; // Body seguro.
        const to = body.to || body.toE164 || body.phone || body.number; // Acepta alias.
        if (!to) return res.status(400).json({ success: false, message: 'missing_to' }); // Corta.
        const meta = body.meta || {}; // Meta opcional.
        const r = await callWithGate(to, { meta }); // Llama con gate y espera ANSWER/HANGUP.
        if (r.status === 'answered') { // Solo si hubo ANSWER humano.
            return res.json({ success: true, provider_call_id: r.meta.uuid, message: 'answered' }); // OK.
        } // Fin answered.
        return res.json({ success: false, message: r.status }); // Resto de casos.
    } catch (e) { // Captura fallo inesperado.
        console.error('[HTTP] /dial error:', e && (e.stack || e.message || e)); // Log real.
        return res.status(500).json({ // Respuesta.
            success: false, // KO.
            message: 'dial_error', // Código estable.
            detail: String(e && (e.message || e)).slice(0, 200), // Detalle corto.
        }); // Fin json.
    } // Fin catch.
}); // Fin endpoint.

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
