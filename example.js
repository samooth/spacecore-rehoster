const Corestore = require('spacecorestore')
const ram = require('random-access-memory')
const { asHex } = require('hexkey-utils')
const SwarmManager = require('swarm-manager')
const Spaceswarm = require('spaceswarm')
const createTestnet = require('spacedht/testnet')
const Spacebee = require('spacebee')

const Rehoster = require('./index.js')

const corestoreLoc = ram // './my-store' for persistence on the specified file

async function main () {
  const testnet = await createTestnet()
  const bootstrap = testnet.bootstrap

  const corestore = new Corestore(corestoreLoc)
  const rehoster = getRehoster(corestore, new Spaceswarm({ bootstrap }))
  await rehoster.ready()

  const someCore = corestore.get({ name: 'mycore' })
  await someCore.ready()
  await rehoster.add(someCore.key)

  console.log('rehoster served discovery keys:')
  console.log(rehoster.swarmManager.servedKeys.map(k => asHex(k)))
  // Note: a rehoster always serves itself, so will log 2 keys

  console.log('\nIf you add the key of another rehoster, then it will recursively serve all it rehosts too')

  const corestore2 = new Corestore(ram)
  const rerehoster = getRehoster(corestore2, new Spaceswarm({ bootstrap }))

  // This ensures the other rehoster already flushed its topics to the swarm
  // In practice you don't need to worry about this, it just helps solve a race condition
  // (if swarm2 starts looking before swarm1 fully published its topics, it can miss them
  // and will retry only after quite a while)
  await rehoster.swarmManager.swarm.flush()

  await rerehoster.add(rehoster.ownKey)

  // Connecting and updating runs in the background, so we need to give some time
  // (add more time if the change doesn't propagate in time)
  await new Promise((resolve) => setTimeout(resolve, 2000))

  console.log('rerehoster served discovery keys:')
  console.log(rerehoster.swarmManager.servedKeys.map(k => asHex(k))) // 3 keys: its own, the rehoster's and what that one hosts

  console.log('\nThe rehoster downloads any new blocks added to the spacecore')
  someCore.on('append', () => console.log('Appended to local core--new length:', someCore.length))

  const readcore = corestore2.get({ key: someCore.key })
  await readcore.ready()
  readcore.on('append', onAppend)

  await someCore.append('A change')

  async function onAppend () {
    console.log('Change reflected in remote core--new length:', readcore.length)

    console.log('\nYou can also remove a core from the rehoster')
    await rehoster.delete(someCore.key)

    await new Promise((resolve) => setTimeout(resolve, 3000)) // Give some time to update
    console.log('rehoster:', rehoster.swarmManager.servedKeys.map(k => asHex(k))) // Should only be 1
    console.log('rerehoster:', rerehoster.swarmManager.servedKeys.map(k => asHex(k))) // Should only be 2

    await rehoster.swarmManager.close()
    await rerehoster.swarmManager.close()
    await rehoster.close()
    await rerehoster.close()

    await testnet.destroy()
  }
}

function getRehoster (store, swarm) {
  swarm.on('connection', (socket) => {
    store.replicate(socket)
    socket.on('error', () => {})
  })

  const swarmManager = new SwarmManager(swarm)
  const namespace = store.namespace('rehoster')
  return new Rehoster(
    namespace,
    swarmManager,
    new Spacebee(namespace.get({ name: 'bee' }))
  )
}

main()
