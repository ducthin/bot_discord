const { containersById: byId } = require('../../utils/cs2Catalogue');
const { PREFIX, createBattleUi } = require('../../utils/cs2BattleUi');

function createBattle({ rollDrop, reelRound, dropName, dropImage, readPlayer, button, editHomReply, inventory }) {
    const { dropLocation, dropOutcome, resultView } = inventory;
    let stoppingAnimations = false;

    async function showBattleDrop(interaction, drop, notice) {
        const weaponCase = byId.get(drop.caseId);
        const state = await readPlayer(interaction);
        const stash = state.skinCases?.[interaction.user.id];
        const payload = resultView(weaponCase, dropOutcome(state, interaction.user.id, weaponCase, drop), {
            inventory: dropLocation(weaponCase, stash, drop), notice
        });
        // A collection is the prize's provenance, not an openable entry point.
        // Keep the selected custom case while returning through a standard case.
        const originCaseId = weaponCase.key ? weaponCase.id : 'crate-4904';
        payload.components[0].addComponents(button('battle-new', originCaseId, 'Về hòm Battle', { argument: drop.battleCaseId }));
        return editHomReply(interaction, payload);
    }

    const ui = createBattleUi({ rollDrop, reelRound, dropName, dropImage, showResult: showBattleDrop,
        shuttingDown: () => stoppingAnimations });
    return { handle: ui.handle, restoreResults: ui.restoreResults,
        finishAnimations() { stoppingAnimations = true; } };
}

module.exports = { PREFIX, createBattle };
