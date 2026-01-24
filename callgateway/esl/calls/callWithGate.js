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
        uuid = await originate(toE164, { originate_timeout: String(ringTimeoutSec) }); // Origina.
        const sessionId = opts?.session_id ?? opts?.sessionId ?? opts?.meta?.session_id ?? opts?.meta?.sessionId ?? null;
        const sid = String(sessionId || '');
        if (!sid) throw new Error('Missing session_id');

        const c0 = await connect();
        const api0 = (cmd) => new Promise((resolve, reject) => {
            c0.api(cmd, (res) => {
                const body = String(res?.getBody?.() || '');
                if (body.startsWith('-ERR')) return reject(new Error(body));
                resolve(body);
            });
        });

        await api0(`uuid_setvar ${uuid} export_vars callgateway_session_id`);
        await api0(`uuid_setvar ${uuid} callgateway_session_id ${sid}`);
        console.log('[ESL] early setvar+export callgateway_session_id', { uuid, sid });

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

        const elevenUri = process.env.ELEVEN_SIP_URI; // URI destino.
        if (!elevenUri) throw new Error('Missing ELEVEN_SIP_URI'); // Guard.

        // Mantén el caller_id = UUID (esto sí afecta al webhook)
        await apiAsync(`uuid_setvar ${uuid} effective_caller_id_number ${uuid}`);
        await apiAsync(`uuid_setvar ${uuid} effective_caller_id_name CGW`);

        const sid = await apiAsync(`uuid_getvar ${uuid} callgateway_session_id`); // Lee lo ya seteado temprano.
        const dial = `{sip_h_X-Session-Id=${String(sid || '').trim()}}${elevenUri}`;

        console.log('[ESL] handoff > uuid_transfer bridge', { uuid, dial });
        await apiAsync(`uuid_transfer ${uuid} 'bridge:${dial}' inline`);
        console.log('[ESL] handoff < OK');

        const monitor = waitForHangup(uuid, inCallTimeoutMs);
        return { status: 'answered', ms, meta: { uuid, sawAnswerEvent }, monitor };
    }

    if (r.status === 'hangup') { // Colgó antes de ANSWER.
        return { status: 'no_answer', ms, meta: { uuid, sawAnswerEvent, reason: 'hangup_before_answer', ...r.meta } }; // Normaliza.
    } // Fin hangup.

    await hangup(uuid).catch(() => { }); // Limpieza best-effort.
    return { status: 'no_answer', ms, meta: { uuid, sawAnswerEvent, reason: 'no_answer_timeout' } }; // Timeout.
} // Fin callWithGate.


module.exports = { callWithGate }; // Export.
