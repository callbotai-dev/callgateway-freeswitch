// callgateway/esl.js
'use strict'; // Activa modo estricto.

const modesl = require('modesl'); // Cliente ESL (Event Socket).

const ESL_HOST = process.env.ESL_HOST || '127.0.0.1'; // Host FreeSWITCH.
const ESL_PORT = Number(process.env.ESL_PORT || 8021); // Puerto ESL.
const ESL_PASS = process.env.ESL_PASS || 'ClueCon'; // Password ESL.
const ESL_GATEWAY = process.env.ESL_GATEWAY || 'evertel'; // Gateway SIP.
const ESL_API_TIMEOUT_MS = Number(process.env.ESL_API_TIMEOUT_MS || 15000); // Timeout API.

let conn = null; // Cache de conexión ESL.

function connect() { // Abre o reutiliza conexión ESL.
    if (conn && conn.connected()) return Promise.resolve(conn); // Reutiliza si viva.

    return new Promise((resolve, reject) => { // Promesa de conexión.
        let settled = false; // Evita doble resolve/reject.

        const t = setTimeout(() => { // Timeout de conexión.
            if (settled) return; // Guard.
            settled = true; // Marca.
            reject(new Error('esl_connect_timeout')); // Error.
        }, 8000); // 8s.

        conn = new modesl.Connection(ESL_HOST, ESL_PORT, ESL_PASS, () => { // Auth OK.
            if (settled) return; // Guard.
            settled = true; // Marca.
            clearTimeout(t); // Limpia timeout.
            console.log('[ESL] connected(auth)', { host: ESL_HOST, port: ESL_PORT }); // Log.
            try { conn.events('plain', 'ALL'); } catch (_) { } // Activa eventos.
            resolve(conn); // OK.
        }); // Crea conexión.

        conn.once('ready', () => { // Algunos builds emiten ready.
            if (settled) return; // Guard.
            settled = true; // Marca.
            clearTimeout(t); // Limpia.
            console.log('[ESL] ready', { host: ESL_HOST, port: ESL_PORT }); // Log.
            resolve(conn); // OK.
        }); // Fin ready.

        conn.once('error', (err) => { // Error de conexión.
            if (settled) return; // Guard.
            settled = true; // Marca.
            clearTimeout(t); // Limpia.
            console.error('[ESL] connection error', err); // Log.
            reject(err); // Propaga.
        }); // Fin error.
    }); // Fin promesa.
} // Fin connect.

function apiWithTimeout(c, command, args = '') { // Ejecuta c.api con timeout.
    console.log('[ESL] api >', command, args); // Log request.
    return new Promise((resolve, reject) => { // Promesa.
        const timeoutMs = command === 'originate' ? Math.max(60000, ESL_API_TIMEOUT_MS) : ESL_API_TIMEOUT_MS; // originate tarda más.
        const t = setTimeout(() => reject(new Error(`esl_api_timeout: ${command}`)), timeoutMs); // Timeout.

        c.api(command, args, (res) => { // Llama API.
            clearTimeout(t); // Cancela timeout.
            const body = String(res?.getBody?.() || '').trim(); // Normaliza respuesta.
            if (!c || !c.connected || !c.connected()) return resolve(body); // Si se desconectó, igual resuelve.
            console.log('[ESL] api <', body); // Log response.
            resolve(body); // Devuelve.
        }); // Fin api.
    }); // Fin promesa.
} // Fin apiWithTimeout.

function disconnect() { // Cierra conexión ESL.
    try { // Protege.
        if (conn && conn.connected()) { // Si conectada.
            console.log('[ESL] disconnect'); // Log.
            conn.disconnect(); // Cierra.
        } // Fin if.
    } catch (e) { // Captura error.
        console.error('[ESL] disconnect error', e); // Log.
    } finally { // Siempre.
        conn = null; // Limpia cache.
    } // Fin finally.
} // Fin disconnect.

function _getUuidFromEvent(e) { // Extrae UUID robusto.
    return ( // Devuelve primera cabecera útil.
        e.getHeader('Unique-ID') || // Normal.
        e.getHeader('Channel-UUID') || // Alternativa.
        e.getHeader('Channel-Call-UUID') || // Variante.
        e.getHeader('variable_uuid') || // Fallback.
        '' // Default.
    ); // Fin return.
} // Fin _getUuidFromEvent.

function _pick(e, keys) { // Lee primera cabecera no vacía.
    for (const k of keys) { // Itera claves.
        const v = e.getHeader(k); // Lee header.
        if (v && String(v).trim()) return String(v).trim(); // Devuelve si válida.
    } // Fin for.
    return ''; // Nada.
} // Fin _pick.

