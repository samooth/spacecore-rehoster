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

console.log('rehoster served discovery keys:')
console.log(rehoster.servedDiscoveryKeys)
// example output: [
//  '8d35aae54732aafc672dd168eb8c303f9dcea5ef3d3275897f61fe8779e1c882',
//  '4b4742caafa04b36428a5fd94f1f237fbb5ed162aaa56cb018b7d2ece58dfc3c'
// ]
// Note: a rehoster always serves itself, hence the 2 keys

console.log('\nIf you add the key of another rehoster, then it will recursively serve all its works')
const corestore2 = new Corestore(corestoreLoc)
const swarm2 = new Hyperswarm()

const rerehoster = await Rehoster.initFrom({ corestore: corestore2, swarm: swarm2 })
await rerehoster.addCore(rehoster.ownKey)
console.log('rerehoster served discovery keys:')
console.log(rerehoster.servedDiscoveryKeys) // 3 keys: its own, the rehoster's and what that one hosts

console.log('\nThe rehoster downloads any new blocks added to the hypercore')
someCore.on('append', () => console.log('Appended to local core--new length:', someCore.length))

const readcore = corestore2.get({ key: someCore.key })
await readcore.ready()
readcore.on('append', onAppend)

await someCore.append('A change')

async function onAppend () {
  console.log('Change reflected in remote core--new length:', readcore.length)

  console.log('You can also remove a core from the rehoster:')
  await rehoster.removeCore(someCore.key)
  console.log(rehoster.servedDiscoveryKeys)

  await Promise.all([rehoster.close(), rerehoster.close()])
}
