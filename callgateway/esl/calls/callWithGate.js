'use strict'; // Modo estricto.

const { originate } = require('./originate'); // Origina llamada.
const { hangup } = require('./hangup'); // Cuelga llamada.
const { waitForAnswerOrHangup } = require('./waitForAnswerOrHangup'); // Espera ANSWER/HANGUP.
const { waitForHangup } = require('./waitForHangup'); // Monitor de hangup tras ANSWER.
const { connect } = require('../connection/connect'); // Conexión ESL (ruta real).



/**
 * Gate: limita ring (4-5 tonos aprox) y SOLO si ANSWER humano devuelve answered.
 * @param {string} toE164 - Destino (E.164 o similar).
 * @param {object} opts - Opciones.
 * @returns {Promise<{status:string, ms:number, meta:object, monitor?:Promise<any>}>} Resultado.
 */
async function callWithGate(toE164, opts = {}) { // Función principal.
    const t0 = Date.now(); // Timestamp inicio.
    const ringTimeoutSec = Number(opts.ringTimeoutSec ?? process.env.GATE_RING_TIMEOUT_SEC ?? 12); // Segundos máx. de ring (12≈4–5 tonos típico).
    const answerTimeoutMs = Number(opts.answerTimeoutMs ?? process.env.GATE_ANSWER_TIMEOUT_MS ?? ((ringTimeoutSec + 2) * 1000)); // Ventana espera ANSWER.
    const inCallTimeoutMs = Number(opts.inCallTimeoutMs ?? process.env.GATE_INCALL_TIMEOUT_MS ?? 60000); // Timeout monitor post-ANSWER.


    let uuid = ''; // UUID del canal.
    try { // Bloque originate.
        uuid = await originate(toE164, { originate_timeout: String(ringTimeoutSec) }); // Origina y obtiene UUID.
    } catch (e) { // Errores de originate.
        const msg = String(e?.message || e); // Normaliza mensaje.
        const ms = Date.now() - t0; // Duración.

        if (msg.includes('NO_ANSWER')) return { status: 'no_answer', ms, meta: { reason: 'originate_no_answer' } }; // No contestó.
        if (msg.includes('USER_BUSY') || msg.includes('CALL_REJECTED')) return { status: 'busy', ms, meta: { reason: msg } }; // Rechazo/ocupado.

        return { status: 'error', ms, meta: { reason: `originate_failed: ${msg}` } }; // Otro error.
    } // Fin originate.

    console.log('[ESL] gate started', { uuid, ringTimeoutSec, answerTimeoutMs, inCallTimeoutMs }); // Log gate.

    let r = { status: 'error', meta: { reason: 'wait_failed' } }; // Default seguro.
    try { // Espera segura.
        r = await waitForAnswerOrHangup(uuid, answerTimeoutMs); // Espera ANSWER/HANGUP/timeout.
    } catch (e) { // Si el waiter revienta.
        r = { status: 'hangup', meta: { hangup_cause: 'WAIT_EXCEPTION', reason: String(e?.message || e) } }; // Normaliza a hangup.
    } // Fin wait.

    const ms = Date.now() - t0; // Duración total.
    const sawAnswerEvent = Boolean(r?.meta?.sawAnswerEvent); // Flag visto ANSWER.

    if (r.status === 'answered') { // Si contestó.
        const c = await connect(); // Conexión ESL.
        const apiAsync = (cmd) => new Promise((resolve, reject) => { // Promesa API.
            c.api(cmd, (res) => { // Ejecuta.
                const body = String(res?.getBody?.() || ''); // Respuesta.
                if (body.startsWith('-ERR')) return reject(new Error(body)); // Error.
                resolve(body); // OK.
            });
        });

        const sessionId =
            opts?.session_id ?? opts?.sessionId ?? opts?.meta?.session_id ?? opts?.meta?.sessionId ?? null; // SessionId robusto.

        const elevenUri = process.env.ELEVEN_SIP_URI; // Destino SIP.
        if (!elevenUri) throw new Error('Missing ELEVEN_SIP_URI'); // Guard.

        const dial = `{sip_h_X-Session-Id=${sessionId || ''}}${elevenUri}`; // Dialstring con header.
        console.log('[ESL] handoff > uuid_transfer bridge', { uuid, dial }); // Log.
        await apiAsync(`uuid_transfer ${uuid} 'bridge:${dial}' inline`); // Handoff real.
        console.log('[ESL] handoff < OK'); // Log OK.

    } // Fin answered.

    if (r.status === 'hangup') { // Colgó antes de ANSWER.
        return { status: 'no_answer', ms, meta: { uuid, sawAnswerEvent, reason: 'hangup_before_answer', ...r.meta } }; // Normaliza.
    } // Fin hangup.

    await hangup(uuid).catch(() => { }); // Limpieza best-effort.
    return { status: 'no_answer', ms, meta: { uuid, sawAnswerEvent, reason: 'no_answer_timeout' } }; // Timeout.
} // Fin callWithGate.

module.exports = { callWithGate }; // Export.
