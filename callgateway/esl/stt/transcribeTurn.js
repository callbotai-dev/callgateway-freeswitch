'use strict'; // Activa modo estricto.

const fs = require('node:fs/promises'); // Permite leer el fichero del turno.

/**
 * Adaptador STT temporal del turno.
 * @param {string} turnFile - Ruta del WAV del turno.
 * @returns {Promise<{text:string, confidence:number, provider:string}>}
 */
async function transcribeTurn(turnFile) { // Define la función principal.
    await fs.access(turnFile); // Verifica que el archivo existe y es accesible.
    return { // Devuelve un resultado STT simulado por ahora.
        text: '', // Texto vacío hasta integrar el STT real.
        confidence: 0, // Confianza nula mientras no haya transcripción real.
        provider: 'stub', // Marca que este resultado es simulado.
    }; // Fin del objeto de retorno.
} // Fin de la función.

module.exports = { transcribeTurn }; // Exporta la función.