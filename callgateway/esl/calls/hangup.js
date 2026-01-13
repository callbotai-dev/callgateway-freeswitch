'use strict'; // Modo estricto.

const { connect } = require('../connection/connect'); // Conecta.
const { apiWithTimeout } = require('../api/apiWithTimeout'); // API timeout.

/**
 * Cuelga una llamada por UUID.
 * @param {string} uuid - uuid canal.
 * @returns {Promise<boolean>} true si OK.
 */
async function hangup(uuid) { // ÚNICA función.
    const c = await connect(); // Asegura conexión.
    const body = await apiWithTimeout(c, 'uuid_kill', uuid); // Mata canal.
    if (!body.includes('+OK')) throw new Error(`hangup_failed: ${body}`); // Valida.
    console.log('[ESL] hangup ok', uuid); // Log.
    return true; // OK.
} // Fin hangup.

module.exports = { hangup }; // Exporta.
