'use strict'; // Modo estricto.

const { createApiAsync } = require('./createApiAsync'); // Wrapper ESL API.
const { inspectChannelVars } = require('./inspectChannelVars'); // Inspección canal.
const { runBidirectionalSession } = require('./runBidirectionalSession'); // Sesión base.

/**
 * Punto de entrada del modo bidireccional.
 */
module.exports = {
    createApiAsync, // Exporta wrapper API.
    inspectChannelVars, // Exporta inspección.
    runBidirectionalSession, // Exporta sesión base.
};