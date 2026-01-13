'use strict'; // Modo estricto.

/**
 * Extrae UUID robusto desde un evento ESL.
 * @param {any} e - evento ESL.
 * @returns {string} UUID o ''.
 */
function getUuidFromEvent(e) { // ÚNICA función del archivo.
    return ( // Devuelve primera cabecera útil.
        e.getHeader('Unique-ID') || // Normal.
        e.getHeader('Channel-UUID') || // Alternativa.
        e.getHeader('Channel-Call-UUID') || // Variante.
        e.getHeader('variable_uuid') || // Fallback.
        '' // Default.
    ); // Fin return.
} // Fin getUuidFromEvent.

module.exports = { getUuidFromEvent }; // Exporta.
