# Hypercore Rehoster

Help host the hypercores of your choice.

Warning: still in alfa

For a hypercore containing a hyperdrive, both underlying cores will be served.

If you rehost another rehoster, you will rehost all its cores as well (recursively).


See [hypercore-rehost-server](https://gitlab.com/HDegroote/hypercore-rehost-server) for a server wrapping the rehoster, and [hypercore-rehost-cli](https://gitlab.com/HDegroote/hypercore-rehost-cli) for a CLI to interact with that server.

## Description

The rehoster automatically keeps the cores it hosts up to date, by continuously listening for changes in the background.

The rehoster is recursive: if you rehost the key of another rehoster, you will automatically
also rehost all the cores contained in that rehoster (and if those also contain rehoster keys, you will host their cores as well, recursively).

Rehosters can host one other, in which case they will host the union of all their individual cores.

A Rehoster uses a corestore to store the hypercores on disk.

The db (hyperbee) containing the hosted hypercores is also stored in the corestore.

## Install

`npm i hypercore-rehoster`

## API

### `const rehoster = new Rehoster({ corestore, bee, swarm = undefined })`
Initialises a rehoster. Note that the bee must be ready (`bee.ready()` must have been awaited).

if no swarm is specified, a new one with default options will be created.

Note: to be able to add/delete cores, the corestore should have write rights on the bee (e.g. it should have been created with that corestore).

### `const rehoster = await Rehoster.initFrom({ corestore, swarm?, beeName = 'rehoster-keys' })`
Initialises a rehoster based on the passed corestore.
The underlying hyperbee is loaded from the corestore, using the given beeName.

if no swarm is specified, a new one with default options will be created.

### `await rehoster.add(key)`
Add a new key to be rehosted (any valid key format can be used)

Note that connecting with other peers and downloading the core's content happens in the background, so not all content is immediately rehosted after `add` finishes.

### `await rehoster.remove(key)`
Removes a key (any valid key format can be used)

Note that propagating the delete to recursively hosted cores happens in the background
(e.g. a sub-rehoster's cores will not yet be unhosted immediately after `delete` finishes)

## Usage

See [example.js](example.js).
