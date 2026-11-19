const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

// Load the actual engine with its private functions available to offline audits.
// Nothing is added to the bot's public exports and no storage operation is run.
function loadBattleAudit() {
    const filename = path.resolve(__dirname, '../../utils/cs2Battles.js');
    const auditModule = new Module(filename, module);
    auditModule.filename = filename;
    auditModule.paths = Module._nodeModulePaths(path.dirname(filename));
    const source = fs.readFileSync(filename, 'utf8');
    auditModule._compile(`${source}\nmodule.exports = { ...module.exports, settle, chooseWinners, breakTie, auditDependencies: { market, wallet, crypto } };\n`, filename);
    return auditModule.exports;
}

module.exports = { loadBattleAudit };
