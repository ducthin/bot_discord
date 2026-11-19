const { cases, keys, skins: caseSkins } = require('../assets/cs2-cases.json');
const { terminals: terminalCatalogue, skins: terminalSkins } = require('../assets/cs2-terminals.json');
const { collections: collectionCatalogue, skins: collectionSkins } = require('../assets/cs2-iconic-collections.json');

const terminals = terminalCatalogue.map(terminal => ({ ...terminal, kind: 'terminal' }));
// Collections are sources for skins, inventory and contracts, not purchasable cases.
const collections = collectionCatalogue.map(collection => ({ ...collection, kind: 'collection', collection: collection.name }));
const skins = { ...caseSkins, ...terminalSkins, ...collectionSkins };
const containers = [...cases, ...terminals, ...collections];
const containersById = new Map(containers.map(container => [container.id, container]));

module.exports = { cases, terminals, collections, keys, skins, containers, containersById };
