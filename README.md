# Hypercore Rehoster

Help host the hypercores of your choice.

For a hypercore containing a hyperdrive, both underlying cores will be served.

If you rehost another rehoster, you will rehost all its cores as well (recursively).

## Description

The rehoster automatically keeps the cores it hosts up to date, by continuously listening for changes in the background.

The rehoster is recursive: if you rehost the key of another rehoster, you will automatically
also rehost all the cores contained in that rehoster (and if those also contain rehoster keys, you will host their cores as well, recursively).

Any Hyperbee can become a rehoster, by adding keys to the correct sub. See the Usage section.

Rehosters can host one other, in which case they will host the union of all their individual cores.

## Install

`npm i hypercore-rehoster`

## API

### `const rehoster = new Rehoster(corestore, swarmManager, bee)`
Initialises a rehoster.

The `corestore` is managed by the rehoster (closes when the rehoster closes), so consider passing in a corestore session.
The `swarmManager` and `bee` are not managed by the rehoster.

Note: to be able to add/delete cores, the corestore should have write rights on the passed-in bee (it should have been created with that corestore).

### `rehoster.ownKey`

The public key of the rehoster's Hyperbee.

### `rehoster.ownDiscoveryKey`

The discovery key of the rehoster's Hyperbee.

### `await rehoster.ready()`
Set up the the rehoster, so it starts downloading and serving all the keys it contains.

### `await rehoster.add(key)`
Add a new key to be rehosted (accepts buffer, z32 and hex keys).

Note that connecting with other peers and downloading the core's content happens in the background, so not all content is immediately rehosted after `add` finishes.

### `await rehoster.get(key)`
Gets the entry at the specified key.

Returns the value, or null if none is present. For example:

```
{
  description: 'entry description (can be null)',
  version: {
    minor: 1,
    major: 1
  }
}
```

The version information indicates the version at the time the entry was added. Generally speaking, it is only relevant internally.

### `const changed = sync (desiredState)`

Syncs the current entries of the rehoster to those in the `desiredState`.

**WARNING**: you should either interact with the rehoster through the `sync` API, or through the add/delete API, but never both at the same time (behaviour is undefined in that case).

`desiredState` is a Map (not a JSON object), with as keys the keys that should be rehosted, and as values JSON objects with metadata:

```
{ description: str|nullish }
```

The return value is a boolean indicating whether the desired state got applied.

### `await rehoster.delete(key)`
Remove a key.

Note that propagating the delete to recursively hosted cores happens in the background
(so a sub-rehoster's cores will not yet be unhosted immediately after `delete` finishes)

### `await rehoster.has(key)`
Return true if the rehoster has an entry with the given key, false othersiwe.

Note: entries which are present recursively (because they are present in a rehoster which was added) are not considered.



### `await rehoster.close()`
Close the rehoster, and clean up.

### Events

#### `rehoster.on('new-node', rehosterNodeRef)`

Emitted when a new node was added to the rehoster.

`rehosterNodeRef` is an object:

```
{
  nrRefs, // the amount of times this node is referenced
  publicKey,
  coreLength,
  description // the description of the new reference
}
```


#### `rehoster.on('deleted-node', rehosterNodeRef)`

Emitted when a node was deleted from the rehoster.

`nrRefs` is the amount of times this node is referenced.

`rehosterNodeRef` is an object:

```
{
  nrRefs, // the amount of times the node is still referenced now
  publicKey,
  coreLength,
  description // the description of the deleted reference
}
```

#### `rehoster.on('node-update', rehosterNodeInfo)`

Emitted every time a node's underlying core gets a new length.

`rehosterNodeInfo` is an object:

```
{
  publicKey,
  coreLength
}
```

#### `rehoster.on('node-fully-downloaded', rehosterNodeInfo)`

Emitted every time a node's underlying core has been fully downloaded.

`rehosterNodeInfo` is an object:

```
{
  publicKey,
  coreLength
}
```

#### `rehoster.on('invalid-key', { invalidKey })`

Emitted whenever the rehoster encounters an invalid key (that cannot refer to a Hypercore).

Invalid keys are skipped.

#### `rehoster.on('invalid-value', { rawEntry, error })`

Emitted whenever the rehoster encounters an invalid entry, for example if the entry was created by an incompatible Rehoster version, or if it cannot be decoded.

Entries with invalid values are skipped.

`error` is the error object thrown when trying to decode the value.

`rawEntry` is the raw hyperbee entry (without decoding it).

## Usage

See [example.js](example.js) for the basic usage.

To make an existing Hyperbee behave as a rehoster, you should use the RehosterDb manager. Pass it a Hyperbee, and it will add Rehoster entries to a sub dedicated to rehosting.

Do note that this approach works best if you are using a [sub-encoder](https://github.com/holepunchto/sub-encoder/) pattern for the Hyperbee.

```
const RehosterDb = require('./db')
const Corestore = require('corestore')
const Hyperbee = require('hyperbee')

async function main () {
  const store = new Corestore('./quick-test')

  const someCore = store.get({ name: 'some-core' })
  await someCore.append('block 0')

  const bee = new Hyperbee(store.get({ name: 'bee' }))
  const rehosterDb = new RehosterDb(bee)
  await rehosterDb.add(someCore.key, { description: 'illustrative core' })
  // The core will now be rehosted whenever the bee is

  console.log('entry:', await rehosterDb.get(someCore.key))
}

main()
```
