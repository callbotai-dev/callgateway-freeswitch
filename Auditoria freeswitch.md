# Auditoría FreeSWITCH

## 1. Estado general

-   Versión: 1.10.13-dev
-   Estado: operativo
-   Uptime: 2 días
-   Sesiones pico: 706 / Máximo: 1000

## 2. Arquitectura

FreeSWITCH actúa como motor SIP/media. La lógica de llamadas está fuera
(CallGateway vía ESL).

## 3. Audio

-   Ruta real: /usr/local/freeswitch/share/freeswitch/sounds
-   Formato válido: WAV 16bit mono 8kHz
-   Reproducción mediante uuid_broadcast

## 4. ESL

-   Escucha: 127.0.0.1:8021
-   Acceso solo local (seguro)

## 5. SIP / Gateway

-   Gateway activo: evertel (registrado)
-   IP correcta configurada
-   Codecs: OPUS, G722, PCMU, PCMA

## 6. Dialplan

-   Configuración base/demo
-   No interviene en flujo AI
-   Flujo controlado externamente

## 7. Módulos

Activos clave: - mod_sofia (SIP) - mod_event_socket (ESL) - mod_sndfile
(audio) - mod_dptools (apps)

## 8. Seguridad

-   ESL no expuesto
-   ACL básica correcta
-   Sin riesgos críticos detectados

## 9. Hallazgos

-   Sistema limpio
-   Sin personalizaciones peligrosas
-   Flujo desacoplado correctamente

## 10. Conclusión

FreeSWITCH está bien configurado. Actúa como motor estable. La
inteligencia está fuera (correcto).
