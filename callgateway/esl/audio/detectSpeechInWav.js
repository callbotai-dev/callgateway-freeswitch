'use strict'; // Fuerza modo estricto para evitar errores silenciosos.

const fs = require('node:fs/promises'); // Importa acceso asíncrono a ficheros.

async function detectSpeechInWav(wavPath) { // Analiza un WAV PCM16 y decide si hay voz.
    const buf = await fs.readFile(wavPath); // Lee el fichero completo en memoria.
    if (buf.length <= 44) return { speech: false, rms: 0 }; // Si solo hay cabecera WAV, no hay audio útil.

    let sumSquares = 0; // Acumula energía cuadrática.
    let samples = 0; // Cuenta muestras procesadas.

    for (let i = 44; i + 1 < buf.length; i += 2) { // Recorre PCM16 little-endian saltando cabecera.
        const sample = buf.readInt16LE(i) / 32768; // Convierte muestra a rango normalizado.
        sumSquares += sample * sample; // Suma potencia instantánea.
        samples += 1; // Incrementa total de muestras.
    }

    const rms = samples ? Math.sqrt(sumSquares / samples) : 0; // Calcula nivel RMS medio.
    return { speech: rms >= 0.02, rms }; // Devuelve detección booleana y nivel medido.
} // Fin de la función.

module.exports = { detectSpeechInWav }; // Exporta la utilidad.