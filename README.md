# Hypercore Rehoster

Help host the hypercores of your choice.

For a hypercore containing a hyperdrive, both underlying cores will be served.

If you rehost another rehoster, you will rehost all its cores as well (recursively).


See [hypercore-rehost-server](https://gitlab.com/HDegroote/hypercore-rehost-server) for a server wrapping the rehoster, and [hypercore-rehost-cli](https://gitlab.com/HDegroote/hypercore-rehost-cli) for a CLI to interact with that server.

## Description

The rehoster automatically keeps the cores it hosts up to date, by continuously listening for changes in the background.

The rehoster is recursive: if you rehost the key of another rehoster, you will automatically
also rehost all the cores contained in that rehoster (and if those also contain rehoster keys, you will host their cores as well, recursively).

It is possible to turn a normal Hyperbee into a rehoster by adding keys to the sub at `Rehoster.SUB`. See the Usage section.

Rehosters can host one other, in which case they will host the union of all their individual cores.

## Install

`npm i hypercore-rehoster`

## API

### `const rehoster = new Rehoster(corestore, swarmManager, { bee, beeName })`
Initialises a rehoster.

The `corestore` is managed by the rehoster (closes when the rehoster closes),
but the `swarmManager` is not.

If a bee is passed, that bee will be used as database.
If not, the bee will be opened from the corestore, based on the `beeName` (or the default name if none is provided).

Note when passing a bee: to be able to add/delete cores, the corestore should have write rights on the bee (it should have been created with that corestore).

### `Rehoster.SUB`
A special Hyperbee sub identifier which the rehoster watches.
If Hypercore keys are added there, then those will be rehosted too.

This allows arbitrary Hyperbees to behave as a rehoster.

### `await rehoster.ready()`
Set up the the rehoster, so it starts downloading and serving all the keys it contains.

### `await rehoster.add(key)`
Add a new key to be rehosted (any valid key format can be used).

Note that connecting with other peers and downloading the core's content happens in the background, so not all content is immediately rehosted after `add` finishes.

### `await rehoster.delete(key)`
Remove a key.

Note that propagating the delete to recursively hosted cores happens in the background
(so a sub-rehoster's cores will not yet be unhosted immediately after `delete` finishes)

### `await rehoster.close()`
Close the rehoster, and clean up.

### `rehoster.on('new-node', { publicKey, length })`

Emitted when a new node was added to the rehoster.

### `rehoster.on('node-update', { publicKey, length })`

Emitted every time a node's underlying core gets a new length.

### `rehoster.on('node-fully-downloaded', { publicKey, length })`

Emitted every time a node's underlying core has been fully downloaded.

## Usage

See [example.js](example.js) for the basic usage.

To make an existing Hyperbee behave as a rehoster, you can add keys to the sub at `Rehoster.SUB`:
```
const core = new Hypercore(...)
const bee = new Hyperbee(...)
const sub = bee.sub(Rehoster.SUB)
await sub.put(core.key)
// The core will now be rehosted whenever the bee is
```
