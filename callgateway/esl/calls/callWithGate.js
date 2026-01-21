'use strict'; // Modo estricto.

const { originate } = require('./originate'); // Origina.
const { hangup } = require('./hangup'); // Cuelga.
const { waitForAnswerOrHangup } = require('./waitForAnswerOrHangup'); // Espera answer/hangup.
const { waitForHangup } = require('./waitForHangup'); // Monitor hangup.

/**
 * Gate: 4-5 tonos + handoff.
 * @param {string} toE164 - destino.
 * @param {object} opts - opciones.
 * @returns {Promise<object>} resultado.
 */
async function callWithGate(toE164, opts = {}) { // ÚNICA función.
    const t0 = Date.now(); // Inicio.
    const ringTimeoutSec = Number(opts.ringTimeoutSec ?? 22); // 4-5 tonos.
    const answerTimeoutMs = Number(opts.answerTimeoutMs ?? ((ringTimeoutSec + 2) * 1000)); // Ventana.
    const inCallTimeoutMs = Number(opts.inCallTimeoutMs ?? 60000); // Monitor (diag).

    let uuid = ''; // UUID.
    try { // Originate.
        uuid = await originate(toE164, { originate_timeout: String(ringTimeoutSec) }); // Llama.
    } catch (e) { // Error originate.
        const msg = String(e?.message || e); // Normaliza.
        const ms = Date.now() - t0; // Duración.
        if (msg.includes('NO_ANSWER')) return { status: 'no_answer', ms, meta: { reason: 'originate_no_answer' } }; // No contesta.
        return { status: 'error', ms, meta: { reason: msg } }; // Otro error.
    } // Fin originate.

    console.log('[ESL] gate started', { uuid, ringTimeoutSec, answerTimeoutMs, inCallTimeoutMs }); // Log.

    let r = { status: 'error', meta: { reason: 'wait_failed' } }; // Default.
    try { // Espera segura.
        r = await waitForAnswerOrHangup(uuid, answerTimeoutMs); // Espera decisión.
    } catch (e) { // Si revienta.
        r = { status: 'hangup', meta: { hangup_cause: 'WAIT_EXCEPTION', err: String(e?.message || e) } }; // Normaliza.
    }

    const ms = Date.now() - t0; // Duración.
    const sawAnswerEvent = Boolean(r?.meta?.sawAnswerEvent); // Flag.

    if (r.status === 'answered') { // Contestó.
        console.log('[ESL] ANSWER => HANDOFF NOW', { uuid }); // Log.
        const monitor = waitForHangup(uuid, inCallTimeoutMs); // Monitor.
        return { status: 'answered', ms, meta: { uuid, sawAnswerEvent }, monitor }; // OK.
    } // Fin answered.

    if (r.status === 'hangup') { // Colgó antes de contestar.
        return { status: 'no_answer', ms, meta: { uuid, sawAnswerEvent, reason: 'hangup_before_answer', ...r.meta } }; // No contesta.
    } // Fin hangup.

    await hangup(uuid).catch(() => { }); // Limpieza.
    return { status: 'no_answer', ms, meta: { uuid, sawAnswerEvent, reason: 'no_answer_timeout' } }; // No contesta.
} // Fin callWithGate.

module.exports = { callWithGate }; // Exporta.
