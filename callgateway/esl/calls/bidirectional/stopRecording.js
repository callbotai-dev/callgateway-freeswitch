'use strict'; // Modo estricto.

/**
 * Detiene la grabación continua del canal.
 * @param {object} params
 * @param {string} params.uuid - UUID del canal.
 * @param {string} params.recordFile - Ruta del WAV continuo.
 * @param {(cmd:string)=>Promise<string>} params.apiAsync - Wrapper ESL API.
 */
async function stopRecording({ uuid, recordFile, apiAsync }) { // Función de parada.
    try { // Protege el stop.
        await apiAsync(`uuid_record ${uuid} stop ${recordFile}`); // Ordena a FreeSWITCH detener grabación.
        console.log('[ESL] recording stopped', { uuid, recordFile }); // Log correcto.
    } catch (e) { // Captura error.
        console.error('[ESL] recording stop error', { uuid, error: String(e?.message || e) }); // Log error.
    }
} // Fin función.

module.exports = { stopRecording }; // Exporta helper.