'use strict'; // Modo estricto.

require('dotenv').config(); // Carga .env.

process.on('unhandledRejection', (e) => console.error('[TEST] unhandledRejection', e)); // Log promesas.
process.on('uncaughtException', (e) => console.error('[TEST] uncaughtException', e)); // Log crashes.

const { ping, originate, hangup, disconnect } = require('./esl'); // API ESL.

(async () => { // IIFE async.
    console.log('[TEST] start'); // Marca inicio.
    console.log('[TEST] env', { ESL_HOST: process.env.ESL_HOST, ESL_PORT: process.env.ESL_PORT, ESL_GATEWAY: process.env.ESL_GATEWAY }); // Env.

    const kill = setTimeout(() => { console.error('[TEST] HARD TIMEOUT'); disconnect(); process.exit(1); }, 20000); // Corta si se cuelga.

    try { // Flujo.
        console.log('[TEST] ping...'); // Paso ping.
        const v = await ping(); // Versión.
        console.log('[TEST] version =', v); // Log versión.

        const to = process.argv[2] || '+34600000000'; // Destino.
        console.log('[TEST] originate...', to); // Paso originate.
        const uuid = await originate(to, {}); // Origina.
        console.log('[TEST] uuid =', uuid); // Log uuid.

        await new Promise(r => setTimeout(r, 3000)); // Espera.
        console.log('[TEST] hangup...', uuid); // Paso hangup.
        await hangup(uuid); // Cuelga.
        console.log('[TEST] hangup ok'); // OK.
    } catch (e) { // Error.
        console.error('[TEST] error', e); // Log error.
    } finally { // Siempre.
        clearTimeout(kill); // Limpia timeout.
        disconnect(); // Cierra ESL.
        console.log('[TEST] end'); // Fin.
    }
})(); // Ejecuta.
