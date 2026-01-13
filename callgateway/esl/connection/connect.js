'use strict'; // Modo estricto.

const modesl = require('modesl'); // Cliente ESL.
const { getConfig } = require('../config/getConfig'); // Config ENV.
const { state } = require('./state'); // Estado compartido.

/**
 * Lee la conexión actual del estado compartido.
 * @returns {any|null} conn ESL o null
 */
function getConn() { // Devuelve conexión actual.
    return state().conn; // Lee del singleton.
} // Fin getConn.

/**
 * Guarda la conexión en el estado compartido.
 * @param {any|null} c conexión ESL
 */
function setConn(c) { // Asigna conexión.
    state().conn = c; // Guarda en singleton.
} // Fin setConn.

/**
 * Abre o reutiliza la conexión ESL.
 * @returns {Promise<any>} conexión ESL activa
 */
function connect() { // Abre o reutiliza conexión.
    const existing = getConn(); // Lee cache.
    if (existing && existing.connected && existing.connected()) return Promise.resolve(existing); // Reutiliza.

    const { host, port, pass } = getConfig(); // Lee config.

    return new Promise((resolve, reject) => { // Promesa conexión.
        let settled = false; // Evita doble salida.

        const t = setTimeout(() => { // Timeout.
            if (settled) return; // Guard.
            settled = true; // Marca.
            reject(new Error('esl_connect_timeout')); // Error.
        }, 8000); // 8s.

        const c = new modesl.Connection(host, port, pass, () => { // Auth OK.
            if (settled) return; // Guard.
            settled = true; // Marca.
            clearTimeout(t); // Limpia.
            console.log('[ESL] connected(auth)', { host, port }); // Log.
            try { c.events('plain', 'ALL'); } catch (_) { } // Activa eventos.
            setConn(c); // Guarda conexión.
            resolve(c); // OK.
        }); // Crea conexión.

        setConn(c); // Guarda provisional para otros módulos.

        c.once('ready', () => { // Algunos builds emiten ready.
            if (settled) return; // Guard.
            settled = true; // Marca.
            clearTimeout(t); // Limpia.
            console.log('[ESL] ready', { host, port }); // Log.
            setConn(c); // Asegura guardado.
            resolve(c); // OK.
        }); // Fin ready.

        c.once('error', (err) => { // Error de conexión.
            if (settled) return; // Guard.
            settled = true; // Marca.
            clearTimeout(t); // Limpia.
            console.error('[ESL] connection error', err); // Log.
            setConn(null); // Limpia cache.
            reject(err); // Propaga.
        }); // Fin error.
    }); // Fin promesa.
} // Fin connect.

module.exports = { connect }; // Exporta.
