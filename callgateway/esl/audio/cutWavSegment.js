'use strict';

const fs = require('node:fs/promises');

/**
 * Recorta un segmento de un WAV PCM16 mono.
 * @param {string} input - WAV original.
 * @param {string} output - WAV destino.
 * @param {number} start - Byte inicio (>=44).
 * @param {number} end - Byte fin.
 */
async function cutWavSegment(input, output, start, end) {
    const buf = await fs.readFile(input); // Lee WAV completo.
    if (buf.length <= 44) return; // Sin audio útil.

    const safeStart = Math.max(44, start); // Nunca antes de cabecera.
    const safeEnd = Math.min(buf.length, end); // No sobrepasar fichero.
    const audioSlice = buf.slice(safeStart, safeEnd); // Extrae tramo.

    const header = Buffer.from(buf.slice(0, 44)); // Copia cabecera WAV.

    const dataSize = audioSlice.length; // Tamaño datos audio.
    header.writeUInt32LE(36 + dataSize, 4); // ChunkSize.
    header.writeUInt32LE(dataSize, 40); // Subchunk2Size.

    const out = Buffer.concat([header, audioSlice]); // Une cabecera + audio.
    await fs.writeFile(output, out); // Guarda WAV recortado.
}

module.exports = { cutWavSegment };