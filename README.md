# Hypercore Rehoster

Help host hypercores.

Warning: still in alfa

Uses a corestore to store the hypercores on disk
and an sqlite3 db to store the hosted hypercore keys on disk,
for persistence between sessions.

## Usage

```
const Corestore = require('corestore')
const Hyperswarm = require('hyperswarm')
const Rehoster = require('hypercore-rehoster')

const corestoreLoc = './my-store'
const dbConnectionStr = './hosted-cores.db'

const corestore = new Corestore(corestoreLoc)
const swarm = new Hyperswarm()

// Can take a while if existing db, as all cores will be announced on the swarm
const rehoster = await Rehoster.initFrom({ dbConnectionStr, corestore, swarm})

const someCore = corestore.get({name: 'mycore'})
// NOTE: Core need not be of some corestore
await someCore.ready()

// Accepts both buffer and hex keys
await rehoster.addCore(someCore.key)

console.log(rehoster.servedDiscoveryKeys)
// example output: [ '12e7ddf4468c897908cea086c90a309d7794ac04f7fd3d177eb9d098de74f1a2' ]
```
