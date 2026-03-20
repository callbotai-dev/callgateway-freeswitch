'use strict'; // Fuerza modo estricto.

/**
 * Crea un wrapper promise para comandos ESL API.
 * @param {object} connection - Conexión ESL activa.
 * @returns {(cmd:string) => Promise<string>}
 */
function createApiAsync(connection) { // Fabrica el ejecutor async.
    return (cmd) => new Promise((resolve, reject) => { // Devuelve función promise.
        connection.api(cmd, (res) => { // Ejecuta comando API en FreeSWITCH.
            const body = String(res?.getBody?.() || ''); // Lee body devuelto.
            if (body.startsWith('-ERR')) return reject(new Error(body)); // Rechaza si FS responde error.
            resolve(body); // Resuelve con respuesta correcta.
        }); // Fin callback.
    }); // Fin promise.
} // Fin función.

module.exports = { createApiAsync }; // Exporta helper.