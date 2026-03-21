'use strict'; // Fuerza modo estricto para evitar errores silenciosos.

const fs = require('node:fs/promises'); // Acceso async a fichero.

/**
 * Analiza solo el tramo nuevo de un WAV PCM16 mono.
 * Detecta voz por ventanas cortas, no por 400 muestras seguidas.
 * @param {string} wavPath
 * @param {number} lastOffset
 * @returns {Promise<{speech:boolean,rms:number,peak:number,durationMs:number,nextOffset:number,bytesRead:number,speechStartOffset:number|null,speechEndOffset:number|null}>}
 */
async function detectSpeechInWav(wavPath, lastOffset = 44) { // Función principal.
    const stat = await fs.stat(wavPath); // Lee tamaño actual del fichero.
    const fileSize = Number(stat.size || 0); // Normaliza tamaño.
    const safeOffset = Math.max(44, Number(lastOffset || 44)); // Nunca lee antes de la cabecera WAV.

    if (fileSize <= 44 || fileSize <= safeOffset) { // Si aún no hay audio útil nuevo.
        return {
            speech: false, // No hay voz.
            rms: 0, // Sin energía.
            peak: 0, // Sin pico.
            durationMs: 0, // Sin duración.
            nextOffset: fileSize, // Próximo offset al final actual.
            bytesRead: 0, // No se leyó nada.
            speechStartOffset: null, // Sin inicio de voz.
            speechEndOffset: null, // Sin fin de voz.
        };
    }

    const endOffset = fileSize - ((fileSize - safeOffset) % 2); // Ajusta a múltiplo par para PCM16.
    const bytesToRead = Math.max(0, endOffset - safeOffset); // Calcula bytes legibles.

    if (bytesToRead <= 0) { // Si no hay muestras completas.
        return {
            speech: false, // No hay voz.
            rms: 0, // Sin energía.
            peak: 0, // Sin pico.
            durationMs: 0, // Sin duración.
            nextOffset: endOffset, // Mantiene offset correcto.
            bytesRead: 0, // No se leyó nada.
            speechStartOffset: null, // Sin inicio de voz.
            speechEndOffset: null, // Sin fin de voz.
        };
    }

    const fh = await fs.open(wavPath, 'r'); // Abre el WAV en modo lectura.

    try { // Bloque protegido.
        const buf = Buffer.allocUnsafe(bytesToRead); // Reserva buffer del tramo nuevo.
        const { bytesRead } = await fh.read(buf, 0, bytesToRead, safeOffset); // Lee desde el último offset.

        if (bytesRead <= 1) { // Si no hay muestras completas.
            return {
                speech: false, // No hay voz.
                rms: 0, // Sin energía.
                peak: 0, // Sin pico.
                durationMs: 0, // Sin duración.
                nextOffset: safeOffset + bytesRead, // Avanza lo leído.
                bytesRead, // Devuelve bytes reales.
                speechStartOffset: null, // Sin inicio de voz.
                speechEndOffset: null, // Sin fin de voz.
            };
        }

        let sumSquares = 0; // Acumula energía global.
        let samples = 0; // Cuenta muestras totales.
        let peak = 0; // Guarda el pico máximo absoluto.

        const sampleThreshold = Number(process.env.CGW_VAD_SAMPLE_THRESHOLD || 0.02); // Umbral por muestra más realista.
        const windowSamples = Number(process.env.CGW_VAD_WINDOW_SAMPLES || 160); // 10 ms a 16 kHz.
        const minActiveInWindow = Number(process.env.CGW_VAD_MIN_ACTIVE_IN_WINDOW || 16); // Mínimo de muestras activas en ventana.
        const minSpeechWindows = Number(process.env.CGW_VAD_MIN_SPEECH_WINDOWS || 3); // Mínimo de ventanas activas para validar voz.
        const maxSilenceWindows = Number(process.env.CGW_VAD_MAX_SILENCE_WINDOWS || 10); // Cola de silencio tolerada tras voz.

        let speechStartSample = -1; // Inicio real de voz dentro del bloque.
        let speechEndSample = -1; // Fin real de voz dentro del bloque.
        let activeWindows = 0; // Cuenta ventanas activas consecutivas.
        let silenceWindowsAfterSpeech = 0; // Cuenta ventanas silenciosas tras voz válida.

        for (let base = 0; base + 1 < bytesRead; base += (windowSamples * 2)) { // Recorre el bloque en ventanas cortas.
            let activeInWindow = 0; // Cuenta muestras activas en esta ventana.
            let windowLastSampleIndex = -1; // Última muestra válida de la ventana.

            for (let i = base; i + 1 < Math.min(base + (windowSamples * 2), bytesRead); i += 2) { // Recorre muestras de la ventana.
                const sampleIndex = i / 2; // Índice de muestra relativo al bloque.
                const sample = buf.readInt16LE(i) / 32768; // Convierte PCM16 a float.
                const abs = Math.abs(sample); // Valor absoluto de amplitud.

                if (abs > peak) peak = abs; // Actualiza pico global.
                sumSquares += sample * sample; // Suma energía global.
                samples += 1; // Incrementa contador global.
                windowLastSampleIndex = sampleIndex; // Guarda última muestra válida.

                if (abs >= sampleThreshold) activeInWindow += 1; // Cuenta muestra activa.
            }

            if (windowLastSampleIndex === -1) continue; // Si la ventana quedó vacía, la ignora.

            const windowIsSpeech = activeInWindow >= minActiveInWindow; // Decide si la ventana contiene voz útil.

            if (windowIsSpeech) { // Si esta ventana parece voz.
                activeWindows += 1; // Acumula ventanas activas consecutivas.

                if (activeWindows >= minSpeechWindows) { // Si ya hay continuidad suficiente.
                    if (speechStartSample === -1) { // Si aún no había inicio fijado.
                        const rewindWindows = minSpeechWindows - 1; // Retrocede para incluir el arranque real.
                        const rewindSamples = rewindWindows * windowSamples; // Convierte ventanas a muestras.
                        speechStartSample = Math.max(0, (base / 2) - rewindSamples); // Fija inicio real aproximado.
                    }

                    speechEndSample = windowLastSampleIndex; // Actualiza fin real con esta ventana.
                    silenceWindowsAfterSpeech = 0; // Resetea silencio tras voz.
                }
            } else { // Si la ventana no parece voz.
                activeWindows = 0; // Rompe continuidad de voz.

                if (speechStartSample !== -1) { // Si ya existía voz válida antes.
                    silenceWindowsAfterSpeech += 1; // Cuenta silencio posterior.
                    if (silenceWindowsAfterSpeech <= maxSilenceWindows) { // Si la cola aún es tolerable.
                        speechEndSample = windowLastSampleIndex; // Mantiene una pequeña cola natural.
                    }
                }
            }
        }

        const rms = samples ? Math.sqrt(sumSquares / samples) : 0; // Calcula RMS global del bloque.
        const durationMs = samples ? Math.round((samples / 16000) * 1000) : 0; // Convierte muestras a milisegundos.
        const nextOffset = safeOffset + bytesRead; // Calcula el siguiente offset incremental.

        const speechStartOffset = speechStartSample >= 0 ? safeOffset + (speechStartSample * 2) : null; // Convierte inicio a offset de bytes.
        const speechEndOffset = speechEndSample >= 0 ? safeOffset + ((speechEndSample + 1) * 2) : null; // Convierte fin a offset de bytes.
        const speech = speechStartOffset !== null && speechEndOffset !== null && speechEndOffset > speechStartOffset; // Decide si hubo voz real.

        return {
            speech, // Devuelve si hubo voz real.
            rms, // Devuelve RMS global.
            peak, // Devuelve pico global.
            durationMs, // Devuelve duración del bloque.
            nextOffset, // Devuelve próximo offset.
            bytesRead, // Devuelve bytes leídos.
            speechStartOffset, // Devuelve inicio real de voz.
            speechEndOffset, // Devuelve fin real de voz.
        };
    } finally { // Limpieza segura.
        await fh.close(); // Cierra descriptor siempre.
    }
}

module.exports = { detectSpeechInWav }; // Exporta función.