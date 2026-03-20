'use strict'; // Fuerza modo estricto.

/**
 * Lee variables clave del canal para diagnóstico.
 * @param {object} params - Parámetros.
 * @param {string} params.uuid - UUID del canal.
 * @param {(cmd:string) => Promise<string>} params.apiAsync - Wrapper async ESL API.
 * @returns {Promise<object>}
 */
async function inspectChannelVars({ uuid, apiAsync }) { // Define lector de variables del canal.
    const getVar = async (name) => { // Helper para leer una variable concreta.
        try { // Protege la lectura.
            const value = await apiAsync(`uuid_getvar ${uuid} ${name}`); // Pide la variable a FreeSWITCH.
            return String(value || '').trim(); // Normaliza el valor.
        } catch { // Si falla.
            return ''; // Devuelve vacío para no romper el flujo.
        }
    }; // Fin helper.

    return { // Devuelve snapshot de variables útiles.
        uuid, // UUID actual.
        call_uuid: await getVar('uuid'), // UUID propio leído desde el canal.
        bridge_uuid: await getVar('bridge_uuid'), // UUID bridged si existe.
        signal_bond: await getVar('signal_bond'), // Relación entre legs si existe.
        call_direction: await getVar('call_direction'), // Dirección del canal.
        endpoint_disposition: await getVar('endpoint_disposition'), // Estado endpoint.
        current_application: await getVar('current_application'), // Aplicación actual.
        read_codec: await getVar('read_codec'), // Codec de entrada.
        write_codec: await getVar('write_codec'), // Codec de salida.
    }; // Fin retorno.
} // Fin función.

module.exports = { inspectChannelVars }; // Exporta helper.