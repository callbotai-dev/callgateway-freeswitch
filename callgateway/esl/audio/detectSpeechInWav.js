'use strict'; // Fuerza modo estricto para evitar errores silenciosos.

const fs = require('node:fs/promises'); // Importa acceso asíncrono a ficheros.

/**
 * Analiza solo el tramo nuevo de un WAV PCM16 mono.
 * @param {string} wavPath - Ruta del WAV.
 * @param {number} lastOffset - Último byte leído.
 * @returns {Promise<{speech:boolean,rms:number,peak:number,durationMs:number,nextOffset:number,bytesRead:number}>}
 */
async function detectSpeechInWav(wavPath, lastOffset = 44) { // Función principal con offset incremental.
    const stat = await fs.stat(wavPath); // Lee tamaño actual del fichero.
    const fileSize = Number(stat.size || 0); // Normaliza tamaño.
    const safeOffset = Math.max(44, Number(lastOffset || 44)); // Nunca lee antes de la cabecera WAV.

    if (fileSize <= 44 || fileSize <= safeOffset) { // Si no hay audio nuevo útil.
        return { speech: false, rms: 0, peak: 0, durationMs: 0, nextOffset: fileSize, bytesRead: 0 }; // Devuelve vacío.
    }

    const endOffset = fileSize - ((fileSize - safeOffset) % 2); // Fuerza final par para PCM16.
    const bytesToRead = Math.max(0, endOffset - safeOffset); // Calcula bytes nuevos legibles.

    if (bytesToRead <= 0) { // Si no hay bloque completo de muestras.
        return { speech: false, rms: 0, peak: 0, durationMs: 0, nextOffset: endOffset, bytesRead: 0 }; // Devuelve vacío.
    }

    const fh = await fs.open(wavPath, 'r'); // Abre el fichero en modo lectura.

    try { // Protege apertura/cierre.
        const buf = Buffer.allocUnsafe(bytesToRead); // Reserva buffer exacto del tramo nuevo.
        const { bytesRead } = await fh.read(buf, 0, bytesToRead, safeOffset); // Lee solo desde el offset nuevo.

        if (bytesRead <= 1) { // Si no hay muestras completas.
            return { speech: false, rms: 0, peak: 0, durationMs: 0, nextOffset: safeOffset + bytesRead, bytesRead }; // Devuelve vacío.
        }

        let sumSquares = 0; // Acumula energía cuadrática.
        let samples = 0; // Cuenta muestras procesadas.
        let peak = 0; // Guarda el pico absoluto máximo.

        for (let i = 0; i + 1 < bytesRead; i += 2) { // Recorre PCM16 LE muestra a muestra.
            const sample = buf.readInt16LE(i) / 32768; // Convierte la muestra a rango -1..1.
            const abs = Math.abs(sample); // Calcula valor absoluto.
            if (abs > peak) peak = abs; // Actualiza pico máximo.
            sumSquares += sample * sample; // Acumula energía.
            samples += 1; // Incrementa contador.
        }

        const rms = samples ? Math.sqrt(sumSquares / samples) : 0; // Calcula RMS del tramo nuevo.
        const durationMs = samples ? Math.round((samples / 16000) * 1000) : 0; // Duración en ms a 16 kHz.
        const nextOffset = safeOffset + bytesRead; // Nuevo offset para la siguiente lectura.

        return { // Devuelve métricas del tramo incremental.
            speech: rms >= 0.02, // Marca voz si supera umbral actual.
            rms, // Energía media.
            peak, // Pico máximo.
            durationMs, // Duración del tramo leído.
            nextOffset, // Próximo byte desde donde continuar.
            bytesRead, // Bytes realmente leídos.
        };
    } finally { // Garantiza cierre del descriptor.
        await fh.close(); // Cierra el fichero.
    }
} // Fin de la función.

module.exports = { detectSpeechInWav }; // Exporta la utilidad.