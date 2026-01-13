'use strict'; // Modo estricto.

const { connect } = require('../connection/connect'); // Conexión ESL.
const { getConfig } = require('../config/getConfig'); // Config.
const { apiWithTimeout } = require('../api/apiWithTimeout'); // API con timeout.

/**
 * Origina llamada y devuelve UUID.
 * @param {string} toE164 - destino.
 * @param {object} vars - variables de canal.
 * @returns {Promise<string>} uuid.
 */
async function originate(toE164, vars = {}) { // ÚNICA función.
    const c = await connect(); // Asegura conexión.
    const { gateway } = getConfig(); // Lee gateway.

    vars = { // Defaults.
        bypass_media: 'false', // Media por FS.
        ignore_early_media: 'true', // Ignora early.
        originate_timeout: String(vars.originate_timeout ?? 22), // 22s.
        ...vars, // Override.
    }; // Fin vars.

    const chanVars = Object.entries(vars) // k=v
        .map(([k, v]) => `${k}=${v}`) // formatea
        .join(','); // une

    const prefix = chanVars ? `{${chanVars}}` : ''; // encapsula.
    const args = `${prefix}sofia/gateway/${gateway}/${toE164} &playback(silence_stream://-1)`; // originate.

    const body = await apiWithTimeout(c, 'originate', args); // Ejecuta.
    if (!body.startsWith('+OK')) throw new Error(`originate_failed: ${body}`); // Valida.

    const uuid = body.replace(/^\+OK\s+/i, '').trim(); // Extrae UUID.
    if (!uuid) throw new Error(`originate_failed: ${body}`); // Valida.

    console.log('[ESL] originate uuid =', uuid); // Log.
    return uuid; // OK.
} // Fin originate.

module.exports = { originate }; // Exporta.