function _extractHangupMeta(e) { // Meta hangup para diagnóstico.
    return { // Objeto meta.
        hangup_cause: _pick(e, ['Hangup-Cause', 'variable_hangup_cause']), // Causa principal.
        originate_disposition: _pick(e, ['variable_originate_disposition']), // Resultado originate.
        sip_hangup_disposition: _pick(e, ['variable_sip_hangup_disposition']), // Disposition SIP.
        sip_term_status: _pick(e, ['variable_sip_term_status']), // Código final SIP.
        sip_invite_failure_status: _pick(e, ['variable_sip_invite_failure_status']), // Código fallo INVITE.
        last_bridge_hangup_cause: _pick(e, ['variable_last_bridge_hangup_cause']), // Causa bridge.
    }; // Fin objeto.
} // Fin _extractHangupMeta.

async function ping() { // Comprueba FS.
    const c = await connect(); // Asegura conexión.
    return await apiWithTimeout(c, 'version'); // Devuelve versión.
} // Fin ping.

async function originate(toE164, vars = {}) { // Origina llamada y devuelve UUID.
    const c = await connect(); // Asegura conexión.

    vars = { // Vars por defecto.
        bypass_media: 'false', // Media por FS.
        ignore_early_media: 'true', // Ignora early media.
        originate_timeout: String(vars.originate_timeout ?? 22), // 22s ≈ 4 tonos.
        ...vars, // Sobrescribe con lo que llegue.
    }; // Fin vars.

    const chanVars = Object.entries(vars) // Convierte a k=v.
        .map(([k, v]) => `${k}=${v}`) // Formatea.
        .join(','); // Une.

    const prefix = chanVars ? `{${chanVars}}` : ''; // Encapsula si hay vars.
    const args = `${prefix}sofia/gateway/${ESL_GATEWAY}/${toE164} &playback(silence_stream://-1)`; // Originate + silencio infinito.

    const body = await apiWithTimeout(c, 'originate', args); // Ejecuta originate.
    if (!body.startsWith('+OK')) throw new Error(`originate_failed: ${body}`); // Falla si no OK.

    const uuid = body.replace(/^\+OK\s+/i, '').trim(); // Extrae UUID.
    if (!uuid) throw new Error(`originate_failed: ${body}`); // Sin UUID => error.

    console.log('[ESL] originate uuid =', uuid); // Log.
    return uuid; // OK.
} // Fin originate.

async function hangup(uuid) { // Cuelga por UUID.
    const c = await connect(); // Asegura conexión.
    const body = await apiWithTimeout(c, 'uuid_kill', uuid); // Mata canal.
    if (!body.includes('+OK')) throw new Error(`hangup_failed: ${body}`); // Error si falla.
    console.log('[ESL] hangup ok', uuid); // Log.
    return true; // OK.
} // Fin hangup.

async function waitForAnswerOrHangup(uuid, timeoutMs = 30000) { // Espera ANSWER o HANGUP.
    const c = await connect(); // Reutiliza conexión.
    return await new Promise((resolve) => { // Promesa.
        let done = false; // Guard.
        let sawAnswerEvent = false; // Flag answer.
        const t0 = Date.now(); // Inicio.

        const finish = (payload) => { // Cierra una sola vez.
            if (done) return; // Guard.
            done = true; // Marca.
            clearTimeout(timer); // Limpia timeout.
            c.removeListener('esl::event::**', onEvent); // Quita listener.
            resolve(payload); // Devuelve.
        }; // Fin finish.

        const timer = setTimeout(() => { // Timeout duro.
            finish({ status: 'timeout', ms: Date.now() - t0, meta: { sawAnswerEvent } }); // Timeout.
        }, timeoutMs); // ms.

        const onEvent = (e) => { // Handler.
            const name = e.getHeader('Event-Name'); // Evento.
            if (!name || name === 'API') return; // Ruido.
            const uid = _getUuidFromEvent(e); // UUID.
            if (uid !== uuid) return; // Solo nuestro canal.

            if (name === 'CHANNEL_ANSWER') { // Contestada.
                sawAnswerEvent = true; // Marca.
                return finish({ status: 'answered', ms: Date.now() - t0, meta: { sawAnswerEvent } }); // Resuelve.
            } // Fin answer.

            if (name === 'CHANNEL_HANGUP_COMPLETE') { // Colgada.
                const meta = _extractHangupMeta(e); // Meta.
                return finish({ status: 'hangup', ms: Date.now() - t0, meta: { ...meta, sawAnswerEvent } }); // Resuelve.
            } // Fin hangup.
        }; // Fin onEvent.

        try { c.events('plain', 'CHANNEL_ANSWER CHANNEL_HANGUP_COMPLETE'); } catch (_) { } // Suscribe mínimo.
        c.on('esl::event::**', onEvent); // Listener.
    }); // Fin promise.
} // Fin waitForAnswerOrHangup.

