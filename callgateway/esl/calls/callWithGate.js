'use strict'; // Modo estricto.

const { originate } = require('./originate'); // Origina llamada.
const { hangup } = require('./hangup'); // Cuelga llamada.
const { waitForAnswerOrHangup } = require('./waitForAnswerOrHangup'); // Espera ANSWER/HANGUP.
const { waitForHangup } = require('./waitForHangup'); // Monitor de hangup tras ANSWER.
const { connect } = require('../connection/connect'); // Conexión ESL (ruta real).
const { postCallResult } = require('../webhooks/postCallResult'); // Envía evento a n8n.
const { playWavList } = require('../playback/playWavList'); // Reproduce uno o varios WAVs en orden.


/**
 * Gate: limita ring (4-5 tonos aprox) y SOLO si ANSWER humano devuelve answered.
 * @param {string} toE164 - Destino (E.164 o similar).
 * @param {object} opts - Opciones.
 * @returns {Promise<{status:string, ms:number, meta:object, monitor?:Promise<any>}>} Resultado.
 */
async function callWithGate(toE164, opts = {}) { // Función principal.
    const t0 = Date.now(); // Timestamp inicio.
    const ringTimeoutSec = Number(opts.ringTimeoutSec ?? process.env.GATE_RING_TIMEOUT_SEC ?? 12); // Segundos máx ring.
    const answerTimeoutMs = Number(opts.answerTimeoutMs ?? process.env.GATE_ANSWER_TIMEOUT_MS ?? ((ringTimeoutSec + 2) * 1000)); // Ventana espera.
    const inCallTimeoutMs = Number(opts.inCallTimeoutMs ?? process.env.GATE_INCALL_TIMEOUT_MS ?? 60000); // Timeout post-ANSWER.

    let uuid = ''; // UUID canal.
    try { // Originate.
        const sessionId =
            opts?.session_id ??
            opts?.sessionId ??
            opts?.meta?.session_id ??
            opts?.meta?.sessionId ??
            null;

        const sid = String(sessionId || '');
        if (!sid) throw new Error('Missing session_id');

        uuid = await originate(toE164, {
            originate_timeout: String(ringTimeoutSec),

            // 🔑 CLAVE
            origination_export_vars: 'callgateway_session_id',
            callgateway_session_id: sid,
        });
    } catch (e) { // Errores originate.
        const msg = String(e?.message || e); // Mensaje.
        const ms = Date.now() - t0; // Duración.
        if (msg.includes('NO_ANSWER')) return { status: 'no_answer', ms, meta: { reason: 'originate_no_answer' } }; // No contestó.
        if (msg.includes('USER_BUSY') || msg.includes('CALL_REJECTED')) return { status: 'busy', ms, meta: { reason: msg } }; // Busy/rechazo.
        return { status: 'error', ms, meta: { reason: `originate_failed: ${msg}` } }; // Otro.
    } // Fin originate.

    console.log('[ESL] gate started', { uuid, ringTimeoutSec, answerTimeoutMs, inCallTimeoutMs }); // Log.

    let r = { status: 'error', meta: { reason: 'wait_failed' } }; // Default.
    try { // Espera.
        r = await waitForAnswerOrHangup(uuid, answerTimeoutMs); // Espera eventos.
    } catch (e) { // Excepción waiter.
        r = { status: 'hangup', meta: { hangup_cause: 'WAIT_EXCEPTION', reason: String(e?.message || e) } }; // Normaliza.
    } // Fin wait.

    const ms = Date.now() - t0; // Duración.
    const sawAnswerEvent = Boolean(r?.meta?.sawAnswerEvent); // Flag.

    if (r.status === 'answered') { // 1 Contestó.
        console.log('[ESL] ANSWER => ORCHESTRATOR', { uuid }); // 2 Log.

        const c = await connect(); // 3 Conexión ESL.
        const apiAsync = (cmd) => new Promise((resolve, reject) => { // 4 Wrapper async.
            c.api(cmd, (res) => { // 5 Ejecuta comando ESL.
                const body = String(res?.getBody?.() || ''); // 6 Lee respuesta.
                if (body.startsWith('-ERR')) return reject(new Error(body)); // 7 Error FS.
                resolve(body); // 8 OK.
            });
        });

        // 9 session_id: preferimos payload /dial, fallback a var del canal.
        const session_id = String(opts?.session_id || '').trim() // 10 Desde /dial.
            || (() => { // 11 Fallback (canal).
                const sidRawP = apiAsync(`uuid_getvar ${uuid} callgateway_session_id`); // 12 Pide var.
                return sidRawP; // 13 Devuelve promise (se resuelve abajo).
            })();

        const sidRaw = typeof session_id === 'string' ? session_id : await session_id; // 14 Resuelve si era promise.
        const sid = sidRaw && sidRaw !== '_undef_' ? String(sidRaw).trim() : ''; // 15 Normaliza.
        if (!sid) throw new Error('Missing session_id'); // 16 Guard.

        // 17 campaign_id viene en /dial.meta.campaign_id (NO del canal).
        const campaign_id = Number(opts?.meta?.campaign_id ?? NaN); // 18 Lee meta.
        if (!Number.isFinite(campaign_id)) throw new Error('Missing meta.campaign_id in /dial payload'); // 19 Guard.

        // 20 (Opcional) CallerID = UUID (trazas)
        await apiAsync(`uuid_setvar ${uuid} effective_caller_id_number ${uuid}`); // 21 UUID en caller_id.
        await apiAsync(`uuid_setvar ${uuid} effective_caller_id_name CGW`); // 22 Nombre fijo.

        // 23 Llama al Orchestrator interno
        const orchRes = await fetch('http://127.0.0.1:3001/start', { // 24 URL interna.
            method: 'POST', // 25 POST.
            headers: { 'Content-Type': 'application/json' }, // 26 JSON.
            body: JSON.stringify({
                campaign_id,
                session_id: sid,
                uuid,
                dynamic_variables: opts?.dynamic_variables ?? {},
            }),
        });

        if (!orchRes.ok) throw new Error(`Orchestrator HTTP ${orchRes.status}`); // 28 Guard.
        const orch = await orchRes.json(); // 29 JSON respuesta.
        if (!orch?.wav_path) throw new Error('Orchestrator missing wav_path'); // 30 Guard.

        // 31 Reproduce uno o varios WAVs en orden sin romper compatibilidad.
        const playedList = await playWavList({
            // 32 Reutiliza el wrapper ESL ya abierto en este flujo.
            apiAsync,
            // 33 UUID del canal actual en FreeSWITCH.
            uuid,
            // 34 Ruta única legacy para compatibilidad.
            wavPath: orch?.wav_path,
            // 35 Lista nueva de WAVs si el orchestrator la devuelve.
            wavPaths: orch?.wav_paths,
        });

        // 36 Log con la lista realmente reproducida.
        console.log('[ESL] playWavList OK', { uuid, wavs: playedList });

        const enableBidirectional = String(process.env.CGW_ENABLE_BIDIRECTIONAL || '0') === '1'; // Lee flag desde ENV y lo convierte a booleano seguro.

        if (!enableBidirectional) { // Si la fase bidireccional está desactivada, mantenemos el comportamiento actual intacto.
            const monitor = waitForHangup(uuid, inCallTimeoutMs); // Inicia el monitor de colgado como hasta ahora.

            monitor
                .then((h) => postCallResult({ // Si la llamada termina correctamente, enviamos resultado final.
                    status: 'hangup_complete', // Estado final normal.
                    uuid, // UUID del canal FreeSWITCH.
                    session_id: sid, // ID de sesión de negocio.
                    campaign_id, // ID de campaña.
                    meta: { ...h }, // Metadatos de colgado recibidos del monitor.
                }))
                .catch((e) => postCallResult({ // Si falla el monitor, enviamos error controlado.
                    status: 'hangup_monitor_error', // Estado de error del monitor.
                    uuid, // UUID del canal FreeSWITCH.
                    session_id: sid, // ID de sesión de negocio.
                    campaign_id, // ID de campaña.
                    meta: { error: String(e?.message || e) }, // Normaliza el mensaje de error.
                }));

            return { status: 'answered', ms, meta: { uuid, sawAnswerEvent }, monitor }; // Devuelve exactamente el flujo actual sin romper nada.
        } // Fin del modo compatible.

        if (enableBidirectional) { // Activamos modo bidireccional controlado.
            console.log('[ESL] bidirectional mode enabled', { uuid, session_id: sid, campaign_id }); // Log.

            let isActive = true; // Estado vivo del loop bidireccional.
            const bidirectionalStartedAt = Date.now(); // Marca inicio del modo bidireccional.
            const maxBidirectionalMs = Number(process.env.CGW_BIDIRECTIONAL_MAX_MS || inCallTimeoutMs); // Límite duro para no dejar loops colgados.

            const monitor = waitForHangup(uuid, inCallTimeoutMs) // Monitor de hangup paralelo.
                .then(() => { isActive = false; }) // Si cuelga, paramos loop.
                .catch(() => { isActive = false; }); // Seguridad.
            const recordFile = `/tmp/cgw_${uuid}.wav`; // Ruta temporal para grabar audio del cliente.

            try {
                await apiAsync(`uuid_record ${uuid} start ${recordFile}`); // Empieza grabación del canal en FS.
                console.log('[ESL] recording started', { uuid, recordFile }); // Log.
            } catch (e) {
                console.error('[ESL] recording start error', { uuid, error: String(e?.message || e) }); // No rompemos flujo.
            }
            (async () => { // Ejecuta el loop bidireccional en segundo plano.
                try { // Protege el loop para no tumbar la llamada por un error interno.
                    while (isActive) { // Mantiene vivo el loop mientras la llamada siga activa.
                        if ((Date.now() - bidirectionalStartedAt) >= maxBidirectionalMs) { // Comprueba si se alcanzó el tiempo máximo.
                            isActive = false; // Marca el loop como finalizado.
                            console.log('[ESL] bidirectional loop timeout', { uuid, maxBidirectionalMs }); // Deja traza del cierre por tiempo.
                            break; // Sale del bucle.
                        } // Fin del control de tiempo máximo.

                        await apiAsync(`uuid_record ${uuid} stop ${recordFile}`); // Corta grabación para tener WAV válido.

                        await new Promise((resolve) => setTimeout(resolve, 200)); // Pequeño delay para asegurar escritura en disco.

                        await apiAsync(`uuid_record ${uuid} start ${recordFile}`); // Reinicia grabación para siguiente turno.
                        try {
                            const res = await fetch('http://127.0.0.1:3001/input', { // Llamada al Orchestrator.
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                    session_id: sid, // ID de sesión.
                                    uuid, // Canal FS.
                                    audio_path: recordFile, // Audio grabado.
                                }),
                            });

                            if (!res.ok) throw new Error(`HTTP ${res.status}`); // Control error HTTP.

                            const data = await res.json(); // Parseo respuesta.
                            console.log('[ESL] orchestrator input OK', { uuid, data }); // Log.

                        } catch (e) {
                            console.error('[ESL] orchestrator input error', { uuid, error: String(e?.message || e) });
                        }
                        console.log('[ESL] loop tick', { uuid, recordFile }); // Deja traza del loop incluyendo el fichero grabado.
                    } // Fin del while.
                } catch (e) { // Captura cualquier error dentro del loop.
                    console.error('[ESL] bidirectional loop error', { uuid, error: String(e?.message || e) }); // Registra el error sin romper el proceso principal.
                } finally { // Ejecuta limpieza siempre al salir del loop.
                    try { // Intenta detener la grabación en FreeSWITCH.
                        await apiAsync(`uuid_record ${uuid} stop ${recordFile}`); // Para la grabación activa del canal.
                        console.log('[ESL] recording stopped', { uuid, recordFile }); // Deja traza de parada correcta.
                    } catch (e) { // Si falla la parada, no rompemos el flujo.
                        console.error('[ESL] recording stop error', { uuid, error: String(e?.message || e) }); // Registra el error de parada.
                    } // Fin del stop seguro.
                } // Fin del finally.
            })(); // Lanza el proceso asíncrono sin bloquear el retorno actual.

            return { status: 'answered', ms, meta: { uuid, sawAnswerEvent, bidirectional: true }, monitor }; // No rompe flujo.
        }

        const monitor = waitForHangup(uuid, inCallTimeoutMs); // 34 Monitor hangup.

        monitor
            .then((h) => postCallResult({ // Si cuelga ok.
                status: 'hangup_complete', // Estado final.
                uuid, // UUID FS.
                session_id: sid, // Session.
                campaign_id, // Campaign.
                meta: { ...h }, // Meta hangup.
            }))
            .catch((e) => postCallResult({ // Si falla monitor/timeout.
                status: 'hangup_monitor_error', // Error monitor.
                uuid,
                session_id: sid,
                campaign_id,
                meta: { error: String(e?.message || e) }, // Error.
            }));
        return { status: 'answered', ms, meta: { uuid, sawAnswerEvent }, monitor }; // 35 OK.
    }

    if (r.status === 'hangup') { // Colgó antes de ANSWER.
        return { status: 'no_answer', ms, meta: { uuid, sawAnswerEvent, reason: 'hangup_before_answer', ...r.meta } }; // Normaliza.
    } // Fin hangup.

    await hangup(uuid).catch(() => { }); // Limpieza best-effort.
    return { status: 'no_answer', ms, meta: { uuid, sawAnswerEvent, reason: 'no_answer_timeout' } }; // Timeout.
} // Fin callWithGate.


module.exports = { callWithGate }; // Export.
