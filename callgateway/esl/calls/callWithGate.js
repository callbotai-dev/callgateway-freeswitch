'use strict'; // Activa modo estricto.

const { originate } = require('./originate'); // Origina llamada saliente.
const { hangup } = require('./hangup'); // Cuelga llamada por UUID.
const { waitForAnswerOrHangup } = require('./waitForAnswerOrHangup'); // Espera ANSWER o HANGUP.
const { waitForHangup } = require('./waitForHangup'); // Monitoriza hangup tras ANSWER.
const { connect } = require('../connection/connect'); // Abre conexión ESL.
const { postCallResult } = require('../webhooks/postCallResult'); // Reporta resultado final.
const { playWavList } = require('../playback/playWavList'); // Reproduce WAVs en el canal.
const { setTimeout: sleep } = require('node:timers/promises'); // Pausa async controlada.
const { createApiAsync, inspectChannelVars, runBidirectionalSession } = require('./bidirectional'); // Helpers modulares bidireccionales.

/**
 * Gate: limita ring y solo devuelve answered si hubo ANSWER real.
 * @param {string} toE164 - Destino en formato E.164.
 * @param {object} opts - Opciones de llamada.
 * @returns {Promise<{status:string, ms:number, meta:object, monitor?:Promise<any>}>}
 */
