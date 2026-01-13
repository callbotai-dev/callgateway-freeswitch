'use strict'; // Modo estricto.

const { connect } = require('../connection/connect'); // Conexión ESL.
const { getUuidFromEvent } = require('../events/getUuidFromEvent'); // UUID helper.
const { extractHangupMeta } = require('../events/extractHangupMeta'); // Meta hangup.

/**
 * Espera ANSWER o HANGUP para un UUID.
 * @param {string} uuid - UUID canal.
 * @param {number} timeoutMs - timeout.
 * @returns {Promise<object>} resultado.
 */
async function waitForAnswerOrHangup(uuid, timeoutMs = 30000) { // ÚNICA función.
    const c = await connect(); // Reutiliza conexión.
    return await new Promise((resolve) => { // Promesa.
        let done = false; // Guard.
        let sawAnswerEvent = false; // Flag answer.
        const t0 = Date.now(); // Inicio.

        const finish = (payload) => { // Finaliza una vez.
            if (done) return; // Guard.
            done = true; // Marca.
            clearTimeout(timer); // Limpia timer.
            c.removeListener('esl::event::**', onEvent); // Quita listener.
            resolve(payload); // Resuelve.
        }; // Fin finish.

        const timer = setTimeout(() => { // Timeout duro.
            finish({ status: 'timeout', ms: Date.now() - t0, meta: { sawAnswerEvent } }); // Payload.
        }, timeoutMs); // ms.

        const onEvent = (e) => { // Handler eventos.
            const name = e.getHeader('Event-Name'); // Nombre evento.
            if (!name || name === 'API') return; // Ruido.
            const uid = getUuidFromEvent(e); // UUID evento.
            if (uid !== uuid) return; // No es nuestro.

            if (name === 'CHANNEL_ANSWER') { // Contestada.
                sawAnswerEvent = true; // Marca.
                return finish({ status: 'answered', ms: Date.now() - t0, meta: { sawAnswerEvent } }); // OK.
            } // Fin answer.

            if (name === 'CHANNEL_HANGUP_COMPLETE') { // Colgada.
                const meta = extractHangupMeta(e); // Meta.
                return finish({ status: 'hangup', ms: Date.now() - t0, meta: { ...meta, sawAnswerEvent } }); // OK.
            } // Fin hangup.
        }; // Fin onEvent.

        try { c.events('plain', 'CHANNEL_ANSWER CHANNEL_HANGUP_COMPLETE'); } catch (_) { } // Suscribe mínimo.
        c.on('esl::event::**', onEvent); // Listener.
    }); // Fin promise.
} // Fin waitForAnswerOrHangup.

module.exports = { waitForAnswerOrHangup }; // Exporta.
