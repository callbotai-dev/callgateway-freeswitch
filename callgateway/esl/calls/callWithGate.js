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
    const ringTimeoutSec = Number(opts.ringTimeoutSec ?? process.env.GATE_RING_TIMEOUT_SEC ?? 12); // Segundos máx ring.
    const answerTimeoutMs = Number(opts.answerTimeoutMs ?? process.env.GATE_ANSWER_TIMEOUT_MS ?? ((ringTimeoutSec + 2) * 1000)); // Ventana espera.
    const inCallTimeoutMs = Number(opts.inCallTimeoutMs ?? process.env.GATE_INCALL_TIMEOUT_MS ?? 60000); // Timeout post-ANSWER.

    let uuid = ''; // UUID canal.
    try { // Originate.
        const sessionId = opts?.session_id ?? opts?.sessionId ?? opts?.meta?.session_id ?? opts?.meta?.sessionId ?? null; // SessionId.
        const sid = String(sessionId || '').trim(); // Normaliza.
        if (!sid) throw new Error('Missing session_id'); // Obligatorio.

        uuid = await originate(toE164, { originate_timeout: String(ringTimeoutSec) }); // Origina (sin setvars).
      
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

    if (r.status === 'answered') { // Contestó.
        console.log('[ESL] ANSWER => HANDOFF NOW', { uuid });

        const c = await connect(); // Conexión ESL.
        const apiAsync = (cmd) => new Promise((resolve, reject) => {
            c.api(cmd, (res) => {
                const body = String(res?.getBody?.() || '');
                if (body.startsWith('-ERR')) return reject(new Error(body));
                resolve(body);
            });
        });

        const elevenUri = process.env.ELEVEN_SIP_URI; // URI destino.
        if (!elevenUri) throw new Error('Missing ELEVEN_SIP_URI'); // Guard.

        // CallerID = UUID (para que ElevenLabs envíe UUID en caller_id)
        await apiAsync(`uuid_setvar ${uuid} effective_caller_id_number ${uuid}`); // UUID en caller_id.
        await apiAsync(`uuid_setvar ${uuid} effective_caller_id_name CGW`); // Nombre fijo.

        const dial = `{sip_h_X-Session-Id=${sid}}${elevenUri}`; // Header opcional.
        console.log('[ESL] handoff > uuid_transfer bridge', { uuid, dial });

        await apiAsync(`uuid_transfer ${uuid} 'bridge:${dial}' inline`); // Transfiere.
        console.log('[ESL] handoff < OK'); // Log.

        const monitor = waitForHangup(uuid, inCallTimeoutMs); // Monitor.
        return { status: 'answered', ms, meta: { uuid, sawAnswerEvent }, monitor }; // OK.
    }

    if (r.status === 'hangup') { // Colgó antes de ANSWER.
        return { status: 'no_answer', ms, meta: { uuid, sawAnswerEvent, reason: 'hangup_before_answer', ...r.meta } }; // Normaliza.
    } // Fin hangup.

    await hangup(uuid).catch(() => { }); // Limpieza best-effort.
    return { status: 'no_answer', ms, meta: { uuid, sawAnswerEvent, reason: 'no_answer_timeout' } }; // Timeout.
} // Fin callWithGate.


module.exports = { callWithGate }; // Export.
