'use strict'; // Modo estricto.

/**
 * Devuelve un estado singleton para compartir la conexión ESL entre módulos.
 * (Se apoya en globalThis para evitar duplicados por múltiples requires.)
 */
function state() { // ÚNICA función del archivo.
    if (!globalThis.__eslState) { // Si no existe aún.
        globalThis.__eslState = { conn: null }; // Crea estado inicial.
    } // Fin if.
    return globalThis.__eslState; // Devuelve el singleton.
} // Fin state.

module.exports = { state }; // Exporta.
