'use strict'; // Fuerza modo estricto.

const path = require('node:path'); // Maneja rutas del sistema.
const { mkdir } = require('node:fs/promises'); // Crea carpetas si no existen.
const { extractTurnAudio } = require('./extractTurnAudio'); // Extrae WAV del turno detectado.

/**
 * Loop VAD: detecta inicio y fin de turno por silencio real.
 * @param {object} deps
 * @param {object} deps.state
 * @param {Function} deps.detectSpeechInWav
 * @param {Function} deps.sleep
 */
async function runVadLoop({ state, detectSpeechInWav, sleep }) {
    try {
        while (state.isActive) {
            if ((Date.now() - state.bidirectionalStartedAt) >= state.maxBidirectionalMs) {
                state.isActive = false;
                console.log('[ESL] bidirectional loop timeout', {
                    uuid: state.uuid,
                    maxBidirectionalMs: state.maxBidirectionalMs,
                });
                break;
            }

            try {
                const result = await detectSpeechInWav(state.recordFile, state.vadOffset);
                state.vadOffset = result.nextOffset;

                console.log('[VAD]', {
                    uuid: state.uuid,
                    speech: result.speech,
                    rms: result.rms,
                    peak: result.peak,
                    durationMs: result.durationMs,
                    bytesRead: result.bytesRead,
                    vadOffset: state.vadOffset,
                });

                const now = Date.now();

                if (result.speech) {
                    if (!state.speechActive) {
                        state.speechActive = true;
                        state.speechStartedAt = now;
                        state.turnStartOffset = Math.max(44, state.vadOffset - result.bytesRead);

                        console.log('[TURN]', {
                            uuid: state.uuid,
                            event: 'speech_start',
                            speechStartedAt: state.speechStartedAt,
                            turnStartOffset: state.turnStartOffset,
                            vadOffset: state.vadOffset,
                        });
                    }

                    state.lastSpeechAt = now;
                    state.lastSpeechOffset = state.vadOffset;
                } else if (
                    state.speechActive &&
                    state.lastSpeechAt &&
                    (now - state.lastSpeechAt) >= state.endSilenceMs
                ) {
                    const turnEndedAt = state.lastSpeechOffset || state.vadOffset;
                    const turnBytes = Math.max(0, turnEndedAt - state.turnStartOffset);

                    state.speechActive = false;

                    if (turnBytes < state.minTurnBytes) {
                        console.log('[TURN]', {
                            uuid: state.uuid,
                            event: 'speech_discarded',
                            turnStartOffset: state.turnStartOffset,
                            turnEndedAt,
                            turnBytes,
                            minTurnBytes: state.minTurnBytes,
                        });

                        state.turnStartOffset = turnEndedAt;
                    } else {
                        state.turnSeq += 1;

                        const turnsDir = '/var/lib/freeswitch/recordings/cgw/turns';
                        const outputFile = path.join(
                            turnsDir,
                            `${state.uuid}_turn_${state.turnSeq}.wav`
                        );

                        await mkdir(turnsDir, { recursive: true });

                        console.log('[TURN_BOUNDS]', {
                            uuid: state.uuid,
                            turnSeq: state.turnSeq,
                            turnStartOffset: state.turnStartOffset,
                            turnEndedAt,
                            turnBytes,
                            bytesRead: result.bytesRead,
                            vadOffset: state.vadOffset,
                            lastSpeechOffset: state.lastSpeechOffset,
                        });

                        await extractTurnAudio({
                            recordFile: state.recordFile,
                            startOffset: state.turnStartOffset,
                            endOffset: turnEndedAt,
                            outputFile,
                        });

                        console.log('[TURN_AUDIO]', {
                            uuid: state.uuid,
                            turnSeq: state.turnSeq,
                            outputFile,
                        });

                        console.log('[TURN]', {
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

                        state.turnStartOffset = turnEndedAt;
                    }
                }
            } catch (e) {
                console.error('[VAD] error', {
                    uuid: state.uuid,
                    error: String(e?.message || e),
                });
            }

            if (!state.isActive) break;
            await sleep(state.vadPollMs);
        }
    } catch (e) {
        console.error('[ESL] bidirectional loop error', {
            uuid: state.uuid,
            error: String(e?.message || e),
        });
    }
}

module.exports = { runVadLoop };