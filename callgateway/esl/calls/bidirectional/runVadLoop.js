'use strict'; // Modo estricto.

/**
 * Loop VAD puro (solo detección + logs).
 * @param {object} deps
 */
async function runVadLoop({ state, detectSpeechInWav, sleep }) { // Loop principal VAD.
    try { // Protección global.
        while (state.isActive) { // Mientras la llamada siga activa.

            if ((Date.now() - state.bidirectionalStartedAt) >= state.maxBidirectionalMs) { // Timeout.
                state.isActive = false; // Cierra loop.
                console.log('[ESL] bidirectional loop timeout', { maxBidirectionalMs: state.maxBidirectionalMs }); // Log.
                break; // Sale.
            }

            try { // Lectura incremental WAV.
                const result = await detectSpeechInWav(state.recordFile, state.vadOffset); // Lee solo nuevo audio.
                state.vadOffset = result.nextOffset; // Avanza offset.

                console.log('[VAD]', { // Log limpio.
                    speech: result.speech,
                    rms: result.rms,
                    peak: result.peak,
                    durationMs: result.durationMs,
                    bytesRead: result.bytesRead,
                    vadOffset: state.vadOffset,
                });

            } catch (e) { // Error lectura.
                console.error('[VAD] error', { error: String(e?.message || e) }); // Log error.
            }

            if (!state.isActive) break; // Seguridad extra.
            await sleep(state.vadPollMs); // Espera controlada.

        } // Fin loop.

    } catch (e) { // Error global.
        console.error('[ESL] bidirectional loop error', { error: String(e?.message || e) }); // Log.
    }
} // Fin función.

module.exports = { runVadLoop }; // Exporta.