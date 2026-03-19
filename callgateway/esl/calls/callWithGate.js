'use strict'; // Activa modo estricto para evitar errores silenciosos.

const { originate } = require('./originate'); // Importa la función que origina la llamada saliente.
const { hangup } = require('./hangup'); // Importa la función que cuelga una llamada por UUID.
const { waitForAnswerOrHangup } = require('./waitForAnswerOrHangup'); // Importa la espera de ANSWER o HANGUP antes de entrar en conversación.
const { waitForHangup } = require('./waitForHangup'); // Importa el monitor de colgado tras contestar.
const { connect } = require('../connection/connect'); // Importa la conexión ESL con FreeSWITCH.
const { postCallResult } = require('../webhooks/postCallResult'); // Importa el reporte final del resultado de llamada.
const { playWavList } = require('../playback/playWavList'); // Importa la reproducción de uno o varios WAV en el canal.
const { detectSpeechInWav } = require('../audio/detectSpeechInWav'); // Importa el detector incremental de voz sobre WAV en crecimiento.
const { cutWavSegment } = require('../audio/cutWavSegment'); // Importa el recorte de un segmento WAV a un fichero nuevo.
const { transcribeTurn } = require('../stt/transcribeTurn'); // Importa el adaptador STT del turno del cliente.

/**
 * Gate: limita ring y solo devuelve answered si hubo ANSWER real.
 * @param {string} toE164 - Destino en formato E.164.
 * @param {object} opts - Opciones de llamada.
 * @returns {Promise<{status:string, ms:number, meta:object, monitor?:Promise<any>}>}
 */
