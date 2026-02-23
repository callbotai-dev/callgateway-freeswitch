'use strict'; // Modo estricto.

const { originate } = require('./originate'); // Origina llamada.
const { hangup } = require('./hangup'); // Cuelga llamada.
const { waitForAnswerOrHangup } = require('./waitForAnswerOrHangup'); // Espera ANSWER/HANGUP.
const { waitForHangup } = require('./waitForHangup'); // Monitor de hangup tras ANSWER.
const { connect } = require('../connection/connect'); // Conexión ESL (ruta real).
const { postCallResult } = require('../webhooks/postCallResult'); // Envía evento a n8n.


/**
 * Gate: limita ring (4-5 tonos aprox) y SOLO si ANSWER humano devuelve answered.
 * @param {string} toE164 - Destino (E.164 o similar).
 * @param {object} opts - Opciones.
 * @returns {Promise<{status:string, ms:number, meta:object, monitor?:Promise<any>}>} Resultado.
 */
async function callWithGate(toE164, opts = {}) { // Función principal.
    const t0 = Date.now(); // Timestamp inicio.
    const ringTimeoutSec = Number(opts.ringTimeoutSec ?? process.env.GATE_RING_TIMEOUT_SEC ?? 12); // Segundos máx ring.
    const answerTimeoutMs = Number(opts.answerTimeoutMs ?? process.env.GATE_ANSWER_TIMEOUT_MS ?? ((ringTimeoutSec + 2) * 1000)); // Ventana espera.
    const inCallTimeoutMs = Number(opts.inCallTimeoutMs ?? process.env.GATE_INCALL_TIMEOUT_MS ?? 60000); // Timeout post-ANSWER.

    let uuid = ''; // UUID canal.
    try { // Originate.
        const sessionId =
            opts?.session_id ??
            opts?.sessionId ??
            opts?.meta?.session_id ??
            opts?.meta?.sessionId ??
            null;

        const sid = String(sessionId || '');
        if (!sid) throw new Error('Missing session_id');

        uuid = await originate(toE164, {
            originate_timeout: String(ringTimeoutSec),

            // 🔑 CLAVE
            origination_export_vars: 'callgateway_session_id',
            callgateway_session_id: sid,
        });       
    } catch (e) { // Errores originate.
        const msg = String(e?.message || e); // Mensaje.
        const ms = Date.now() - t0; // Duración.
        if (msg.includes('NO_ANSWER')) return { status: 'no_answer', ms, meta: { reason: 'originate_no_answer' } }; // No contestó.
        if (msg.includes('USER_BUSY') || msg.includes('CALL_REJECTED')) return { status: 'busy', ms, meta: { reason: msg } }; // Busy/rechazo.
        return { status: 'error', ms, meta: { reason: `originate_failed: ${msg}` } }; // Otro.
    } // Fin originate.

    console.log('[ESL] gate started', { uuid, ringTimeoutSec, answerTimeoutMs, inCallTimeoutMs }); // Log.

    let r = { status: 'error', meta: { reason: 'wait_failed' } }; // Default.
    try { // Espera.
        r = await waitForAnswerOrHangup(uuid, answerTimeoutMs); // Espera eventos.
    } catch (e) { // Excepción waiter.
        r = { status: 'hangup', meta: { hangup_cause: 'WAIT_EXCEPTION', reason: String(e?.message || e) } }; // Normaliza.
    } // Fin wait.

    const ms = Date.now() - t0; // Duración.
    const sawAnswerEvent = Boolean(r?.meta?.sawAnswerEvent); // Flag.

    if (r.status === 'answered') { // 1 Contestó.
        console.log('[ESL] ANSWER => ORCHESTRATOR', { uuid }); // 2 Log.

        const c = await connect(); // 3 Conexión ESL.
        const apiAsync = (cmd) => new Promise((resolve, reject) => { // 4 Wrapper async.
            c.api(cmd, (res) => { // 5 Ejecuta comando ESL.
                const body = String(res?.getBody?.() || ''); // 6 Lee respuesta.
                if (body.startsWith('-ERR')) return reject(new Error(body)); // 7 Error FS.
                resolve(body); // 8 OK.
            });
        });

        // 9 session_id: preferimos payload /dial, fallback a var del canal.
        const session_id = String(opts?.session_id || '').trim() // 10 Desde /dial.
            || (() => { // 11 Fallback (canal).
                const sidRawP = apiAsync(`uuid_getvar ${uuid} callgateway_session_id`); // 12 Pide var.
                return sidRawP; // 13 Devuelve promise (se resuelve abajo).
            })();

        const sidRaw = typeof session_id === 'string' ? session_id : await session_id; // 14 Resuelve si era promise.
        const sid = sidRaw && sidRaw !== '_undef_' ? String(sidRaw).trim() : ''; // 15 Normaliza.
        if (!sid) throw new Error('Missing session_id'); // 16 Guard.

        // 17 campaign_id viene en /dial.meta.campaign_id (NO del canal).
        const campaign_id = Number(opts?.meta?.campaign_id ?? NaN); // 18 Lee meta.
        if (!Number.isFinite(campaign_id)) throw new Error('Missing meta.campaign_id in /dial payload'); // 19 Guard.

        // 20 (Opcional) CallerID = UUID (trazas)
        await apiAsync(`uuid_setvar ${uuid} effective_caller_id_number ${uuid}`); // 21 UUID en caller_id.
        await apiAsync(`uuid_setvar ${uuid} effective_caller_id_name CGW`); // 22 Nombre fijo.

        // 23 Llama al Orchestrator interno
        const orchRes = await fetch('http://127.0.0.1:3001/start', { // 24 URL interna.
            method: 'POST', // 25 POST.
            headers: { 'Content-Type': 'application/json' }, // 26 JSON.
            body: JSON.stringify({ campaign_id, session_id: sid, uuid }), // 27 Payload.
        });

        if (!orchRes.ok) throw new Error(`Orchestrator HTTP ${orchRes.status}`); // 28 Guard.
        const orch = await orchRes.json(); // 29 JSON respuesta.
        if (!orch?.wav_path) throw new Error('Orchestrator missing wav_path'); // 30 Guard.

        // 31 Inyecta el WAV en la llamada (leg A)
        await apiAsync(`uuid_broadcast ${uuid} ${orch.wav_path} aleg`); // 32 Playback.
        console.log('[ESL] uuid_broadcast OK', { uuid, wav: orch.wav_path }); // 33 Log.

        const monitor = waitForHangup(uuid, inCallTimeoutMs); // 34 Monitor hangup.

        monitor
            .then((h) => postCallResult({ // Si cuelga ok.
                status: 'hangup_complete', // Estado final.
                uuid, // UUID FS.
                session_id: sid, // Session.
                campaign_id, // Campaign.
                meta: { ...h }, // Meta hangup.
            }))
            .catch((e) => postCallResult({ // Si falla monitor/timeout.
                status: 'hangup_monitor_error', // Error monitor.
                uuid,
                session_id: sid,
                campaign_id,
                meta: { error: String(e?.message || e) }, // Error.
            }));
        return { status: 'answered', ms, meta: { uuid, sawAnswerEvent }, monitor }; // 35 OK.
    }

    if (r.status === 'hangup') { // Colgó antes de ANSWER.
        return { status: 'no_answer', ms, meta: { uuid, sawAnswerEvent, reason: 'hangup_before_answer', ...r.meta } }; // Normaliza.
    } // Fin hangup.

    await hangup(uuid).catch(() => { }); // Limpieza best-effort.
    return { status: 'no_answer', ms, meta: { uuid, sawAnswerEvent, reason: 'no_answer_timeout' } }; // Timeout.
} // Fin callWithGate.


module.exports = { callWithGate }; // Export.
