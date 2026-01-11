'use strict'; // Activa modo estricto.

const modesl = require('modesl'); // Importa el cliente ESL.

const ESL_HOST = process.env.ESL_HOST || '127.0.0.1'; // IP/host del FreeSWITCH.
const ESL_PORT = Number(process.env.ESL_PORT || 8021); // Puerto ESL.
const ESL_PASS = process.env.ESL_PASS || 'ClueCon'; // Password ESL.

const ESL_GATEWAY = process.env.ESL_GATEWAY || 'evertel'; // Nombre del gateway SIP (sofia/gateway/<NAME>/...).

const ESL_API_TIMEOUT_MS = Number(process.env.ESL_API_TIMEOUT_MS || 15000); // Timeout para respuestas API.

let conn = null; // Cache de conexión ESL.

function connect() { // Abre o reutiliza conexión ESL.
    if (conn && conn.connected()) return Promise.resolve(conn); // Reutiliza si viva.

    return new Promise((resolve, reject) => { // Promesa.
        let settled = false; // Evita doble resolve/reject.

        const t = setTimeout(() => { // Timeout.
            if (settled) return; // Guard.
            settled = true; // Marca.
            reject(new Error('esl_connect_timeout')); // Falla.
        }, 8000); // 8s.

        conn = new modesl.Connection(ESL_HOST, ESL_PORT, ESL_PASS, () => { // Callback al autenticar.
            if (settled) return; // Guard.
            settled = true; // Marca.
            clearTimeout(t); // Limpia.
            console.log('[ESL] connected(auth)', { host: ESL_HOST, port: ESL_PORT }); // Log.
            resolve(conn); // OK.
        });

        conn.once('ready', () => { // Algunos entornos emiten ready.
            if (settled) return; // Guard.
            settled = true; // Marca.
            clearTimeout(t); // Limpia.
            console.log('[ESL] ready', { host: ESL_HOST, port: ESL_PORT }); // Log.
            resolve(conn); // OK.
        });

        conn.once('error', (err) => { // Error.
            if (settled) return; // Guard.
            settled = true; // Marca.
            clearTimeout(t); // Limpia.
            console.error('[ESL] connection error', err); // Log.
            reject(err); // Propaga.
        });
    });
}

function apiWithTimeout(c, command, args = '') { // Ejecuta c.api(command, args) con timeout.
    console.log('[ESL] api >', command, args); // Log antes de enviar.
    return new Promise((resolve, reject) => { // Promesa que resuelve con body string.
        const t = setTimeout(() => reject(new Error(`esl_api_timeout: ${command}`)), ESL_API_TIMEOUT_MS); // Timeout.
        c.api(command, args, (res) => { // Comando + args separados.
            clearTimeout(t); // Cancela timeout.
            const body = String(res?.getBody?.() || '').trim(); // Normaliza salida.
            console.log('[ESL] api <', body); // Log respuesta.
            resolve(body); // Devuelve body.
        });
    });
}

async function originate(toE164, vars = {}) { // Origina llamada y devuelve UUID.
    const c = await connect(); // Asegura conexión ESL viva.

    const chanVars = Object.entries(vars) // Convierte vars a pares.
        .map(([k, v]) => `${k}=${v}`) // Formatea como k=v.
        .join(','); // Une por coma para FreeSWITCH.

    const prefix = chanVars ? `{${chanVars}}` : ''; // Solo añade {..} si hay variables.

    const args = `${prefix}sofia/gateway/${ESL_GATEWAY}/${toE164} &park()`; // Args de originate.
    const body = await apiWithTimeout(c, 'originate', args); // Envia originate correctamente.

    if (!body.startsWith('+OK')) throw new Error(`originate_failed: ${body}`); // Si falla, devuelve razón.

    const uuid = body.replace(/^\+OK\s+/i, '').trim(); // Extrae UUID.
    if (!uuid) throw new Error(`originate_failed: ${body}`); // Si no hay UUID, error.

    console.log('[ESL] originate uuid =', uuid); // Log UUID final.
    return uuid; // OK.
}

async function hangup(uuid) { // Cuelga llamada por UUID.
    const c = await connect(); // Asegura conexión.

    const body = await apiWithTimeout(c, 'uuid_kill', uuid); // Mata el canal.

    const ok = body.includes('+OK'); // Verifica OK.
    if (!ok) throw new Error(`hangup_failed: ${body}`); // Error con motivo.

    console.log('[ESL] hangup ok', uuid); // Log OK.
    return true; // OK.
}

async function ping() { // Comprueba FS y devuelve versión.
    const c = await connect(); // Asegura conexión.
    const body = await apiWithTimeout(c, 'version'); // Pide versión.
    return body; // Devuelve versión.
}

function disconnect() { // Cierra conexión ESL.
    try { // Protege contra estados raros.
        if (conn && conn.connected()) { // Solo si está conectada.
            console.log('[ESL] disconnect'); // Log.
            conn.disconnect(); // Cierra.
        }
    } catch (e) { // Ignora errores al cerrar.
        console.error('[ESL] disconnect error', e); // Log.
    } finally { // Siempre.
        conn = null; // Limpia.
    }
}

module.exports = { originate, hangup, ping, disconnect }; // Exporta API.
