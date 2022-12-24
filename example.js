import Corestore from 'corestore'
import Hyperswarm from 'hyperswarm'
import Rehoster from './index.js'
import ram from 'random-access-memory'

const corestoreLoc = ram // './my-store' for persistence on the specified file

const corestore = new Corestore(corestoreLoc)
const swarm = new Hyperswarm()

// Can take a while if existing db, as all cores will be announced on the swarm
// (if you don't want to sync on start, set doSync=false)
const rehoster = await Rehoster.initFrom({ corestore, swarm })

const someCore = corestore.get({ name: 'mycore' })
// NOTE: Core need not be of same corestore
await someCore.ready()

// Accepts both buffer and hex keys
await rehoster.addCore(someCore.key)

console.log(rehoster.servedDiscoveryKeys)
// example output: [ '12e7ddf4468c897908cea086c90a309d7794ac04f7fd3d177eb9d098de74f1a2' ]

await rehoster.close()
