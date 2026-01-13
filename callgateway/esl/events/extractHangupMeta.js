'use strict'; // Modo estricto.

const { pickHeader } = require('./pickHeader'); // Helper headers.

/**
 * Extrae meta de hangup para diagnóstico.
 * @param {any} e - evento ESL.
 * @returns {object} meta hangup.
 */
function extractHangupMeta(e) { // ÚNICA función.
    return { // Objeto meta.
        hangup_cause: pickHeader(e, ['Hangup-Cause', 'variable_hangup_cause']), // Causa.
        originate_disposition: pickHeader(e, ['variable_originate_disposition']), // Resultado originate.
        sip_hangup_disposition: pickHeader(e, ['variable_sip_hangup_disposition']), // Disposition SIP.
        sip_term_status: pickHeader(e, ['variable_sip_term_status']), // Código final SIP.
        sip_invite_failure_status: pickHeader(e, ['variable_sip_invite_failure_status']), // Fallo INVITE.
        last_bridge_hangup_cause: pickHeader(e, ['variable_last_bridge_hangup_cause']), // Bridge.
    }; // Fin objeto.
} // Fin extractHangupMeta.

module.exports = { extractHangupMeta }; // Exporta.