async function callWithGate(toE164, opts = {}) { // Define la función principal del flujo de llamada.
    const t0 = Date.now(); // Guarda el instante inicial para medir duración total.
    const ringTimeoutSec = Number(opts.ringTimeoutSec ?? process.env.GATE_RING_TIMEOUT_SEC ?? 12); // Calcula el timeout de ring en segundos.
    const answerTimeoutMs = Number(opts.answerTimeoutMs ?? process.env.GATE_ANSWER_TIMEOUT_MS ?? ((ringTimeoutSec + 2) * 1000)); // Calcula el timeout máximo para esperar ANSWER.
    const inCallTimeoutMs = Number(opts.inCallTimeoutMs ?? process.env.GATE_INCALL_TIMEOUT_MS ?? 60000); // Calcula el timeout máximo de llamada activa.

    let uuid = ''; // Inicializa el UUID del canal como vacío.

    try { // Intenta originar la llamada.
        const sessionId = // Resuelve el session_id desde las distintas posibles ubicaciones del payload.
            opts?.session_id ?? // Toma opts.session_id si existe.
            opts?.sessionId ?? // Toma opts.sessionId si existe.
            opts?.meta?.session_id ?? // Toma opts.meta.session_id si existe.
            opts?.meta?.sessionId ?? // Toma opts.meta.sessionId si existe.
            null; // Si no hay nada, deja null.

        const sid = String(sessionId || ''); // Normaliza el session_id a string.
        if (!sid) throw new Error('Missing session_id'); // Lanza error si no hay session_id válido.

        uuid = await originate(toE164, { // Llama al originate real.
            originate_timeout: String(ringTimeoutSec), // Pasa el timeout de ring a FreeSWITCH.
            origination_export_vars: 'callgateway_session_id', // Exporta la variable callgateway_session_id al canal.
            callgateway_session_id: sid, // Asigna el valor exportado de sesión.
        }); // Espera el UUID del canal creado.
    } catch (e) { // Captura cualquier error del originate.
        const msg = String(e?.message || e); // Normaliza el mensaje de error.
        const ms = Date.now() - t0; // Calcula la duración transcurrida.
        if (msg.includes('NO_ANSWER')) return { status: 'no_answer', ms, meta: { reason: 'originate_no_answer' } }; // Devuelve no_answer si el origen indica NO_ANSWER.
        if (msg.includes('USER_BUSY') || msg.includes('CALL_REJECTED')) return { status: 'busy', ms, meta: { reason: msg } }; // Devuelve busy si el destino está ocupado o rechaza.
        return { status: 'error', ms, meta: { reason: `originate_failed: ${msg}` } }; // Devuelve error genérico para el resto de fallos.
    }

    console.log('[ESL] gate started', { uuid, ringTimeoutSec, answerTimeoutMs, inCallTimeoutMs }); // Registra el inicio del gate con sus tiempos.

    let r = { status: 'error', meta: { reason: 'wait_failed' } }; // Inicializa el resultado de espera con un estado por defecto.

    try { // Intenta esperar answer o hangup.
        r = await waitForAnswerOrHangup(uuid, answerTimeoutMs); // Espera eventos ANSWER/HANGUP sobre el UUID.
    } catch (e) { // Captura error del waiter.
        r = { status: 'hangup', meta: { hangup_cause: 'WAIT_EXCEPTION', reason: String(e?.message || e) } }; // Normaliza el error como hangup por excepción.
    }

    const ms = Date.now() - t0; // Calcula la duración total hasta este punto.
    const sawAnswerEvent = Boolean(r?.meta?.sawAnswerEvent); // Guarda si se vio ANSWER real.

    if (r.status === 'answered') { // Entra solo si realmente contestó.
        console.log('[ESL] ANSWER => ORCHESTRATOR', { uuid }); // Registra que la llamada ya pasó a flujo conversacional.

        const c = await connect(); // Abre conexión ESL dedicada para esta llamada.
        const apiAsync = (cmd) => new Promise((resolve, reject) => { // Crea wrapper promise para comandos ESL API.
            c.api(cmd, (res) => { // Ejecuta el comando API en FreeSWITCH.
                const body = String(res?.getBody?.() || ''); // Lee el body devuelto por ESL.
                if (body.startsWith('-ERR')) return reject(new Error(body)); // Rechaza si FreeSWITCH responde error.
                resolve(body); // Resuelve con el body cuando el comando fue correcto.
            }); // Fin del callback ESL.
        }); // Fin del wrapper apiAsync.

        const inspectVar = async (name) => { // Define helper para inspeccionar variables del canal.
            try { // Protege la lectura de variables.
                const value = await apiAsync(`uuid_getvar ${uuid} ${name}`); // Pide a FreeSWITCH el valor de la variable.
                return String(value || '').trim(); // Normaliza el valor a string limpio.
            } catch { // Si falla la lectura.
                return ''; // Devuelve vacío para no romper el flujo.
            }
        }; // Fin del helper inspectVar.

        console.log('[ESL] channel vars', { // Registra variables útiles del canal para diagnóstico.
            uuid, // Registra el UUID actual.
            call_uuid: await inspectVar('uuid'), // Registra el UUID leído del propio canal.
            bridge_uuid: await inspectVar('bridge_uuid'), // Registra el bridge_uuid si existiera.
            signal_bond: await inspectVar('signal_bond'), // Registra signal_bond si existiera.
            call_direction: await inspectVar('call_direction'), // Registra la dirección del canal.
            endpoint_disposition: await inspectVar('endpoint_disposition'), // Registra el estado del endpoint.
            current_application: await inspectVar('current_application'), // Registra la aplicación actual dentro de FS.
            read_codec: await inspectVar('read_codec'), // Registra el codec de entrada.
            write_codec: await inspectVar('write_codec'), // Registra el codec de salida.
        }); // Fin del log de variables del canal.

        const session_id = String(opts?.session_id || '').trim() || (() => apiAsync(`uuid_getvar ${uuid} callgateway_session_id`))(); // Obtiene session_id desde opts o desde el canal.
        const sidRaw = typeof session_id === 'string' ? session_id : await session_id; // Resuelve la promesa si vino de uuid_getvar.
        const sid = sidRaw && sidRaw !== '_undef_' ? String(sidRaw).trim() : ''; // Normaliza el session_id definitivo.
        if (!sid) throw new Error('Missing session_id'); // Rompe si al final sigue sin haber session_id válido.

        const campaign_id = Number(opts?.meta?.campaign_id ?? NaN); // Lee campaign_id del payload.
        if (!Number.isFinite(campaign_id)) throw new Error('Missing meta.campaign_id in /dial payload'); // Rompe si campaign_id no es válido.

        await apiAsync(`uuid_setvar ${uuid} effective_caller_id_number ${uuid}`); // Ajusta el caller ID number efectivo en el canal.
        await apiAsync(`uuid_setvar ${uuid} effective_caller_id_name CGW`); // Ajusta el caller ID name efectivo en el canal.

        const orchRes = await fetch('http://127.0.0.1:3001/start', { // Llama al endpoint /start del Orchestrator.
            method: 'POST', // Usa método POST.
            headers: { 'Content-Type': 'application/json' }, // Indica que el body es JSON.
            body: JSON.stringify({ // Construye el payload JSON de arranque de sesión.
                campaign_id, // Envía el campaign_id.
                session_id: sid, // Envía el session_id.
                uuid, // Envía el UUID del canal.
                dynamic_variables: opts?.dynamic_variables ?? {}, // Envía variables dinámicas o un objeto vacío.
            }), // Fin del body JSON.
        }); // Fin del fetch a /start.

        if (!orchRes.ok) throw new Error(`Orchestrator HTTP ${orchRes.status}`); // Exige HTTP correcto del Orchestrator.
        const orch = await orchRes.json(); // Parsea la respuesta JSON de /start.
        if (!orch?.wav_path && !(Array.isArray(orch?.wav_paths) && orch.wav_paths.length)) throw new Error('Orchestrator missing wav_path(s)'); // Exige audio inicial reproducible.

        const playedList = await playWavList({ // Reproduce el saludo o audio inicial del Orchestrator.
            apiAsync, // Reutiliza la API ESL.
            uuid, // Indica el UUID del canal.
            wavPath: orch?.wav_path, // Pasa el wav_path único si existe.
            wavPaths: orch?.wav_paths, // Pasa la lista wav_paths si existe.
        }); // Fin de la reproducción inicial.

        console.log('[ESL] playWavList OK', { uuid, wavs: playedList }); // Registra que la reproducción inicial fue correcta.

        const enableBidirectional = String(process.env.CGW_ENABLE_BIDIRECTIONAL || '0') === '1'; // Calcula si el modo bidireccional está activado por entorno.

        if (!enableBidirectional) { // Entra aquí si no se quiere bidireccional.
            const monitor = waitForHangup(uuid, inCallTimeoutMs); // Arranca el monitor clásico de hangup.

            monitor // Encadena el reporte final cuando termine la llamada.
                .then((h) => postCallResult({ // Reporta fin normal de llamada.
                    status: 'hangup_complete', // Indica estado de colgado completo.
                    uuid, // Envía UUID.
                    session_id: sid, // Envía session_id.
                    campaign_id, // Envía campaign_id.
                    meta: { ...h }, // Reenvía la meta del monitor.
                })) // Fin del then.
                .catch((e) => postCallResult({ // Reporta error del monitor.
                    status: 'hangup_monitor_error', // Indica fallo del monitor.
                    uuid, // Envía UUID.
                    session_id: sid, // Envía session_id.
                    campaign_id, // Envía campaign_id.
                    meta: { error: String(e?.message || e) }, // Envía error normalizado.
                })); // Fin del catch.

            return { status: 'answered', ms, meta: { uuid, sawAnswerEvent }, monitor }; // Devuelve el flujo answered clásico.
        } // Fin del modo no bidireccional.

        console.log('[ESL] bidirectional mode enabled', { uuid, session_id: sid, campaign_id }); // Registra activación del modo bidireccional.

        let isActive = true; // Marca si el loop bidireccional sigue activo.
        const bidirectionalStartedAt = Date.now(); // Guarda el inicio del modo bidireccional.
        const maxBidirectionalMs = Number(process.env.CGW_BIDIRECTIONAL_MAX_MS || inCallTimeoutMs); // Calcula el tiempo máximo permitido para el modo bidireccional.
        const recordFile = `/var/lib/freeswitch/recordings/cgw/cgw_${uuid}.wav`; // Define la ruta del WAV continuo de captura.
        let vadOffset = 44; // Guarda el offset incremental actual del WAV, empezando tras la cabecera.
        let turnStartOffset = 44; // Guarda el offset donde empieza el turno actual.
        let speechActive = false; // Indica si actualmente el cliente está hablando.
        let speechStartedAt = 0; // Guarda el instante en el que empezó la voz del turno actual.
        let lastSpeechAt = 0; // Guarda el instante en el que se detectó voz por última vez.
        const endSilenceMs = Number(process.env.CGW_END_SILENCE_MS || 700); // Define el silencio necesario para cerrar un turno.
        const minTurnBytes = Number(process.env.CGW_MIN_TURN_BYTES || 3200); // Define el mínimo tamaño válido de turno para no enviar basura.
        let turnSeq = 0; // Guarda la secuencia de turnos válidos recortados.
        let speechSeq = 0; // Guarda la secuencia de eventos enviados al endpoint /input.

        const monitor = waitForHangup(uuid, inCallTimeoutMs) // Arranca el monitor paralelo de hangup.
            .then((h) => { // Cuando cuelga la llamada.
                isActive = false; // Desactiva el loop.
                return h; // Devuelve la meta del hangup.
            }) // Fin del then.
            .catch((e) => { // Si el monitor falla.
                isActive = false; // Desactiva igualmente el loop.
                throw e; // Repropaga el error.
            }); // Fin del catch del monitor.

        try { // Intenta arrancar la grabación continua del cliente.
            await apiAsync(`uuid_record ${uuid} start ${recordFile}`); // Inicia la grabación del canal al fichero continuo.
            console.log('[ESL] recording started', { uuid, recordFile }); // Registra el inicio de la grabación.
        } catch (e) { // Si falla la grabación.
            console.error('[ESL] recording start error', { uuid, error: String(e?.message || e) }); // Registra el error de inicio de grabación.
        } // Fin del try/catch de arranque de grabación.

        (async () => { // Arranca el loop bidireccional en segundo plano.
            try { // Protege todo el loop bidireccional.
                while (isActive) { // Repite mientras la llamada siga activa.
                    if ((Date.now() - bidirectionalStartedAt) >= maxBidirectionalMs) { // Comprueba si se superó el tiempo máximo.
                        isActive = false; // Desactiva el loop por timeout.
                        console.log('[ESL] bidirectional loop timeout', { uuid, maxBidirectionalMs }); // Registra el timeout del loop.
                        break; // Sale del while.
                    } // Fin de comprobación de timeout.

                    try { // Intenta detectar voz en el nuevo tramo del WAV.
                        const result = await detectSpeechInWav(recordFile, vadOffset); // Analiza solo el tramo nuevo del WAV.
                        vadOffset = result.nextOffset; // Avanza el offset incremental al final del tramo leído.
                        console.log('[VAD]', { uuid, speech: result.speech, rms: result.rms, peak: result.peak, durationMs: result.durationMs, bytesRead: result.bytesRead, vadOffset }); // Registra el resultado VAD incremental.
                        const now = Date.now(); // Guarda el instante actual del loop.

                        if (result.speech) { // Entra si en este tramo se detectó voz.
                            if (!speechActive) { // Entra solo si es el inicio de un nuevo turno.
                                speechStartedAt = now; // Marca cuándo empezó el turno.
                                turnStartOffset = Math.max(44, vadOffset - result.bytesRead); // Marca el offset inicial del turno a partir del bloque actual.
                                speechSeq += 1; // Incrementa la secuencia de eventos de voz.
                                await fetch('http://127.0.0.1:3001/input', { // Notifica speech_start al Orchestrator.
                                    method: 'POST', // Usa POST.
                                    headers: { 'Content-Type': 'application/json' }, // Indica JSON.
                                    body: JSON.stringify({ // Construye el payload speech_start.
                                        session_id: sid, // Envía la sesión.
                                        type: 'speech_start', // Indica tipo speech_start.
                                        seq: speechSeq, // Envía secuencia del evento.
                                        ts_ms: Date.now(), // Envía timestamp del evento.
                                    }), // Fin del payload.
                                }); // Fin del fetch speech_start.

                                try { // Intenta cortar el audio del agente para permitir interrupción.
                                    await apiAsync(`uuid_break ${uuid} all`); // Ordena a FS cortar playback en curso.
                                    console.log('[BARGE_IN]', { uuid, action: 'uuid_break' }); // Registra barge-in correcto.
                                } catch (e) { // Si falla el corte.
                                    console.error('[BARGE_IN] error', { uuid, error: String(e?.message || e) }); // Registra error de barge-in.
                                } // Fin del try/catch de barge-in.
                            } // Fin del inicio de nuevo turno.

                            speechActive = true; // Marca que el cliente está hablando.
                            lastSpeechAt = now; // Actualiza el último instante con voz.
                        } else if (speechActive && lastSpeechAt && (now - lastSpeechAt) >= endSilenceMs) { // Entra si estábamos en voz y ya hubo silencio suficiente.
                            const turnEndedAt = vadOffset; // Marca el offset final del turno.
                            const turnBytes = Math.max(0, turnEndedAt - turnStartOffset); // Calcula el tamaño bruto del turno.
                            speechActive = false; // Cierra el estado de voz activa.

                            speechSeq += 1; // Incrementa secuencia para speech_end.
                            await fetch('http://127.0.0.1:3001/input', { // Notifica speech_end al Orchestrator.
                                method: 'POST', // Usa POST.
                                headers: { 'Content-Type': 'application/json' }, // Indica JSON.
                                body: JSON.stringify({ // Construye payload speech_end.
                                    session_id: sid, // Envía sesión.
                                    type: 'speech_end', // Indica fin de voz.
                                    seq: speechSeq, // Envía secuencia.
                                    ts_ms: Date.now(), // Envía timestamp.
                                }), // Fin del payload.
                            }); // Fin del fetch speech_end.

                            if (turnBytes < minTurnBytes) { // Filtra turnos demasiado cortos.
                                console.log('[TURN]', { uuid, event: 'speech_discarded', turnStartOffset, turnEndedAt, turnBytes, minTurnBytes }); // Registra que el turno se descarta por pequeño.
                                turnStartOffset = turnEndedAt; // Avanza el inicio al final descartado.
                                continue; // Salta a la siguiente iteración del loop.
                            } // Fin del filtro de turnos basura.

                            turnSeq += 1; // Incrementa la secuencia de turnos válidos.
                            const turnFile = `/var/lib/freeswitch/recordings/cgw/${uuid}_turn_${turnSeq}.wav`; // Define la ruta del WAV recortado del turno.
                            await cutWavSegment(recordFile, turnFile, turnStartOffset, turnEndedAt); // Recorta el turno del WAV continuo a un fichero independiente.
                            console.log('[STT_READY]', { uuid, turnSeq, turnFile }); // Registra que el turno ya está listo para STT.

                            const stt = await transcribeTurn(turnFile); // Ejecuta STT sobre el WAV del turno.
                            speechSeq += 1; // Incrementa la secuencia para el evento final.

                            const inputRes = await fetch('http://127.0.0.1:3001/input', { // Envía el final STT real al Orchestrator.
                                method: 'POST', // Usa POST.
                                headers: { 'Content-Type': 'application/json' }, // Indica JSON.
                                body: JSON.stringify({ // Construye el payload final.
                                    session_id: sid, // Envía sesión.
                                    type: 'final', // Indica final STT.
                                    seq: speechSeq, // Envía secuencia.
                                    ts_ms: Date.now(), // Envía timestamp.
                                    text: stt.text, // Envía texto transcrito por el STT.
                                    confidence: stt.confidence, // Envía confianza del STT.
                                }), // Fin del payload.
                            }); // Fin del fetch final.

                            const inputJson = await inputRes.json().catch(() => ({})); // Lee la respuesta JSON del Orchestrator sin romper si no viene JSON válido.
                            console.log('[ORCH_INPUT]', { uuid, turnSeq, speechSeq, status: inputRes.status, inputJson }); // Registra la respuesta del Orchestrator al evento final.

                            if (inputRes.ok && (inputJson?.wav_path || (Array.isArray(inputJson?.wav_paths) && inputJson.wav_paths.length))) { // Entra si el Orchestrator devolvió audio reproducible.
                                const replyPlayed = await playWavList({ // Reproduce la respuesta del agente.
                                    apiAsync, // Usa ESL.
                                    uuid, // Usa el UUID del canal.
                                    wavPath: inputJson?.wav_path, // Pasa wav_path si existe.
                                    wavPaths: inputJson?.wav_paths, // Pasa wav_paths si existe.
                                }); // Fin de playWavList de respuesta.
                                console.log('[ORCH_REPLY_PLAYED]', { uuid, turnSeq, replyPlayed }); // Registra la reproducción de la respuesta del agente.
                            } // Fin de reproducción de audio devuelto.

                            console.log('[TURN]', { uuid, event: 'turn_ready', turnSeq, turnStartOffset, turnEndedAt, turnBytes, turnFile }); // Registra el turno válido completo.
                            turnStartOffset = turnEndedAt; // Prepara el offset inicial del siguiente turno.
                            console.log('[TURN]', { uuid, event: 'speech_final', speechStartedAt, lastSpeechAt, silenceMs: now - lastSpeechAt, turnStartOffset, turnEndedAt, turnBytes, recordFile }); // Registra el cierre final del turno actual.
                        } // Fin del cierre de turno por silencio suficiente.
                    } catch (e) { // Captura cualquier error del procesamiento VAD/STT/orchestrator del loop.
                        console.error('[VAD] error', { uuid, error: String(e?.message || e) }); // Registra el error del loop de voz.
                    } // Fin del try/catch del procesamiento del loop.

                    if (!isActive) break; // Sale si el monitor ya desactivó el loop.
                    console.log('[ESL] loop tick', { uuid, recordFile }); // Registra una iteración del loop.
                } // Fin del while isActive.
            } catch (e) { // Captura error global del loop.
                console.error('[ESL] bidirectional loop error', { uuid, error: String(e?.message || e) }); // Registra el error global del loop.
            } finally { // Ejecuta limpieza final siempre.
                try { // Intenta parar la grabación continua.
                    await apiAsync(`uuid_record ${uuid} stop ${recordFile}`); // Detiene la grabación continua del canal.
                    console.log('[ESL] recording stopped', { uuid, recordFile }); // Registra parada de grabación.
                } catch (e) { // Si falla el stop.
                    console.error('[ESL] recording stop error', { uuid, error: String(e?.message || e) }); // Registra error al parar grabación.
                } // Fin del try/catch de parada de grabación.
            } // Fin del finally.
        })(); // Fin del lanzamiento del loop en segundo plano.

        return { status: 'answered', ms, meta: { uuid, sawAnswerEvent, bidirectional: true }, monitor }; // Devuelve llamada contestada con monitor bidireccional.
    } // Fin del bloque answered.

    if (r.status === 'hangup') { // Entra si colgó antes de answer.
        return { status: 'no_answer', ms, meta: { uuid, sawAnswerEvent, reason: 'hangup_before_answer', ...r.meta } }; // Devuelve no_answer normalizado por hangup previo.
    } // Fin del caso hangup previo.

    await hangup(uuid).catch(() => { }); // Intenta limpieza best-effort si no se llegó a answer.
    return { status: 'no_answer', ms, meta: { uuid, sawAnswerEvent, reason: 'no_answer_timeout' } }; // Devuelve timeout de no answer.
} // Fin de la función principal.

module.exports = { callWithGate }; // Exporta la función callWithGate.