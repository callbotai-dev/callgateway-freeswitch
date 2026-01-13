'use strict'; // Modo estricto.

const { connect } = require('./esl/connection/connect'); // Conecta/reutiliza ESL.
const { disconnect } = require('./esl/connection/disconnect'); // Cierra ESL.

const { apiWithTimeout } = require('./esl/api/apiWithTimeout'); // API con timeout.
const { ping } = require('./esl/api/ping'); // Ping/version.

const { originate } = require('./esl/calls/originate'); // Origina llamada.
const { hangup } = require('./esl/calls/hangup'); // Cuelga llamada.
const { waitForAnswerOrHangup } = require('./esl/calls/waitForAnswerOrHangup'); // Espera answer/hangup.
const { waitForHangup } = require('./esl/calls/waitForHangup'); // Espera hangup.
const { callWithGate } = require('./esl/calls/callWithGate'); // Gate + handoff.

module.exports = { // Mantiene misma API pública.
    connect, // Export connect.
    apiWithTimeout, // Export apiWithTimeout.
    ping, // Export ping.
    originate, // Export originate.
    hangup, // Export hangup.
    disconnect, // Export disconnect.
    waitForAnswerOrHangup, // Export waitForAnswerOrHangup.
    waitForHangup, // Export waitForHangup.
    callWithGate, // Export callWithGate.
}; // Fin exports.
