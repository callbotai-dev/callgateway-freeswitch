'use strict'; // Modo estricto.

/**
 * Devuelve el primer header no vacío de una lista.
 * @param {any} e - evento ESL.
 * @param {string[]} keys - claves a probar.
 * @returns {string} valor o ''.
 */
function pickHeader(e, keys) { // ÚNICA función.
    for (const k of keys) { // Itera claves.
        const v = e.getHeader(k); // Lee header.
        if (v && String(v).trim()) return String(v).trim(); // Devuelve válida.
    } // Fin for.
    return ''; // Nada.
} // Fin pickHeader.

module.exports = { pickHeader }; // Exporta.
