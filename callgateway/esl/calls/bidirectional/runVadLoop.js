'use strict'; // Fuerza modo estricto.

const path = require('node:path'); // Maneja rutas del sistema.
const { mkdir } = require('node:fs/promises'); // Crea carpetas si no existen.
const { extractTurnAudio } = require('./extractTurnAudio'); // Extrae WAV del turno detectado.

/**
 * Loop VAD: detecta inicio y fin de turno por silencio real.
 * @param {object} deps - Dependencias del loop.
 * @param {object} deps.state - Estado mutable de la sesión bidireccional.
 * @param {Function} deps.detectSpeechInWav - Detector incremental de voz sobre WAV.
 * @param {Function} deps.sleep - Pausa asíncrona entre iteraciones.
 */
async function runVadLoop({ state, detectSpeechInWav, sleep }) { // Define el loop principal.
    try { // Protege el loop completo.
        while (state.isActive) { // Repite mientras la sesión siga activa.

            if ((Date.now() - state.bidirectionalStartedAt) >= state.maxBidirectionalMs) { // Comprueba timeout global.
                state.isActive = false; // Apaga la sesión por timeout.
                console.log('[ESL] bidirectional loop timeout', { uuid: state.uuid, maxBidirectionalMs: state.maxBidirectionalMs }); // Log de timeout.
                break; // Sale del loop.
            } // Fin del control de timeout.

            try { // Protege la iteración actual del VAD.
                const result = await detectSpeechInWav(state.recordFile, state.vadOffset); // Lee solo el audio nuevo desde el último offset.
                state.vadOffset = result.nextOffset; // Guarda el nuevo offset procesado.

                console.log('[VAD]', { // Registra la lectura VAD.
                    uuid: state.uuid, // UUID de la llamada.
                    speech: result.speech, // Indica si hubo voz en este bloque.
                    rms: result.rms, // Energía media del bloque.
                    peak: result.peak, // Pico máximo del bloque.
                    durationMs: result.durationMs, // Duración analizada.
                    bytesRead: result.bytesRead, // Bytes nuevos leídos.
                    vadOffset: state.vadOffset, // Offset acumulado.
                }); // Fin del log VAD.

                const now = Date.now(); // Guarda el instante actual.

                if (result.speech) { // Entra si el bloque actual contiene voz.
                    if (!state.speechActive) { // Entra si todavía no había un turno activo.
                        state.speechActive = true; // Marca turno activo.
                        state.speechStartedAt = now; // Guarda el inicio temporal del turno.
                        state.turnStartOffset = Math.max(44, state.vadOffset - result.bytesRead); // Fija el offset inicial real del turno.

                        console.log('[TURN]', { // Registra el inicio del turno.
                            uuid: state.uuid, // UUID llamada.
                            event: 'speech_start', // Tipo de evento.
                            speechStartedAt: state.speechStartedAt, // Instante de inicio.
                            turnStartOffset: state.turnStartOffset, // Offset inicial del turno.
                            vadOffset: state.vadOffset, // Offset actual.
                        }); // Fin del log de inicio.
                    } // Fin del arranque de turno.

                    state.lastSpeechAt = now; // Actualiza el último instante con voz.
                } else if (state.speechActive && state.lastSpeechAt && (now - state.lastSpeechAt) >= state.endSilenceMs) { // Cierra turno solo si había voz y ya hubo suficiente silencio real.
                    const turnEndedAt = state.vadOffset; // Marca el final bruto del turno.
                    const turnBytes = Math.max(0, turnEndedAt - state.turnStartOffset); // Calcula el tamaño total del turno.

                    state.speechActive = false; // Cierra el estado de turno activo.

                    if (turnBytes < state.minTurnBytes) { // Descarta turnos demasiado pequeños.
                        console.log('[TURN]', { // Registra descarte.
                            uuid: state.uuid, // UUID llamada.
                            event: 'speech_discarded', // Evento de descarte.
                            turnStartOffset: state.turnStartOffset, // Inicio del turno.
                            turnEndedAt, // Fin del turno.
                            turnBytes, // Tamaño detectado.
                            minTurnBytes: state.minTurnBytes, // Mínimo exigido.
                        }); // Fin del log de descarte.

                        state.turnStartOffset = turnEndedAt; // Recoloca el inicio al final descartado.
                    } else { // Entra si el turno es válido.
                        state.turnSeq += 1; // Incrementa el contador de turnos válidos.

                        const turnsDir = '/var/lib/freeswitch/recordings/cgw/turns'; // Define la carpeta de turnos.
                        const outputFile = path.join(turnsDir, `${state.uuid}_turn_${state.turnSeq}.wav`); // Construye la ruta del WAV final.

                        await mkdir(turnsDir, { recursive: true }); // Asegura que exista la carpeta destino.

                        console.log('[TURN_BOUNDS]', { // Registra límites reales del turno.
                            uuid: state.uuid, // UUID llamada.
                            turnSeq: state.turnSeq, // Número de turno.
                            turnStartOffset: state.turnStartOffset, // Inicio real.
                            turnEndedAt, // Fin real.
                            turnBytes, // Tamaño real.
                            bytesRead: result.bytesRead, // Bytes leídos en esta iteración.
                            vadOffset: state.vadOffset, // Offset acumulado.
                        }); // Fin del log de límites.

                        await extractTurnAudio({ // Extrae el audio del turno.
                            recordFile: state.recordFile, // WAV continuo fuente.
                            startOffset: state.turnStartOffset, // Inicio del turno.
                            endOffset: turnEndedAt, // Fin del turno.
                            outputFile, // Ruta del archivo de salida.
                        }); // Fin de la extracción.

                        console.log('[TURN_AUDIO]', { // Registra el archivo generado.
                            uuid: state.uuid, // UUID llamada.
                            turnSeq: state.turnSeq, // Número de turno.
                            outputFile, // Ruta del archivo generado.
                        }); // Fin del log de audio.

                        console.log('[TURN]', { // Registra el turno listo.
                            uuid: state.uuid, // UUID llamada.
                            event: 'turn_ready', // Evento de turno listo.
                            turnSeq: state.turnSeq, // Número de turno.
                            speechStartedAt: state.speechStartedAt, // Inicio temporal del turno.
                            lastSpeechAt: state.lastSpeechAt, // Último instante con voz.
                            silenceMs: now - state.lastSpeechAt, // Silencio que ha cerrado el turno.
                            turnStartOffset: state.turnStartOffset, // Offset inicial.
                            turnEndedAt, // Offset final.
                            turnBytes, // Tamaño final.
                            recordFile: state.recordFile, // Archivo continuo fuente.
                            outputFile, // Archivo final recortado.
                        }); // Fin del log turn_ready.

                        state.turnStartOffset = turnEndedAt; // Prepara el siguiente turno.
                    } // Fin de turno válido.
                } // Fin del cierre por silencio real.
            } catch (e) { // Captura error de esta iteración.
                console.error('[VAD] error', { uuid: state.uuid, error: String(e?.message || e) }); // Registra error.
            } // Fin del try/catch interno.

            if (!state.isActive) break; // Seguridad extra por si la sesión se apagó.
            await sleep(state.vadPollMs); // Espera entre polls.
        } // Fin del while.
    } catch (e) { // Captura error global del loop.
        console.error('[ESL] bidirectional loop error', { uuid: state.uuid, error: String(e?.message || e) }); // Registra error global.
    } // Fin del try/catch global.
} // Fin de la función.

module.exports = { runVadLoop }; // Exporta la función.