'use strict'; // Modo estricto.

function getConfig() { // Lee config ESL desde ENV.
    return { // Devuelve configuración.
        host: process.env.ESL_HOST || '127.0.0.1', // Host FS.
        port: Number(process.env.ESL_PORT || 8021), // Puerto FS.
        pass: process.env.ESL_PASS || 'ClueCon', // Password.
        gateway: process.env.ESL_GATEWAY || 'evertel', // Gateway.
        apiTimeoutMs: Number(process.env.ESL_API_TIMEOUT_MS || 15000), // Timeout API.
    }; // Fin config.
} // Fin getConfig.

module.exports = { getConfig }; // Export.
