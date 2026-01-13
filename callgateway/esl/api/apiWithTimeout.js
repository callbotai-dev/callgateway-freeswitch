'use strict'; // Modo estricto.

const { getConfig } = require('../config/getConfig'); // Lee timeouts.

/**
 * Ejecuta c.api(command,args) con timeout.
 * @param {any} c - conexión ESL.
 * @param {string} command - comando ESL.
 * @param {string} args - argumentos.
 */
function apiWithTimeout(c, command, args = '') { // Función única.
    console.log('[ESL] api >', command, args); // Log request.
    return new Promise((resolve, reject) => { // Promesa.
        const { apiTimeoutMs } = getConfig(); // Timeout base.
        const timeoutMs = command === 'originate' ? Math.max(60000, apiTimeoutMs) : apiTimeoutMs; // Originate tarda.
        const t = setTimeout(() => reject(new Error(`esl_api_timeout: ${command}`)), timeoutMs); // Timeout.

        c.api(command, args, (res) => { // Llama API.
            clearTimeout(t); // Cancela timeout.
            const body = String(res?.getBody?.() || '').trim(); // Normaliza.
            if (!c || !c.connected || !c.connected()) return resolve(body); // Si se cayó, resuelve.
            console.log('[ESL] api <', body); // Log response.
            resolve(body); // Devuelve body.
        }); // Fin api.
    }); // Fin promesa.
} // Fin apiWithTimeout.

module.exports = { apiWithTimeout }; // Export.
