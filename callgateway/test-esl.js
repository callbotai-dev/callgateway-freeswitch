// callgateway/test-esl.js
'use strict'; // Modo estricto.

require('dotenv').config(); // Carga .env.

process.on('unhandledRejection', (e) => console.error('[TEST] unhandledRejection', e)); // Log promesas no manejadas.
process.on('uncaughtException', (e) => console.error('[TEST] uncaughtException', e)); // Log crashes.

const { ping, hangup, disconnect, callWithGate } = require('./esl'); // Importa API.

(async () => { // Main async.
    const t0 = Date.now(); // Inicio.
    const since = () => `${Date.now() - t0}ms`; // Delta.
    const log = (msg, extra) => console.log(`[TEST][+${since()}] ${msg}`, extra ?? ''); // Logger.

    const HARD_TIMEOUT_MS = 90000; // Corte global.
    const hard = setTimeout(() => { // Watchdog.
        console.error(`[TEST][+${since()}] HARD TIMEOUT`); // Log.
        try { disconnect(); } catch (_) { } // Cierra.
        process.exit(1); // Sale.
    }, HARD_TIMEOUT_MS); // Aplica.
    hard.unref?.(); // No bloquea salida si todo terminó.

    try { // Try.
        log('start'); // Start.
        log('env', { // Log env.
            ESL_HOST: process.env.ESL_HOST, // Host.
            ESL_PORT: process.env.ESL_PORT, // Puerto.
            ESL_GATEWAY: process.env.ESL_GATEWAY, // Gateway.
        }); // Fin env.

        log('ping...'); // Ping.
        const v = await ping(); // Version.
        log('version =', v); // Log.

        const to = process.argv[2] || '+34600000000'; // Destino.
        log('callWithGate...', to); // Log.

        const r = await callWithGate(to, { // Ejecuta gate.
            ringTimeoutSec: 22, // ≈ 4 tonos.
            answerTimeoutMs: 24000, // Espera ANSWER.
            inCallTimeoutMs: 30000, // Monitor corto en test.
        }); // Fin callWithGate.

        log('gate result =', r); // Resultado.

        if (r.status === 'answered') { // Si contestó.
            log('IN_CALL NOW => (aquí harías handoff a ElevenLabs)', r.meta); // Punto de handoff.

            // await new Promise((res) => setTimeout(res, 2000)); // Simula “handoff” corto.
            // await hangup(r.meta.uuid).catch(() => { }); // Para test: cuelga siempre (evita quedarse vivo).
            const moni = await r.monitor; // Espera hangup real (se mantiene en llamada).
            log('monitor =', moni); // Log.


            const mon = await Promise.race([ // Espera monitor o timeout.
                r.monitor, // Monitor real.
                new Promise((res) => setTimeout(() => res({ status: 'monitor_timeout' }), 5000)), // Timeout.
            ]); // Fin race.

            log('monitor =', mon); // Log monitor.
        } // Fin answered.
    } catch (e) { // Catch.
        console.error(`[TEST][+${since()}] error`, e); // Log.
    } finally { // Siempre.
        clearTimeout(hard); // Limpia watchdog.
        try { disconnect(); } catch (_) { } // Cierra ESL.
        log('end'); // End.
        process.exit(0); // Garantiza salida limpia del test.
    } // Fin finally.
})(); // Ejecuta.
