'use strict'; // Fuerza modo estricto para evitar errores silenciosos.

const fs = require('node:fs/promises'); // Acceso async a fichero.

/**
 * Analiza solo el tramo nuevo de un WAV PCM16 mono.
 * Devuelve offsets reales donde empieza y acaba la voz dentro del bloque.
 * @param {string} wavPath
 * @param {number} lastOffset
 * @returns {Promise<{speech:boolean,rms:number,peak:number,durationMs:number,nextOffset:number,bytesRead:number,speechStartOffset:number|null,speechEndOffset:number|null}>}
 */
async function detectSpeechInWav(wavPath, lastOffset = 44) {
    const stat = await fs.stat(wavPath); // Tamaño actual del WAV.
    const fileSize = Number(stat.size || 0); // Normaliza tamaño.
    const safeOffset = Math.max(44, Number(lastOffset || 44)); // Nunca antes de cabecera.

    if (fileSize <= 44 || fileSize <= safeOffset) { // Sin audio nuevo útil.
        return {
            speech: false,
            rms: 0,
            peak: 0,
            durationMs: 0,
            nextOffset: fileSize,
            bytesRead: 0,
            speechStartOffset: null,
            speechEndOffset: null,
        };
    }

    const endOffset = fileSize - ((fileSize - safeOffset) % 2); // Fuerza final par.
    const bytesToRead = Math.max(0, endOffset - safeOffset); // Bytes legibles.

    if (bytesToRead <= 0) { // Sin muestras completas.
        return {
            speech: false,
            rms: 0,
            peak: 0,
            durationMs: 0,
            nextOffset: endOffset,
            bytesRead: 0,
            speechStartOffset: null,
            speechEndOffset: null,
        };
    }

    const fh = await fs.open(wavPath, 'r'); // Abre fichero.

    try {
        const buf = Buffer.allocUnsafe(bytesToRead); // Reserva buffer.
        const { bytesRead } = await fh.read(buf, 0, bytesToRead, safeOffset); // Lee tramo nuevo.

        if (bytesRead <= 1) { // No hay muestras completas.
            return {
                speech: false,
                rms: 0,
                peak: 0,
                durationMs: 0,
                nextOffset: safeOffset + bytesRead,
                bytesRead,
                speechStartOffset: null,
                speechEndOffset: null,
            };
        }

        let sumSquares = 0; // Energía global.
        let samples = 0; // Número de muestras.
        let peak = 0; // Pico máximo absoluto.

        const sampleThreshold = Number(process.env.CGW_VAD_SAMPLE_THRESHOLD || 0.035); // Umbral por muestra.
        const minSpeechSamples = Number(process.env.CGW_VAD_MIN_SPEECH_SAMPLES || 400); // ~25 ms a 16 kHz.
        const hangoverSamples = Number(process.env.CGW_VAD_HANGOVER_SAMPLES || 1600); // ~100 ms a 16 kHz.

        let runStartSample = -1; // Inicio provisional de racha con voz.
        let runLength = 0; // Longitud de racha actual.
        let speechStartSample = -1; // Primer sample real con voz válida.
        let speechEndSample = -1; // Último sample real con voz válida.
        let silenceAfterSpeech = 0; // Silencio tras voz detectada.

        for (let i = 0; i + 1 < bytesRead; i += 2) { // Recorre PCM16 LE.
            const sampleIndex = i / 2; // Índice de muestra.
            const sample = buf.readInt16LE(i) / 32768; // Convierte a -1..1.
            const abs = Math.abs(sample); // Valor absoluto.

            if (abs > peak) peak = abs; // Actualiza pico.
            sumSquares += sample * sample; // Acumula energía.
            samples += 1; // Cuenta muestra.

            if (abs >= sampleThreshold) { // Muestra candidata a voz.
                if (runStartSample === -1) runStartSample = sampleIndex; // Marca inicio provisional.
                runLength += 1; // Amplía racha.

                if (runLength >= minSpeechSamples) { // Ya es voz válida.
                    if (speechStartSample === -1) speechStartSample = runStartSample; // Fija inicio real.
                    speechEndSample = sampleIndex; // Actualiza fin real.
                    silenceAfterSpeech = 0; // Resetea silencio tras voz.
                }
            } else { // Muestra por debajo de umbral.
                if (speechStartSample !== -1) { // Ya había voz válida antes.
                    silenceAfterSpeech += 1; // Cuenta silencio posterior.
                    if (silenceAfterSpeech <= hangoverSamples) speechEndSample = sampleIndex; // Mantiene cola útil.
                }
                runStartSample = -1; // Rompe racha provisional.
                runLength = 0; // Resetea longitud provisional.
            }
        }

        const rms = samples ? Math.sqrt(sumSquares / samples) : 0; // RMS global.
        const durationMs = samples ? Math.round((samples / 16000) * 1000) : 0; // Duración del bloque.
        const nextOffset = safeOffset + bytesRead; // Próximo offset.

        const speechStartOffset = speechStartSample >= 0 ? safeOffset + (speechStartSample * 2) : null; // Offset real inicio voz.
        const speechEndOffset = speechEndSample >= 0 ? safeOffset + ((speechEndSample + 1) * 2) : null; // Offset real fin voz.
        const speech = speechStartOffset !== null && speechEndOffset !== null && speechEndOffset > speechStartOffset; // Voz real en bloque.

        return {
            speech,
            rms,
            peak,
            durationMs,
            nextOffset,
            bytesRead,
            speechStartOffset,
            speechEndOffset,
        };
    } finally {
        await fh.close(); // Cierra descriptor.
    }
}

module.exports = { detectSpeechInWav };