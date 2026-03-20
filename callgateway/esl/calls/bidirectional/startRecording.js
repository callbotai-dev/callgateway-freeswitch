'use strict'; // Modo estricto.

/**
 * Inicia grabación continua del canal.
 * @param {object} params
 * @param {string} params.uuid
 * @param {string} params.recordFile
 * @param {(cmd:string)=>Promise<string>} params.apiAsync
 * @param {(ms:number)=>Promise<void>} params.sleep
 */
async function startRecording({ uuid, recordFile, apiAsync, sleep }) { // Función inicio grabación.
    try { // Protege ejecución.
        await apiAsync(`uuid_record ${uuid} start ${recordFile}`); // Arranca grabación en FS.
        console.log('[ESL] recording started', { uuid, recordFile }); // Log OK.
        await sleep(250); // Da tiempo a que FS empiece a escribir audio real.
    } catch (e) { // Captura error.
        console.error('[ESL] recording start error', { uuid, error: String(e?.message || e) }); // Log error.
    }
} // Fin función.

module.exports = { startRecording }; // Exporta helper.