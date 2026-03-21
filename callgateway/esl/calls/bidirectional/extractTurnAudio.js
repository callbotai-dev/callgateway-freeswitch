'use strict'; // Modo estricto.

const fs = require('fs').promises; // FS async.

/**
 * Extrae un chunk WAV desde el archivo continuo.
 * @param {object} params
 */
async function extractTurnAudio({ recordFile, startOffset, endOffset, outputFile }) { // Función principal.

    // Validaciones críticas.
    if (!recordFile) throw new Error('recordFile requerido'); // Evita ruta null.
    if (!outputFile) throw new Error('outputFile requerido'); // Evita escritura inválida.
    if (endOffset <= startOffset) throw new Error('offset inválido'); // Evita chunk vacío o negativo.

    const fd = await fs.open(recordFile, 'r'); // Abre WAV original.
    const length = endOffset - startOffset; // Calcula tamaño del chunk.
    if (length < 320) return null; // Ignora audios demasiado pequeños (~20ms a 8kHz).
    const buffer = Buffer.alloc(length); // Reserva buffer.
    await fd.read(buffer, 0, length, startOffset); // Lee segmento exacto.
    await fd.close(); // Cierra archivo.

    const header = Buffer.alloc(44); // Cabecera WAV básica.
    header.write('RIFF', 0); // ChunkID.
    header.writeUInt32LE(36 + length, 4); // ChunkSize.
    header.write('WAVE', 8); // Format.
    header.write('fmt ', 12); // Subchunk1ID.
    header.writeUInt32LE(16, 16); // Subchunk1Size.
    header.writeUInt16LE(1, 20); // AudioFormat PCM.
    header.writeUInt16LE(1, 22); // NumChannels.
    header.writeUInt32LE(8000, 24); // SampleRate.
    header.writeUInt32LE(16000, 28); // ByteRate.
    header.writeUInt16LE(2, 32); // BlockAlign.
    header.writeUInt16LE(16, 34); // BitsPerSample.
    header.write('data', 36); // Subchunk2ID.
    header.writeUInt32LE(length, 40); // Subchunk2Size.

    await fs.writeFile(outputFile, Buffer.concat([header, buffer])); // Guarda WAV final.

} // Fin función.

module.exports = { extractTurnAudio }; // Exporta.