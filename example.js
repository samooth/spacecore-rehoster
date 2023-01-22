import Corestore from 'corestore'
import Rehoster from './index.js'
import ram from 'random-access-memory'

const corestoreLoc = ram // './my-store' for persistence on the specified file

const corestore = new Corestore(corestoreLoc)
const rehoster = await Rehoster.initFrom({ corestore })

const someCore = corestore.get({ name: 'mycore' })
// NOTE: the core-keys you add need not be of same corestore
await someCore.ready()

await rehoster.addCore(someCore.key) // Accepts both buffer and hex keys

console.log('rehoster served discovery keys:')
console.log(rehoster.servedDiscoveryKeys)
// example output: [
//  '8d35aae54732aafc672dd168eb8c303f9dcea5ef3d3275897f61fe8779e1c882',
//  '4b4742caafa04b36428a5fd94f1f237fbb5ed162aaa56cb018b7d2ece58dfc3c'
// ]
// Note: a rehoster always serves itself, hence the 2 keys

console.log('\nIf you add the key of another rehoster, then it will recursively serve all its works')

const corestore2 = new Corestore(ram)
const rerehoster = await Rehoster.initFrom({ corestore: corestore2 })

// This ensures the other rehoster already flushed its topics to the swarm
// In practice you don't need to worry about this, it just helps solve a race condition
// (if swarm2 starts looking before swarm1 fully published its topics, it can miss them
// and will retry only after quite a while)
await rehoster.swarmInterface.swarm.flush()

await rerehoster.addCore(rehoster.ownKey)

// Connecting and updating runs in the background, so we need to give some time
// (add more time if the change doesn't propagate in time)
await new Promise((resolve) => setTimeout(resolve, 2000))

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

  console.log('\nYou can also remove a core from the rehoster')
  await rehoster.removeCore(someCore.key)

  await new Promise((resolve) => setTimeout(resolve, 3000)) // Give some time to update
  console.log('rehoster:', rehoster.servedDiscoveryKeys) // Should only be 1
  console.log('rerehoster:', rerehoster.servedDiscoveryKeys) // Should only be 2

  await Promise.all([rehoster.close(), rerehoster.close()])
}
