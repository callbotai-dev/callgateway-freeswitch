'use strict'; // Fuerza modo estricto.

const path = require('node:path'); // Maneja rutas del sistema.
const { mkdir } = require('node:fs/promises'); // Crea carpetas si no existen.
const { extractTurnAudio } = require('./extractTurnAudio'); // Extrae WAV del turno detectado.

/**
 * Loop VAD puro: detecta inicio y fin de turno por silencio.
 * @param {object} deps - Dependencias del loop.
 * @param {object} deps.state - Estado mutable de la sesión bidireccional.
 * @param {Function} deps.detectSpeechInWav - Detector incremental de voz sobre WAV.
 * @param {Function} deps.sleep - Pausa asíncrona entre iteraciones.
 */
async function runVadLoop({ state, detectSpeechInWav, sleep }) { // Loop principal VAD.
    try { // Protección global del loop.
        while (state.isActive) { // Mantiene el loop mientras la sesión siga viva.

            if ((Date.now() - state.bidirectionalStartedAt) >= state.maxBidirectionalMs) { // Comprueba timeout máximo.
                state.isActive = false; // Apaga la sesión.
                console.log('[ESL] bidirectional loop timeout', { uuid: state.uuid, maxBidirectionalMs: state.maxBidirectionalMs }); // Log timeout.
                break; // Sale del loop.
            }

            try { // Bloque protegido de lectura VAD.
                const result = await detectSpeechInWav(state.recordFile, state.vadOffset); // Lee solo el tramo nuevo del WAV.
                state.vadOffset = result.nextOffset; // Guarda el nuevo offset procesado.

                console.log('[VAD]', { // Log técnico del detector.
                    uuid: state.uuid, // UUID de la llamada.
                    speech: result.speech, // Si hubo voz en este bloque.
                    rms: result.rms, // Energía media.
                    peak: result.peak, // Pico máximo.
                    durationMs: result.durationMs, // Duración analizada.
                    bytesRead: result.bytesRead, // Bytes nuevos leídos.
                    vadOffset: state.vadOffset, // Offset acumulado.
                });

                const now = Date.now(); // Tiempo actual para cálculos temporales.

                if (result.speech) { // Si este bloque contiene voz.
                    if (!state.speechActive) { // Si es el arranque de un nuevo turno.
                        state.speechActive = true; // Marca turno activo.
                        state.speechStartedAt = now; // Guarda inicio temporal del turno.
                        state.turnStartOffset = Math.max(44, state.vadOffset - result.bytesRead); // Guarda offset inicial del turno.
                        console.log('[TURN]', { // Log de inicio de turno.
                            uuid: state.uuid, // UUID llamada.
                            event: 'speech_start', // Evento detectado.
                            speechStartedAt: state.speechStartedAt, // Timestamp de inicio.
                            turnStartOffset: state.turnStartOffset, // Offset inicial del turno.
                            vadOffset: state.vadOffset, // Offset actual.
                        });
                    }

                    state.lastSpeechAt = now; // Actualiza último instante con voz.
                } else if (state.speechActive && state.lastSpeechAt && (now - state.lastSpeechAt) >= state.endSilenceMs) { // Si había turno activo y ya hubo suficiente silencio.
                    const turnEndedAt = state.vadOffset; // Marca el final bruto del turno.
                    const turnBytes = Math.max(0, turnEndedAt - state.turnStartOffset); // Calcula tamaño del turno.

                    state.speechActive = false; // Cierra el turno actual.

                    if (turnBytes < state.minTurnBytes) { // Si el turno es demasiado corto.
                        console.log('[TURN]', { // Log descarte.
                            uuid: state.uuid, // UUID llamada.
                            event: 'speech_discarded', // Evento descarte.
                            turnStartOffset: state.turnStartOffset, // Inicio turno.
                            turnEndedAt, // Fin turno.
                            turnBytes, // Tamaño detectado.
                            minTurnBytes: state.minTurnBytes, // Mínimo exigido.
                        });

                        state.turnStartOffset = turnEndedAt; // Recoloca el inicio al final descartado.
                    } else { // Si el turno es válido.
                        state.turnSeq += 1; // Incrementa contador de turnos válidos.

                        const turnsDir = '/var/lib/freeswitch/recordings/cgw/turns'; // Carpeta destino de turnos.
                        const outputFile = path.join(turnsDir, `${state.uuid}_turn_${state.turnSeq}.wav`); // Ruta final del turno.

                        await mkdir(turnsDir, { recursive: true }); // Asegura que exista la carpeta.
                        await extractTurnAudio({ // Extrae el WAV del turno detectado.
                            recordFile: state.recordFile, // WAV continuo fuente.
                            startOffset: state.turnStartOffset, // Inicio del turno.
                            endOffset: turnEndedAt, // Fin del turno.
                            outputFile, // Archivo de salida.
                        });

                        console.log('[TURN_AUDIO]', { // Log del archivo generado.
                            uuid: state.uuid, // UUID llamada.
                            turnSeq: state.turnSeq, // Número de turno.
                            outputFile, // Ruta del WAV recortado.
                        });

                        console.log('[TURN]', { // Log de turno válido cerrado.
                            uuid: state.uuid, // UUID llamada.
                            event: 'turn_ready', // Turno listo.
                            turnSeq: state.turnSeq, // Número de turno.
                            speechStartedAt: state.speechStartedAt, // Inicio temporal del turno.
                            lastSpeechAt: state.lastSpeechAt, // Última voz detectada.
                            silenceMs: now - state.lastSpeechAt, // Silencio que cerró el turno.
                            turnStartOffset: state.turnStartOffset, // Offset inicio.
                            turnEndedAt, // Offset fin.
                            turnBytes, // Tamaño final.
                            recordFile: state.recordFile, // Archivo fuente continuo.
                            outputFile, // Archivo final del turno.
                        });

                        state.turnStartOffset = turnEndedAt; // Prepara el siguiente turno.
                    }
                }

            } catch (e) { // Si falla lectura o cálculo.
                console.error('[VAD] error', { uuid: state.uuid, error: String(e?.message || e) }); // Log error.
            }

            if (!state.isActive) break; // Seguridad extra.
            await sleep(state.vadPollMs); // Espera controlada entre polls.

        } // Fin loop.

    } catch (e) { // Error global.
        console.error('[ESL] bidirectional loop error', { uuid: state.uuid, error: String(e?.message || e) }); // Log global.
    }
} // Fin función.

module.exports = { runVadLoop }; // Exporta.