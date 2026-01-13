'use strict'; // Modo estricto.

const { connect } = require('../connection/connect'); // Conexión ESL.
const { getUuidFromEvent } = require('../events/getUuidFromEvent'); // UUID helper.
const { extractHangupMeta } = require('../events/extractHangupMeta'); // Meta hangup.

/**
 * Espera HANGUP_COMPLETE para un UUID.
 * @param {string} uuid - UUID canal.
 * @param {number} timeoutMs - timeout.
 * @returns {Promise<object>} resultado.
 */
async function waitForHangup(uuid, timeoutMs = 60000) { // ÚNICA función.
    const c = await connect(); // Reutiliza conexión.
    return await new Promise((resolve) => { // Promesa.
        let done = false; // Guard.
        const t0 = Date.now(); // Inicio.

        const finish = (payload) => { // Finaliza una vez.
            if (done) return; // Guard.
            done = true; // Marca.
            clearTimeout(timer); // Limpia timer.
            c.removeListener('esl::event::**', onEvent); // Quita listener.
            resolve(payload); // Resuelve.
        }; // Fin finish.

        const timer = setTimeout(() => { // Timeout.
            finish({ status: 'timeout', ms: Date.now() - t0, meta: { uuid } }); // Payload.
        }, timeoutMs); // ms.

        const onEvent = (e) => { // Handler.
            const name = e.getHeader('Event-Name'); // Evento.
            if (name !== 'CHANNEL_HANGUP_COMPLETE') return; // Solo hangup.
            const uid = getUuidFromEvent(e); // UUID.
            if (uid !== uuid) return; // Solo nuestro.
            const meta = extractHangupMeta(e); // Meta.
            finish({ status: 'hangup', ms: Date.now() - t0, meta: { uuid, ...meta } }); // OK.
        }; // Fin onEvent.

        try { c.events('plain', 'CHANNEL_HANGUP_COMPLETE'); } catch (_) { } // Suscribe.
        c.on('esl::event::**', onEvent); // Listener.
    }); // Fin promise.
} // Fin waitForHangup.

module.exports = { waitForHangup }; // Exporta.