async function callWithGate(toE164, opts = {}) { // Función principal.
    const t0 = Date.now(); // Guarda inicio para medir duración total.
    const ringTimeoutSec = Number(opts.ringTimeoutSec ?? process.env.GATE_RING_TIMEOUT_SEC ?? 12); // Timeout de ring.
    const answerTimeoutMs = Number(opts.answerTimeoutMs ?? process.env.GATE_ANSWER_TIMEOUT_MS ?? ((ringTimeoutSec + 2) * 1000)); // Timeout de espera ANSWER.
    const inCallTimeoutMs = Number(opts.inCallTimeoutMs ?? process.env.GATE_INCALL_TIMEOUT_MS ?? 60000); // Timeout de llamada activa.

    let uuid = ''; // UUID inicial vacío.

    try { // Bloque de originate.
        const sessionId = opts?.session_id ?? opts?.sessionId ?? opts?.meta?.session_id ?? opts?.meta?.sessionId ?? null; // Busca session_id.
        const sid = String(sessionId || ''); // Normaliza session_id.
        if (!sid) throw new Error('Missing session_id'); // Exige session_id.

        uuid = await originate(toE164, { // Lanza llamada.
            originate_timeout: String(ringTimeoutSec), // Pasa timeout de ring.
            origination_export_vars: 'callgateway_session_id', // Exporta variable al canal.
            callgateway_session_id: sid, // Valor exportado.
        }); // Recibe UUID del canal.
    } catch (e) { // Maneja error de originate.
        const msg = String(e?.message || e); // Normaliza error.
        const ms = Date.now() - t0; // Calcula duración parcial.
        if (msg.includes('NO_ANSWER')) return { status: 'no_answer', ms, meta: { reason: 'originate_no_answer' } }; // Devuelve no_answer.
        if (msg.includes('USER_BUSY') || msg.includes('CALL_REJECTED')) return { status: 'busy', ms, meta: { reason: msg } }; // Devuelve busy/rejected.
        return { status: 'error', ms, meta: { reason: `originate_failed: ${msg}` } }; // Devuelve error genérico.
    }

    console.log('[ESL] gate started', { uuid, ringTimeoutSec, answerTimeoutMs, inCallTimeoutMs }); // Log inicio gate.

    let r = { status: 'error', meta: { reason: 'wait_failed' } }; // Estado por defecto.

    try { // Espera ANSWER o HANGUP.
        r = await waitForAnswerOrHangup(uuid, answerTimeoutMs); // Espera eventos del canal.
    } catch (e) { // Captura error waiter.
        r = { status: 'hangup', meta: { hangup_cause: 'WAIT_EXCEPTION', reason: String(e?.message || e) } }; // Normaliza error.
    }

    const ms = Date.now() - t0; // Duración total hasta aquí.
    const sawAnswerEvent = Boolean(r?.meta?.sawAnswerEvent); // Marca si hubo ANSWER real.

    if (r.status === 'answered') { // Solo si realmente contestó.
        console.log('[ESL] ANSWER => ORCHESTRATOR', { uuid }); // Log paso a conversación.

        const c = await connect(); // Abre conexión ESL para esta llamada.
        const apiAsync = createApiAsync(c); // Crea wrapper async ESL API.

        console.log('[ESL] channel vars', await inspectChannelVars({ uuid, apiAsync })); // Log variables útiles del canal.

        const session_id = String(opts?.session_id || '').trim() || (() => apiAsync(`uuid_getvar ${uuid} callgateway_session_id`))(); // Resuelve session_id.
        const sidRaw = typeof session_id === 'string' ? session_id : await session_id; // Espera promesa si aplica.
        const sid = sidRaw && sidRaw !== '_undef_' ? String(sidRaw).trim() : ''; // Normaliza session_id final.
        if (!sid) throw new Error('Missing session_id'); // Exige session_id válido.

        const campaign_id = Number(opts?.meta?.campaign_id ?? NaN); // Lee campaign_id.
        if (!Number.isFinite(campaign_id)) throw new Error('Missing meta.campaign_id in /dial payload'); // Exige campaign_id.

        await apiAsync(`uuid_setvar ${uuid} effective_caller_id_number ${uuid}`); // Ajusta caller ID number.
        await apiAsync(`uuid_setvar ${uuid} effective_caller_id_name CGW`); // Ajusta caller ID name.

        const orchRes = await fetch('http://127.0.0.1:3001/start', { // Llama /start del Orchestrator.
            method: 'POST', // Usa POST.
            headers: { 'Content-Type': 'application/json' }, // Envía JSON.
            body: JSON.stringify({ // Construye payload.
                campaign_id, // Envía campaña.
                session_id: sid, // Envía sesión.
                uuid, // Envía UUID.
                dynamic_variables: opts?.dynamic_variables ?? {}, // Envía variables dinámicas.
            }), // Fin payload.
        });

        if (!orchRes.ok) throw new Error(`Orchestrator HTTP ${orchRes.status}`); // Exige HTTP OK.
        const orch = await orchRes.json(); // Parsea respuesta.
        if (!orch?.wav_path && !(Array.isArray(orch?.wav_paths) && orch.wav_paths.length)) throw new Error('Orchestrator missing wav_path(s)'); // Exige audio inicial.

        const playedList = await playWavList({ // Reproduce audio inicial.
            apiAsync, // Reutiliza ESL.
            uuid, // Canal destino.
            wavPath: orch?.wav_path, // WAV único.
            wavPaths: orch?.wav_paths, // Lista de WAVs.
        });

        console.log('[ESL] playWavList OK', { uuid, wavs: playedList }); // Log reproducción inicial.

        const enableBidirectional = String(process.env.CGW_ENABLE_BIDIRECTIONAL || '0') === '1'; // Comprueba flag bidireccional.

        if (!enableBidirectional) { // Flujo clásico sin bidireccional.
            const monitor = waitForHangup(uuid, inCallTimeoutMs); // Crea monitor de hangup.

            monitor // Encadena reporte final.
                .then((h) => postCallResult({ // Reporta fin correcto.
                    status: 'hangup_complete', // Estado correcto.
                    uuid, // UUID.
                    session_id: sid, // Sesión.
                    campaign_id, // Campaña.
                    meta: { ...h }, // Meta monitor.
                }))
                .catch((e) => postCallResult({ // Reporta error monitor.
                    status: 'hangup_monitor_error', // Estado error.
                    uuid, // UUID.
                    session_id: sid, // Sesión.
                    campaign_id, // Campaña.
                    meta: { error: String(e?.message || e) }, // Error normalizado.
                }));

            return { status: 'answered', ms, meta: { uuid, sawAnswerEvent }, monitor }; // Devuelve flujo clásico.
        }

        console.log('[ESL] bidirectional mode enabled', { uuid, session_id: sid, campaign_id }); // Log activación bidireccional.

        const monitor = waitForHangup(uuid, inCallTimeoutMs); // Crea monitor paralelo para sesión bidireccional.

        runBidirectionalSession({ // Lanza sesión base estable.
            uuid, // UUID del canal.
            apiAsync, // Wrapper ESL API.
            sleep, // Pausa async.
            detectSpeechInWav: require('../audio/detectSpeechInWav').detectSpeechInWav, // Detector incremental WAV.
            inCallTimeoutMs, // Timeout de llamada activa.
            monitor, // Monitor de hangup.
        }).catch((e) => { // Captura error no controlado de la sesión.
            console.error('[ESL] bidirectional session error', { uuid, error: String(e?.message || e) }); // Log error.
        });

        return { status: 'answered', ms, meta: { uuid, sawAnswerEvent, bidirectional: true }, monitor }; // Devuelve answered bidireccional.
    }

    if (r.status === 'hangup') { // Si colgó antes de contestar.
        return { status: 'no_answer', ms, meta: { uuid, sawAnswerEvent, reason: 'hangup_before_answer', ...r.meta } }; // Normaliza no_answer.
    }

    await hangup(uuid).catch(() => { }); // Limpieza best-effort.
    return { status: 'no_answer', ms, meta: { uuid, sawAnswerEvent, reason: 'no_answer_timeout' } }; // Timeout final.
}

module.exports = { callWithGate }; // Exporta función.