'use strict'; // Modo estricto.

// Usa fetch nativo (Node 18+) o fallback si no existe.
const fetchFn = global.fetch || require('node-fetch'); // Cliente HTTP.

// URL destino (n8n o dashboard).
// Prioridad: payload dinámico > ENV > vacío.
const DEFAULT_WEBHOOK = process.env.POST_CALL_WEBHOOK_URL || ''; // URL global opcional.

/**
 * Envía resultado final de llamada a n8n/dashboard.
 * @param {object} data - Payload final.
 */
async function postCallResult(data = {}) { // Función principal.
    const url = String(data?.meta?.hangup_callback_url || DEFAULT_WEBHOOK || '').trim(); // Determina URL.
    if (!url) return; // Si no hay URL, no hace nada (seguro).

    try { // Protección: nunca romper flujo principal.
        await fetchFn(url, { // Lanza POST.
            method: 'POST', // Método.
            headers: { 'Content-Type': 'application/json' }, // JSON.
            body: JSON.stringify({
                session_id: data.session_id || null, // ID sesión.
                campaign_id: data.campaign_id || null, // ID campaña.
                uuid: data.uuid || null, // UUID FS.
                status: data.status || 'unknown', // Estado final.
                hangup_cause: data.meta?.hangup_cause || null, // Causa FS.
                sip_hangup_disposition: data.meta?.sip_hangup_disposition || null, // SIP disposition.
                last_bridge_hangup_cause: data.meta?.last_bridge_hangup_cause || null, // Bridge cause.
                billsec: data.meta?.billsec || null, // Segundos facturables.
                raw: data.meta || {}, // Meta completa para debug.
            }),
        });
    } catch (_) {
        // Silencioso: no queremos que un fallo HTTP afecte la llamada.
    }
}

module.exports = { postCallResult }; // Export.