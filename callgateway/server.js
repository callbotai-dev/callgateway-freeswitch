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

const pendingByUuid = new Map(); // uuid -> { sessionId, dynamic_variables, exp } // Guarda variables por llamada.
setInterval(() => { // limpieza TTL
    const now = Date.now();
    for (const [k, v] of pendingByUuid) if (v.exp <= now) pendingByUuid.delete(k);
}, 5000);

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
        
        const uuid = r?.meta?.uuid ? String(r.meta.uuid) : null; // UUID FS si existe.
        const sid = body?.session_id ? String(body.session_id) : null; // SessionId.

        if (uuid && sid) { // Solo si ambos existen
            const dynamic_variables = body?.dynamic_variables || null; // Variables para ElevenLabs (si vienen).

            pendingByUuid.set(uuid, { sessionId: sid, dynamic_variables, exp: Date.now() + 10 * 60 * 1000 }); // TTL + vars.

            console.log('[HTTP] /dial pendingByUuid set', { uuid, sid }); // Log.
        }


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

const convBySession = new Map(); // Guarda conversacion por session_id.

app.post('/elevenlabs/client-init', async (req, res) => { // Respuesta para webhook init de ElevenLabs via n8n.
    const root = req.body || {}; // Soporta payload directo.
    const b = root.body || root; // Soporta wrapper n8n.
    const fsUuid = String(b.caller_id || b.callerId || '').trim(); // UUID = caller_id.
    const row = fsUuid ? pendingByUuid.get(fsUuid) : null; // Busca vars por UUID.
    return res.json({ dynamic_variables: row?.dynamic_variables || {} }); // Devuelve vars para esa conversación.
});

app.post('/elevenlabs/webhook', async (req, res) => {
    try {
        if (req.get('X-ElevenLabs-Proxy') !== 'n8n') return res.status(403).json({ ok: false });

        const root = req.body || {};
        const b = root.body || root;

        const fsUuid = String(b.caller_id || b.callerId || '').trim();
        const conversationId = String(b.conversation_id || b.conversationId || '').trim();

        const row = fsUuid ? pendingByUuid.get(fsUuid) : null;
        const sessionId = row?.sessionId || null;

        if (!sessionId && conversationId && process.env.ELEVENLABS_API_KEY) {
            fetch(`https://api.elevenlabs.io/v1/conversations/${conversationId}/end`, {
                method: 'POST', headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY },
            }).catch(() => { });
        }

        if (sessionId && conversationId) {
            convBySession.set(String(sessionId), String(conversationId)); // Mapea session -> conversation.
            const base = String(row?.dynamic_variables?.callback_url || b.callback_url || b.meta?.callback_url || '').trim(); // Base por llamada.
            if (base) { // Solo si existe callback_url.
                const dashUrl = `${base.replace(/\/+$/, '')}/api/callbacks/elevenlabs/conversation`; // Ruta fija.
                const dashKey = process.env.DASHBOARD_CONV_KEY || '1234'; // Key.
                fetch(dashUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'X-CallGateway-Key': dashKey },
                    body: JSON.stringify({ session_id: sessionId, conversation_id: conversationId, call_sid: fsUuid || null }),
                }).catch(() => { });
            }

        }

        return res.json({ ok: true, fsUuid, sessionId, conversationId });
    } catch (e) {
        return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
});

app.post('/kill-conversation', async (req, res) => {
    const { session_id, conversation_id } = req.body || {};
    const cid = String(conversation_id || convBySession.get(String(session_id)) || '').trim();
    if (!cid) return res.status(400).json({ ok: false, error: 'missing_conversation_id' });

    const r = await fetch(`https://api.elevenlabs.io/v1/convai/conversations/${cid}`, {
        method: 'DELETE',
        headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY },
    });
    return res.json({ ok: r.ok, conversation_id: cid });
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
