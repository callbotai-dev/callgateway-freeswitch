'use strict'; // Fuerza modo estricto para evitar errores silenciosos.

const fs = require('node:fs/promises'); // Importa acceso asíncrono a ficheros.

async function detectSpeechInWav(wavPath) { // Analiza un WAV PCM16 y decide si hay voz.
    const buf = await fs.readFile(wavPath); // Lee el fichero completo en memoria.
    if (buf.length <= 44) return { speech: false, rms: 0 }; // Si solo hay cabecera WAV, no hay audio útil.

    let sumSquares = 0; // Acumula energía cuadrática.
    let samples = 0; // Cuenta muestras procesadas.
    let peak = 0; // Pico absoluto máximo.

    for (let i = 44; i + 1 < buf.length; i += 2) {
        const sample = buf.readInt16LE(i) / 32768;
        const abs = Math.abs(sample);
        if (abs > peak) peak = abs;
        sumSquares += sample * sample;
        samples += 1;
    }

    const rms = samples ? Math.sqrt(sumSquares / samples) : 0;
    const durationMs = samples ? Math.round((samples / 8000) * 1000) : 0;
    return { speech: rms >= 0.02, rms, peak, durationMs };
} // Fin de la función.

module.exports = { detectSpeechInWav }; // Exporta la utilidad.