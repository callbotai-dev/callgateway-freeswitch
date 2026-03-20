'use strict'; // Modo estricto.

const { createBidirectionalState } = require('./createBidirectionalState'); // Estado base.
const { startRecording } = require('./startRecording'); // Start grabación.
const { stopRecording } = require('./stopRecording'); // Stop grabación.
const { runVadLoop } = require('./runVadLoop'); // Loop VAD.

/**
 * Ejecuta sesión bidireccional BASE (solo grabación + VAD).
 * @param {object} params
 */
async function runBidirectionalSession({ uuid, apiAsync, sleep, detectSpeechInWav, inCallTimeoutMs, monitor }) { // Orquestador limpio.

    const state = createBidirectionalState({ uuid, inCallTimeoutMs }); // Crea estado central.

    monitor // Hook monitor.
        .then(() => { state.isActive = false; }) // Apaga loop al colgar.
        .catch(() => { state.isActive = false; }); // También en error.

    await startRecording({ uuid, recordFile: state.recordFile, apiAsync, sleep }); // Arranca grabación.

    try { // Ejecuta loop.
        await runVadLoop({ state, detectSpeechInWav, sleep }); // Solo VAD base.
    } finally { // Limpieza garantizada.
        await stopRecording({ uuid, recordFile: state.recordFile, apiAsync }); // Stop grabación.
    }

} // Fin función.

module.exports = { runBidirectionalSession }; // Exporta.