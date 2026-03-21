'use strict'; // Fuerza modo estricto.

const path = require('node:path'); // Maneja rutas.
const { mkdir } = require('node:fs/promises'); // Crea carpetas.
const { extractTurnAudio } = require('./extractTurnAudio'); // Extrae WAV del turno.

/**
 * Loop VAD: detecta inicio y fin real de turno.
 * @param {object} deps
 * @param {object} deps.state
 * @param {Function} deps.detectSpeechInWav
 * @param {Function} deps.sleep
 */
async function runVadLoop({ state, detectSpeechInWav, sleep }) { // Loop principal.
    try { // Protección global.
        while (state.isActive) { // Mantiene la sesión viva.

            if ((Date.now() - state.bidirectionalStartedAt) >= state.maxBidirectionalMs) { // Control timeout.
                state.isActive = false; // Cierra sesión.
                console.log('[ESL] bidirectional loop timeout', { uuid: state.uuid, maxBidirectionalMs: state.maxBidirectionalMs }); // Log timeout.
                break; // Sale.
            }

            try { // Iteración protegida.
                const result = await detectSpeechInWav(state.recordFile, state.vadOffset); // Lee tramo nuevo.
                state.vadOffset = result.nextOffset; // Actualiza offset global.

                console.log('[VAD]', { // Log técnico.
                    uuid: state.uuid,
                    speech: result.speech,
                    rms: result.rms,
                    peak: result.peak,
                    durationMs: result.durationMs,
                    bytesRead: result.bytesRead,
                    vadOffset: state.vadOffset,
                    speechStartOffset: result.speechStartOffset,
                    speechEndOffset: result.speechEndOffset,
                });

                const now = Date.now(); // Tiempo actual.

                if (result.speech) { // Si hubo voz real en este bloque.
                    if (!state.speechActive) { // Si arranca un turno nuevo.
                        state.speechActive = true; // Marca turno activo.
                        state.speechStartedAt = now; // Guarda inicio temporal.
                        state.turnStartOffset = Math.max(44, Number(result.speechStartOffset || (state.vadOffset - result.bytesRead))); // Inicio real del turno.

                        console.log('[TURN]', { // Log inicio turno.
                            uuid: state.uuid,
                            event: 'speech_start',
                            speechStartedAt: state.speechStartedAt,
                            turnStartOffset: state.turnStartOffset,
                            vadOffset: state.vadOffset,
                        });
                    }

                    state.lastSpeechAt = now; // Guarda último instante con voz.
                    state.lastSpeechOffset = Number(result.speechEndOffset || state.vadOffset); // Guarda último byte real con voz.
                } else if (state.speechActive && state.lastSpeechAt && (now - state.lastSpeechAt) >= state.endSilenceMs) { // Si terminó por silencio.
                    const turnEndedAt = Math.max(state.turnStartOffset, Number(state.lastSpeechOffset || state.vadOffset)); // Fin real del turno.
                    const turnBytes = Math.max(0, turnEndedAt - state.turnStartOffset); // Tamaño real.

                    state.speechActive = false; // Cierra turno activo.

                    if (turnBytes < state.minTurnBytes) { // Si es demasiado corto.
                        console.log('[TURN]', { // Log descarte.
                            uuid: state.uuid,
                            event: 'speech_discarded',
                            turnStartOffset: state.turnStartOffset,
                            turnEndedAt,
                            turnBytes,
                            minTurnBytes: state.minTurnBytes,
                        });

                        state.turnStartOffset = turnEndedAt; // Recoloca inicio.
                    } else { // Turno válido.
                        state.turnSeq += 1; // Incrementa secuencia.

                        const turnsDir = '/var/lib/freeswitch/recordings/cgw/turns'; // Carpeta destino.
                        const outputFile = path.join(turnsDir, `${state.uuid}_turn_${state.turnSeq}.wav`); // Ruta turno.

                        await mkdir(turnsDir, { recursive: true }); // Asegura carpeta.

                        console.log('[TURN_BOUNDS]', { // Log límites reales.
                            uuid: state.uuid,
                            turnSeq: state.turnSeq,
                            turnStartOffset: state.turnStartOffset,
                            turnEndedAt,
                            turnBytes,
                            bytesRead: result.bytesRead,
                            vadOffset: state.vadOffset,
                            lastSpeechOffset: state.lastSpeechOffset,
                        });

                        await extractTurnAudio({ // Extrae audio.
                            recordFile: state.recordFile,
                            startOffset: state.turnStartOffset,
                            endOffset: turnEndedAt,
                            outputFile,
                        });

                        console.log('[TURN_AUDIO]', { // Log archivo generado.
                            uuid: state.uuid,
                            turnSeq: state.turnSeq,
                            outputFile,
                        });

                        console.log('[TURN]', { // Log turno listo.
                            uuid: state.uuid,
                            event: 'turn_ready',
                            turnSeq: state.turnSeq,
                            speechStartedAt: state.speechStartedAt,
                            lastSpeechAt: state.lastSpeechAt,
                            silenceMs: now - state.lastSpeechAt,
                            turnStartOffset: state.turnStartOffset,
                            turnEndedAt,
                            turnBytes,
                            recordFile: state.recordFile,
                            outputFile,
                        });

                        state.turnStartOffset = turnEndedAt; // Prepara siguiente turno.
                    }
                }

            } catch (e) { // Error iteración.
                console.error('[VAD] error', { uuid: state.uuid, error: String(e?.message || e) }); // Log error.
            }

            if (!state.isActive) break; // Seguridad extra.
            await sleep(state.vadPollMs); // Pausa controlada.
        }

    } catch (e) { // Error global.
        console.error('[ESL] bidirectional loop error', { uuid: state.uuid, error: String(e?.message || e) }); // Log global.
    }
}

module.exports = { runVadLoop }; // Exporta.