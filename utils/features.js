const configuration = require('../config/features.json');

const managementCommands = new Set([
    'announce', 'call', 'cases', 'lfg', 'move', 'move-undo', 'report', 'role',
    'room-request', 'room', 'server-summary', 'serverinfo', 'suggest', 'ticket'
]);
const managementControls = /^(?:mg_(?:roomreq|room|roomform|case|ticket|lfg|suggest|announce|greeting)_|voice_call_)/;
const retiredControls = /^(?:quiz_|recommend_|visualizer_)/;

function isFeatureEnabled(name) {
    return configuration[name] === true;
}

function commandFeatureEnabled(name) {
    if (managementCommands.has(name)) return isFeatureEnabled('serverManagement');
    return true;
}

function isDisabledComponent(id) {
    return retiredControls.test(id ?? '') ||
        (!isFeatureEnabled('serverManagement') && managementControls.test(id ?? ''));
}

module.exports = { isFeatureEnabled, commandFeatureEnabled, isDisabledComponent };
