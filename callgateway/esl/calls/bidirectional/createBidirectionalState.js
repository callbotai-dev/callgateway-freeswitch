'use strict'; // Fuerza modo estricto.

/**
 * Crea el estado base del modo bidireccional.
 * @param {object} params - Parámetros base.
 * @param {string} params.uuid - UUID del canal.
 * @param {number} params.inCallTimeoutMs - Timeout de llamada activa.
 * @returns {object}
 */
function createBidirectionalState({ uuid, inCallTimeoutMs }) { // Fabrica el estado inicial.
    return { // Devuelve un objeto plano y centralizado.
        isActive: true, // Controla si el loop sigue vivo.
        bidirectionalStartedAt: Date.now(), // Marca inicio del modo bidireccional.
        maxBidirectionalMs: Number(process.env.CGW_BIDIRECTIONAL_MAX_MS || inCallTimeoutMs), // Límite máximo del loop.
        recordFile: `/var/lib/freeswitch/recordings/cgw/cgw_${uuid}.wav`, // Ruta del WAV continuo.
        vadOffset: 44, // Primer byte útil tras cabecera WAV.
        turnStartOffset: 44, // Inicio del turno actual.
        speechActive: false, // Estado de voz activa del cliente.
        speechStartedAt: 0, // Timestamp de inicio de voz.
        lastSpeechAt: 0, // Última voz detectada.
        endSilenceMs: Number(process.env.CGW_END_SILENCE_MS || 700), // Silencio para cerrar turno.
        minTurnBytes: Number(process.env.CGW_MIN_TURN_BYTES || 3200), // Tamaño mínimo de turno válido.
        turnSeq: 0, // Secuencia de turnos.
        speechSeq: 0, // Secuencia de eventos speech.
        vadPollMs: Number(process.env.CGW_VAD_POLL_MS || 100), // Espera entre polls.
    }; // Fin del estado.
} // Fin de la función.

module.exports = { createBidirectionalState }; // Exporta la factoría.