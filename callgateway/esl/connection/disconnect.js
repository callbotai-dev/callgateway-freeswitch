'use strict'; // Modo estricto.

const { state } = require('./state'); // Estado compartido.

/**
 * Cierra la conexión ESL si existe, sin abrir una nueva.
 * @returns {void}
 */
function disconnect() { // Cierra conexión ESL.
    try { // Protege.
        const c = state().conn; // Lee conn actual.
        if (c && c.connected && c.connected()) { // Si está viva.
            console.log('[ESL] disconnect'); // Log.
            c.disconnect(); // Cierra.
        } // Fin if.
    } catch (e) { // Captura error.
        console.error('[ESL] disconnect error', e); // Log.
    } finally { // Siempre.
        state().conn = null; // Limpia cache.
    } // Fin finally.
} // Fin disconnect.

module.exports = { disconnect }; // Exporta.
