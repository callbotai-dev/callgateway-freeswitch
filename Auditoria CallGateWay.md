# Auditoría Técnica — CallGateway (CallCenterAI)

## Objetivo

Auditar completamente el servicio **CallGateway** para confirmar:

* Cómo se origina una llamada
* Cómo se conecta con FreeSWITCH
* Cómo se conecta con Agent Orchestrator
* Cómo reproduce los WAV generados por el Orchestrator
* Qué eventos controlan el flujo de la llamada

---

# Arquitectura confirmada

Laravel
→ n8n
→ CallGateway (Node + ESL)
→ FreeSWITCH
→ Agent Orchestrator
→ TTS

---

# 1. Entrada HTTP de llamadas

Archivo:

```
callgateway/server.js
```

Endpoint:

```
POST /dial
```

Código clave:

```javascript
const r = await callWithGate(to, { ...body, toE164: to });
```

Este endpoint inicia el flujo completo de llamada.

---

# 2. Control completo de la llamada

Archivo:

```
esl/calls/callWithGate.js
```

Responsabilidades:

* Origina la llamada
* Espera ANSWER
* Llama al Agent Orchestrator
* Reproduce los audios
* Monitoriza el hangup

Flujo interno:

```
originate()
→ waitForAnswerOrHangup()
→ /start (Agent Orchestrator)
→ playWavList()
→ waitForHangup()
```

---

# 3. Origen de llamada FreeSWITCH

Archivo:

```
esl/calls/originate.js
```

Comando real enviado a FreeSWITCH:

```
originate {vars}sofia/gateway/evertel/<telefono> &playback(silence_stream://-1)
```

Gateway SIP configurado:

```
sofia/gateway/evertel
```

---

# 4. Conexión ESL con FreeSWITCH

Archivo:

```
esl/connection/connect.js
```

Configuración:

```
ESL_HOST = 127.0.0.1
ESL_PORT = 8021
ESL_PASS = ClueCon
```

La conexión se mantiene reutilizable mediante un singleton.

---

# 5. Detección de respuesta de llamada

Archivo:

```
esl/calls/waitForAnswerOrHangup.js
```

Evento escuchado:

```
CHANNEL_ANSWER
```

Cuando se recibe:

```
status = answered
```

Solo entonces se inicia el agente AI.

---

# 6. Conexión con Agent Orchestrator

Archivo:

```
esl/calls/callWithGate.js
```

Petición HTTP:

```
POST http://127.0.0.1:3001/start
```

Payload:

```json
{
  "campaign_id": X,
  "session_id": "...",
  "uuid": "...",
  "dynamic_variables": {}
}
```

---

# 7. Respuesta esperada del Orchestrator

El CallGateway espera:

```
wav_path
```

o

```
wav_paths
```

Validación en código:

```javascript
if (!orch?.wav_path) throw new Error('Orchestrator missing wav_path');
```

---

# 8. Reproducción de audio

Archivo:

```
esl/playback/playWavList.js
```

Fragmento clave:

```javascript
await apiAsync(`uuid_broadcast ${uuid} ${wav} aleg`);
```

Esto inyecta el WAV directamente en el canal FreeSWITCH.

---

# 9. Reproducción de múltiples WAV

Si el Orchestrator devuelve:

```
wav_paths
```

Se ejecuta:

```javascript
for (const wav of finalList)
```

Los audios se reproducen **en el mismo orden recibido**.

---

# 10. Ruta de los WAV

CallGateway **no modifica la ruta**.

La ruta utilizada es exactamente la que devuelve el Orchestrator.

Ejemplo esperado:

```
/var/lib/freeswitch/sounds/ccai/<session_id>/<chunk>.wav
```

---

# 11. Monitorización del final de llamada

Archivo:

```
esl/calls/waitForHangup.js
```

Evento escuchado:

```
CHANNEL_HANGUP_COMPLETE
```

---

# 12. Webhook final de llamada

Archivo:

```
esl/webhooks/postCallResult.js
```

Envía resultado a n8n o dashboard.

Payload:

```
session_id
campaign_id
uuid
status
hangup_cause
billsec
```

---

# Flujo completo confirmado

```
Laravel
   ↓
n8n
   ↓
POST /dial
   ↓
CallGateway
   ↓
originate (FreeSWITCH)
   ↓
CHANNEL_ANSWER
   ↓
POST /start → Agent Orchestrator
   ↓
Orchestrator genera WAV
   ↓
CallGateway recibe wav_path / wav_paths
   ↓
uuid_broadcast
   ↓
FreeSWITCH reproduce audio
   ↓
CHANNEL_HANGUP_COMPLETE
   ↓
postCallResult → webhook
```

---

# Estado final

| Componente                | Estado |
| ------------------------- | ------ |
| CallGateway HTTP          | OK     |
| ESL conexión              | OK     |
| Originate FreeSWITCH      | OK     |
| Detección ANSWER          | OK     |
| Conexión Orchestrator     | OK     |
| Reproducción WAV          | OK     |
| Reproducción múltiple WAV | OK     |
| Monitor hangup            | OK     |
| Webhook final             | OK     |

---

# Conclusión

El sistema CallGateway está **completamente funcional** y preparado para:

* TTS por chunks
* múltiples WAV
* reproducción secuencial
* integración con Agent Orchestrator

No requiere cambios para soportar múltiples audios generados por el TTS.

---

# Auditoría pendiente

FreeSWITCH:

* filesystem audio
* permisos
* latencia de lectura
* ruta efectiva de reproducción