async function waitForHangup(uuid, timeoutMs = 60000) { // Espera HANGUP.
    const c = await connect(); // Reutiliza conexión.
    return await new Promise((resolve) => { // Promesa.
        let done = false; // Guard.
        const t0 = Date.now(); // Inicio.

        const finish = (payload) => { // Fin una vez.
            if (done) return; // Guard.
            done = true; // Marca.
            clearTimeout(timer); // Limpia.
            c.removeListener('esl::event::**', onEvent); // Quita.
            resolve(payload); // Devuelve.
        }; // Fin finish.

        const timer = setTimeout(() => { // Timeout.
            finish({ status: 'timeout', ms: Date.now() - t0, meta: { uuid } }); // Timeout.
        }, timeoutMs); // ms.

        const onEvent = (e) => { // Handler.
            const name = e.getHeader('Event-Name'); // Evento.
            if (name !== 'CHANNEL_HANGUP_COMPLETE') return; // Solo hangup.
            const uid = _getUuidFromEvent(e); // UUID.
            if (uid !== uuid) return; // Solo nuestro canal.
            const meta = _extractHangupMeta(e); // Meta.
            finish({ status: 'hangup', ms: Date.now() - t0, meta: { uuid, ...meta } }); // Resuelve.
        }; // Fin onEvent.

        try { c.events('plain', 'CHANNEL_HANGUP_COMPLETE'); } catch (_) { } // Suscribe.
        c.on('esl::event::**', onEvent); // Listener.
    }); // Fin promise.
} // Fin waitForHangup.

async function callWithGate(toE164, opts = {}) { // Gate: 4-5 tonos + handoff.
    const t0 = Date.now(); // Inicio.
    const ringTimeoutSec = Number(opts.ringTimeoutSec ?? 22); // 4-5 tonos.
    const answerTimeoutMs = Number(opts.answerTimeoutMs ?? ((ringTimeoutSec + 2) * 1000)); // Ventana a ANSWER.
    const inCallTimeoutMs = Number(opts.inCallTimeoutMs ?? 60000); // Monitor de llamada (test/diagnóstico).

    let uuid = ''; // UUID.
    try { // Originate.
        uuid = await originate(toE164, { originate_timeout: String(ringTimeoutSec) }); // Llama.
    } catch (e) { // Error originate.
        const msg = String(e?.message || e); // Normaliza.
        const ms = Date.now() - t0; // Duración.
        if (msg.includes('NO_ANSWER')) return { status: 'no_answer', ms, meta: { reason: 'originate_no_answer' } }; // No contesta.
        return { status: 'error', ms, meta: { reason: msg } }; // Otro error.
    } // Fin originate.

    console.log('[ESL] gate started', { uuid, ringTimeoutSec, answerTimeoutMs, inCallTimeoutMs }); // Log.

    const r = await waitForAnswerOrHangup(uuid, answerTimeoutMs); // Espera decisión.
    const ms = Date.now() - t0; // Duración.
    const sawAnswerEvent = Boolean(r?.meta?.sawAnswerEvent); // Flag.

    if (r.status === 'answered') { // Contestó.
        console.log('[ESL] ANSWER => HANDOFF NOW', { uuid }); // Log.
        const monitor = waitForHangup(uuid, inCallTimeoutMs); // Monitor (no beep).
        return { status: 'answered', ms, meta: { uuid, sawAnswerEvent }, monitor }; // OK.
    } // Fin answered.

    if (r.status === 'hangup') { // Colgó antes de contestar.
        return { status: 'no_answer', ms, meta: { uuid, sawAnswerEvent, reason: 'hangup_before_answer', ...r.meta } }; // No contesta.
    } // Fin hangup.

    await hangup(uuid).catch(() => { }); // Limpieza si timeout raro.
    return { status: 'no_answer', ms, meta: { uuid, sawAnswerEvent, reason: 'no_answer_timeout' } }; // No contesta.
} // Fin callWithGate.

module.exports = { // Exporta API.
    connect, // connect.
    apiWithTimeout, // apiWithTimeout.
    ping, // ping.
    originate, // originate.
    hangup, // hangup.
    disconnect, // disconnect.
    waitForAnswerOrHangup, // waitForAnswerOrHangup.
    waitForHangup, // waitForHangup.
    callWithGate, // callWithGate.
}; // Fin exports.
