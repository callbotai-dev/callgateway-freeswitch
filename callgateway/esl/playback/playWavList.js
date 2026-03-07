'use strict'; // 1 Modo estricto para evitar errores silenciosos.

/**
 * 2 Convierte una entrada en string limpio.
 * 3 @param {any} value Valor original.
 * 4 @returns {string} String sin espacios sobrantes.
 */
function asCleanString(value) { // 5 Helper de normalización.
    return String(value ?? '').trim(); // 6 Normaliza y recorta.
}

/**
 * 7 Construye la lista final de WAVs a reproducir.
 * 8 Prioriza wav_paths si trae elementos válidos.
 * 9 Si no, usa wav_path como fallback.
 * 10 @param {object} input Entrada del orchestrator.
 * 11 @returns {string[]} Lista final ordenada.
 */
function normalizeWavList(input = {}) { // 12 Helper principal.
    const list = Array.isArray(input.wavPaths) ? input.wavPaths : []; // 13 Lee array si existe.
    const cleanedList = list.map(asCleanString).filter(Boolean); // 14 Limpia y elimina vacíos.

    if (cleanedList.length) return cleanedList; // 15 Prioriza lista múltiple.

    const single = asCleanString(input.wavPath); // 16 Lee ruta única fallback.
    return single ? [single] : []; // 17 Devuelve array homogéneo.
}

/**
 * 18 Reproduce una lista de WAVs en orden sobre el mismo canal.
 * 19 @param {object} input Datos necesarios.
 * 20 @param {(cmd:string)=>Promise<string>} input.apiAsync Wrapper ESL async.
 * 21 @param {string} input.uuid UUID del canal FreeSWITCH.
 * 22 @param {string|null} [input.wavPath] WAV único de compatibilidad.
 * 23 @param {string[]} [input.wavPaths] Lista de WAVs.
 * 24 @returns {Promise<string[]>} Lista reproducida finalmente.
 */
async function playWavList(input = {}) { // 25 Función exportada.
    const apiAsync = input.apiAsync; // 26 Lee ejecutor ESL.
    const uuid = asCleanString(input.uuid); // 27 Normaliza UUID.
    const finalList = normalizeWavList(input); // 28 Calcula lista final.

    if (typeof apiAsync !== 'function') throw new Error('playWavList_missing_apiAsync'); // 29 Guard.
    if (!uuid) throw new Error('playWavList_missing_uuid'); // 30 Guard.
    if (!finalList.length) throw new Error('playWavList_missing_wav'); // 31 Guard.

    for (const wav of finalList) { // 32 Recorre audios en el orden recibido.
        await apiAsync(`uuid_broadcast ${uuid} ${wav} aleg`); // 33 Inyecta cada WAV al leg A.
    } // 34 Fin bucle.

    return finalList; // 35 Devuelve lista realmente usada.
} // 36 Fin función.

module.exports = { playWavList }; // 37 Export común del helper.