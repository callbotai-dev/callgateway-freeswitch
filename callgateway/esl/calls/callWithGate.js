'use strict'; // Modo estricto.

const { originate } = require('./originate'); // Origina llamada.
const { hangup } = require('./hangup'); // Cuelga llamada.
const { waitForAnswerOrHangup } = require('./waitForAnswerOrHangup'); // Espera ANSWER/HANGUP.
const { waitForHangup } = require('./waitForHangup'); // Monitor de hangup tras ANSWER.
const { connect } = require('../connection/connect'); // Conexión ESL.
const { postCallResult } = require('../webhooks/postCallResult'); // Envía evento final.
const { playWavList } = require('../playback/playWavList'); // Reproduce WAVs.
const { detectSpeechInWav } = require('../audio/detectSpeechInWav'); // Detecta señal en WAV.

/**
 * Gate: limita ring y solo devuelve answered si hubo ANSWER real.
 * @param {string} toE164 - Destino.
 * @param {object} opts - Opciones.
 * @returns {Promise<{status:string, ms:number, meta:object, monitor?:Promise<any>}>}
 */
async function callWithGate(toE164, opts = {}) { // Función principal.
    const t0 = Date.now(); // Inicio.
    const ringTimeoutSec = Number(opts.ringTimeoutSec ?? process.env.GATE_RING_TIMEOUT_SEC ?? 12); // Timeout ring.
    const answerTimeoutMs = Number(opts.answerTimeoutMs ?? process.env.GATE_ANSWER_TIMEOUT_MS ?? ((ringTimeoutSec + 2) * 1000)); // Timeout espera answer.
    const inCallTimeoutMs = Number(opts.inCallTimeoutMs ?? process.env.GATE_INCALL_TIMEOUT_MS ?? 60000); // Timeout llamada activa.

    let uuid = ''; // UUID del canal.

    try { // Intenta originar.
        const sessionId =
            opts?.session_id ??
            opts?.sessionId ??
            opts?.meta?.session_id ??
            opts?.meta?.sessionId ??
            null; // Busca session_id en payload.

        const sid = String(sessionId || ''); // Normaliza session_id.
        if (!sid) throw new Error('Missing session_id'); // Exige session_id.

        uuid = await originate(toE164, { // Lanza originate.
            originate_timeout: String(ringTimeoutSec), // Timeout de ring.
            origination_export_vars: 'callgateway_session_id', // Exporta variable al canal.
            callgateway_session_id: sid, // Valor exportado.
        });
    } catch (e) { // Manejo errores originate.
        const msg = String(e?.message || e); // Mensaje error.
        const ms = Date.now() - t0; // Duración.
        if (msg.includes('NO_ANSWER')) return { status: 'no_answer', ms, meta: { reason: 'originate_no_answer' } }; // No answer.
        if (msg.includes('USER_BUSY') || msg.includes('CALL_REJECTED')) return { status: 'busy', ms, meta: { reason: msg } }; // Busy o rechazo.
        return { status: 'error', ms, meta: { reason: `originate_failed: ${msg}` } }; // Error genérico.
    }

    console.log('[ESL] gate started', { uuid, ringTimeoutSec, answerTimeoutMs, inCallTimeoutMs }); // Log.

    let r = { status: 'error', meta: { reason: 'wait_failed' } }; // Estado por defecto.

    try { // Espera answer o hangup.
        r = await waitForAnswerOrHangup(uuid, answerTimeoutMs); // Espera eventos.
    } catch (e) { // Error waiter.
        r = { status: 'hangup', meta: { hangup_cause: 'WAIT_EXCEPTION', reason: String(e?.message || e) } }; // Normaliza.
    }

    const ms = Date.now() - t0; // Duración total.
    const sawAnswerEvent = Boolean(r?.meta?.sawAnswerEvent); // Flag answer.

    if (r.status === 'answered') { // Si contestó.
        console.log('[ESL] ANSWER => ORCHESTRATOR', { uuid }); // Log.

        const c = await connect(); // Abre conexión ESL antes de consultar vars o reproducir.
        const apiAsync = (cmd) => new Promise((resolve, reject) => { // Wrapper async.
            c.api(cmd, (res) => { // Ejecuta comando API.
                const body = String(res?.getBody?.() || ''); // Lee body.
                if (body.startsWith('-ERR')) return reject(new Error(body)); // Rechaza en error.
                resolve(body); // Resuelve en OK.
            });
        });

        const inspectVar = async (name) => { // Lee una variable concreta del canal en FS.
            try { // Protege lectura para no romper la llamada.
                const value = await apiAsync(`uuid_getvar ${uuid} ${name}`); // Pide valor a FreeSWITCH.
                return String(value || '').trim(); // Normaliza salida.
            } catch {
                return ''; // Si falla, devolvemos vacío.
            }
        };

        console.log('[ESL] channel vars', { // Traza para descubrir el leg correcto.
            uuid, // Canal actual.
            call_uuid: await inspectVar('uuid'), // UUID propio.
            bridge_uuid: await inspectVar('bridge_uuid'), // UUID del otro leg si existe.
            signal_bond: await inspectVar('signal_bond'), // Relación interna entre legs.
            call_direction: await inspectVar('call_direction'), // Dirección del canal.
            endpoint_disposition: await inspectVar('endpoint_disposition'), // Estado endpoint.
            current_application: await inspectVar('current_application'), // App actual en FS.
            read_codec: await inspectVar('read_codec'), // Codec entrada.
            write_codec: await inspectVar('write_codec'), // Codec salida.
        });

        const session_id = String(opts?.session_id || '').trim() || (() => apiAsync(`uuid_getvar ${uuid} callgateway_session_id`))(); // Obtiene session_id.
        const sidRaw = typeof session_id === 'string' ? session_id : await session_id; // Resuelve promise si hace falta.
        const sid = sidRaw && sidRaw !== '_undef_' ? String(sidRaw).trim() : ''; // Normaliza sid.
        if (!sid) throw new Error('Missing session_id'); // Guarda seguridad.

        const campaign_id = Number(opts?.meta?.campaign_id ?? NaN); // Lee campaign_id.
        if (!Number.isFinite(campaign_id)) throw new Error('Missing meta.campaign_id in /dial payload'); // Guarda seguridad.

        await apiAsync(`uuid_setvar ${uuid} effective_caller_id_number ${uuid}`); // Caller ID number.
        await apiAsync(`uuid_setvar ${uuid} effective_caller_id_name CGW`); // Caller ID name.

        const orchRes = await fetch('http://127.0.0.1:3001/start', { // Llama start del orchestrator.
            method: 'POST', // POST.
            headers: { 'Content-Type': 'application/json' }, // JSON.
            body: JSON.stringify({
                campaign_id, // Campaign.
                session_id: sid, // Session.
                uuid, // UUID canal.
                dynamic_variables: opts?.dynamic_variables ?? {}, // Variables dinámicas.
            }),
        });

        if (!orchRes.ok) throw new Error(`Orchestrator HTTP ${orchRes.status}`); // Exige 200.
        const orch = await orchRes.json(); // Parse JSON.
        if (!orch?.wav_path) throw new Error('Orchestrator missing wav_path'); // Exige wav inicial.

        const playedList = await playWavList({ // Reproduce saludo/respuesta inicial.
            apiAsync, // Reutiliza ESL.
            uuid, // UUID canal.
            wavPath: orch?.wav_path, // Compat legacy.
            wavPaths: orch?.wav_paths, // Compat múltiple.
        });

        console.log('[ESL] playWavList OK', { uuid, wavs: playedList }); // Log reproducción.

        const enableBidirectional = String(process.env.CGW_ENABLE_BIDIRECTIONAL || '0') === '1'; // Flag bidireccional.

        if (!enableBidirectional) { // Si no está activado.
            const monitor = waitForHangup(uuid, inCallTimeoutMs); // Monitor clásico.

            monitor
                .then((h) => postCallResult({ // Reporta fin correcto.
                    status: 'hangup_complete', // Estado.
                    uuid, // UUID.
                    session_id: sid, // Session.
                    campaign_id, // Campaign.
                    meta: { ...h }, // Meta.
                }))
                .catch((e) => postCallResult({ // Reporta error monitor.
                    status: 'hangup_monitor_error', // Estado error.
                    uuid, // UUID.
                    session_id: sid, // Session.
                    campaign_id, // Campaign.
                    meta: { error: String(e?.message || e) }, // Error.
                }));

            return { status: 'answered', ms, meta: { uuid, sawAnswerEvent }, monitor }; // Flujo actual.
        }

        console.log('[ESL] bidirectional mode enabled', { uuid, session_id: sid, campaign_id }); // Log bidireccional.

        let isActive = true; // Estado del loop.
        const bidirectionalStartedAt = Date.now(); // Inicio del modo bidireccional.
        const maxBidirectionalMs = Number(process.env.CGW_BIDIRECTIONAL_MAX_MS || inCallTimeoutMs); // Límite máximo.
        const recordFile = `/var/lib/freeswitch/recordings/cgw/cgw_${uuid}.wav`; // WAV persistente y verificable.

        const monitor = waitForHangup(uuid, inCallTimeoutMs) // Monitor paralelo.
            .then((h) => { // Al colgar.
                isActive = false; // Para loop.
                return h; // Mantiene resultado.
            })
            .catch((e) => { // Si falla monitor.
                isActive = false; // Para loop.
                throw e; // Repropaga.
            });

        try { // Arranca grabación inicial.
            await apiAsync(`uuid_record ${uuid} start ${recordFile}`); // Empieza a grabar con método validado manualmente.
            console.log('[ESL] recording started', { uuid, recordFile }); // Log.
        } catch (e) { // Si falla grabación inicial.
            console.error('[ESL] recording start error', { uuid, error: String(e?.message || e) }); // Error.
        }

        (async () => { // Loop en segundo plano.
            try { // Protección loop.
                while (isActive) { // Mientras siga activa.
                    if ((Date.now() - bidirectionalStartedAt) >= maxBidirectionalMs) { // Si excede tiempo máximo.
                        isActive = false; // Cierra loop.
                        console.log('[ESL] bidirectional loop timeout', { uuid, maxBidirectionalMs }); // Log timeout.
                        break; // Sale.
                    }

                    try { // Analiza WAV.
                        const result = await detectSpeechInWav(recordFile); // Detecta señal.
                        console.log('[VAD]', { uuid, speech: result.speech, rms: result.rms }); // Log VAD.
                    } catch (e) { // Si falla análisis.
                        console.error('[VAD] error', { uuid, error: String(e?.message || e) }); // Log error.
                    }

                    if (!isActive) break; // Evita reiniciar grabación si ya terminó.

                    console.log('[ESL] loop tick', { uuid, recordFile }); // Log iteración.
                }
            } catch (e) { // Error del loop.
                console.error('[ESL] bidirectional loop error', { uuid, error: String(e?.message || e) }); // Log.
            } finally { // Limpieza final.
                try { // Intenta parar grabación final.
                    await apiAsync(`uuid_record ${uuid} stop ${recordFile}`); // Stop final del mismo archivo.
                    console.log('[ESL] recording stopped', { uuid, recordFile }); // Log.
                } catch (e) { // Si falla.
                    console.error('[ESL] recording stop error', { uuid, error: String(e?.message || e) }); // Log.
                }
            }
        })();

        return { status: 'answered', ms, meta: { uuid, sawAnswerEvent, bidirectional: true }, monitor }; // Devuelve answered.
    }

    if (r.status === 'hangup') { // Si colgó antes de answer.
        return { status: 'no_answer', ms, meta: { uuid, sawAnswerEvent, reason: 'hangup_before_answer', ...r.meta } }; // Normaliza.
    }

    await hangup(uuid).catch(() => { }); // Limpieza best-effort.
    return { status: 'no_answer', ms, meta: { uuid, sawAnswerEvent, reason: 'no_answer_timeout' } }; // Timeout final.
}

module.exports = { callWithGate }; // Exporta función.