'use strict'; // Modo estricto.

const esl = require('./esl'); // Cliente ESL (originate / hangup)

const express = require('express'); // Importa Express.
const app = express(); // Crea la app HTTP.
app.use(express.json({ limit: '1mb' })); // Parseo JSON para req.body.


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
    try { // Try global del handler.
        const body = req.body || {}; // Asegura objeto.
        const meta = body.meta || {}; // Meta opcional.
        let to = body.to || body.toE164 || body.phone || body.number; // Destino (alias).
        to = String(to || '').trim(); // Normaliza.
        if (/^\d{9}$/.test(to)) to = `+34${to}`; // ES: 9 dígitos -> +34.
        console.log('[HTTP] /dial', { ct: req.headers['content-type'], to, hasBody: !!req.body }); // Log mínimo.

        if (!to) return res.status(400).json({ success: false, message: 'missing_to' }); // 400 si falta to.

        console.log('[HTTP] /dial phase=before_callWithGate', { to }); // Marca.
        const r = await callWithGate(to, { ...body, toE164: to });

        console.log('[HTTP] /dial phase=after_callWithGate', { status: r?.status, meta: r?.meta }); // Resultado.

        if (r.status === 'answered') { // Contestó.
            return res.json({ success: true, provider_call_id: r.meta.uuid, message: 'answered' }); // OK.
        } // Fin answered.

        return res.json({ // No contestó / ocupado / etc.
            success: false, // KO.
            message: r.status, // no_answer | busy | error ...
            provider_call_id: r.meta?.uuid, // UUID si existe.
            reason: r.meta?.reason, // Motivo.
            hangup_cause: r.meta?.hangup_cause || r.meta?.hangupCause, // Causa FS si existe.
        }); // Fin response.
    } catch (e) { // Captura errores inesperados.
        console.error('[HTTP] /dial error:', e && (e.stack || e.message || e)); // Log real.
        return res.status(500).json({ success: false, message: 'dial_error', detail: String(e?.message || e).slice(0, 200) }); // 500 estable.
    } // Fin catch.
}); // Fin endpoint.

const convBySession = new Map(); // Guarda conversacion por session_id


app.post('/elevenlabs/webhook', async (req, res) => {
    if (req.get('X-ElevenLabs-Proxy') !== 'n8n') {
        return res.status(403).json({ ok: false });
    }

    const root = req.body || {};
    const b = root.body || root;
    return res.json({
        b,
        root,
    });
    const conversationId = b.conversation_id || b.conversationId || null;

    // UUID FS: viene como caller_id (confirmado)
    const fsUuid =
        b.caller_id ||
        b.callerId ||
        b.call_sid ||
        null;

    let sessionId = null;

    if (fsUuid) {
        try {
            const sid = await apiAsync(
                `uuid_getvar ${fsUuid} callgateway_session_id`
            );
            sessionId = sid && sid !== '_undef_' ? String(sid).trim() : null;
        } catch (_) {
            sessionId = null;
        }
    }

    // 🔥 KILL-SWITCH: si no hay session_id, cortar conversación YA
    if (!sessionId && conversationId) {
        try {
            await fetch(
                `https://api.elevenlabs.io/v1/conversations/${conversationId}/end`,
                {
                    method: 'POST',
                    headers: {
                        'xi-api-key': process.env.ELEVENLABS_API_KEY,
                    },
                }
            );
        } catch (_) { }
    }

    // Update Dashboard (camino feliz)
    if (sessionId && conversationId) {
        const dashUrl = process.env.DASHBOARD_CONV_URL || 'https://e116dbffd0a6.ngrok-free.app/api/callbacks/elevenlabs/conversation'; // URL backend update.
        const dashKey = process.env.DASHBOARD_CONV_KEY || '1234'; // Key simple.
        fetch(dashUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CallGateway-Key': dashKey,
            },
            body: JSON.stringify({
                session_id: sessionId,
                conversation_id: conversationId,
            }),
        }).catch(() => { });
    }

    return res.json({
        ok: true,
        fsUuid,
        sessionId,
        conversationId,
    });
});


app.post('/kill-conversation', async (req, res) => { // Mata conversación ElevenLabs.
    const { session_id } = req.body || {}; // Lee session.
    const cid = convBySession.get(String(session_id)); // Busca conversation.
    if (!cid) return res.status(404).json({ ok: false }); // No hay.
    const r = await fetch(`https://api.elevenlabs.io/v1/convai/conversations/${cid}`, { method: 'DELETE', headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY } }); // DELETE.
    return res.json({ ok: r.ok, conversation_id: cid }); // Devuelve.
});

app.get('/conversation', (req, res) => { // Consulta conversation_id por session_id.
    const sessionId = String(req.query.session_id || ''); // Lee query.
    if (!sessionId) return res.status(400).json({ ok: false, message: 'missing_session_id' }); // Valida.
    const conversation_id = convBySession.get(sessionId) || null; // Busca.
    return res.json({ ok: Boolean(conversation_id), session_id: sessionId, conversation_id }); // Responde.
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
