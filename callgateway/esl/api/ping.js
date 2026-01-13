'use strict'; // Modo estricto.

const { connect } = require('../connection/connect'); // Conecta.
const { apiWithTimeout } = require('./apiWithTimeout'); // API con timeout.

/**
 * Comprueba FreeSWITCH devolviendo su versión.
 * @returns {Promise<string>} versión.
 */
async function ping() { // ÚNICA función.
    const c = await connect(); // Asegura conexión.
    return await apiWithTimeout(c, 'version'); // Devuelve versión.
} // Fin ping.

module.exports = { ping }; // Exporta.
