const Hyperdrive = require('hyperdrive')
const Hyperswarm = require('hyperswarm')
const ram = require('random-access-memory')
const Corestore = require('corestore')
const Hyperbee = require('hyperbee')
const fs = require('fs/promises')
const createTestnet = require('hyperdht/testnet')
const safetyCatch = require('safety-catch')
const { once } = require('events')
const goodbye = require('graceful-goodbye')

const Rehoster = require('..')
const SwarmManager = require('swarm-manager')

const DIR = 'test-stores/'

const PEER1_LOC = `${DIR}peer1-store`
const PEER2_LOC = `${DIR}peer2-store`
const REH1_LOC = `${DIR}rehoster1-store`
const REH2_LOC = `${DIR}rehoster2-store`
const REH3_LOC = `${DIR}rehoster4-store`
const REH4_LOC = `${DIR}rehoster3-store`

const MS_WAIT = 5000
const MS_WAIT_DOWNLOAD = 1000

async function getDrive (store) {
  const drive = new Hyperdrive(store)
  await drive.put('./some', 'thing')
  return drive
}

let bootstrap

function getSwarm (store) {
  const swarm = new Hyperswarm({ bootstrap })
  if (store) {
    swarm.on('connection', (conn) => {
      conn.on('end', () => { conn.end() })
      store.replicate(conn)
      // Note the absence of an error handler.
      // There should be no errors since we control both sides,
      // so if one does occur, we want it to crash
    })
  }

  return swarm
}

async function cleanlyCloseRehoster (rehoster) {
  const swarmManager = rehoster.swarmManager
  const swarm = swarmManager.swarm

  const proms = []
  for (const conn of swarm.connections) {
    conn.end()
    if (conn.destroyed) continue
    proms.push(once(conn, 'close'))
  }
  await Promise.all(proms)

  await swarm.destroy()
  await swarmManager.close()
  await rehoster.close()
}

function getRehoster (store) {
  return new Rehoster(
    store,
    new SwarmManager(getSwarm(store)),
    new Hyperbee(store.get({ name: 'bee' }))
  )
}

async function runIntegrationTest (testnet) {
  bootstrap = testnet.bootstrap

  const store1 = new Corestore(PEER1_LOC)
  const peer1 = new SwarmManager(getSwarm(store1))
  const driveP1 = await getDrive(store1)
  const coreP1 = store1.get({ name: 'coreP1' })
  await coreP1.append('block0')

  const store2 = new Corestore(PEER2_LOC)
  const peer2 = new SwarmManager(getSwarm(store2))

  const driveP2 = await getDrive(store2)
  const beeP2 = new Hyperbee(store2.get({ name: 'beeP2' }))
  await beeP2.put('some', 'entry')

  // 1) *******************************************************************
  console.log('1) Peer1 and Reh1 online')

  peer1.serve(coreP1.discoveryKey)
  peer1.serve(driveP1.discoveryKey)
  // peer1.swarm.on('connection', (conn, info) => console.debug('Peer1 connected with', info.publicKey.toString('hex')))
  await peer1.swarm.flush()

  const storeReh1 = new Corestore(REH1_LOC)
  const reh1 = getRehoster(storeReh1)
  // reh1.swarm.on('connection', (conn, info) => console.debug('Rehoster1 connected with', info.publicKey.toString('hex')))

  await reh1.add(driveP1.key, { description: 'driveP1 in reh1' })
  await reh1.add(driveP2.key, { description: 'DriveP2 in reh1' })

  const readCore = reh1.corestore.get(driveP1.key)
  await once(readCore, 'append') // Connected
  await wait(MS_WAIT_DOWNLOAD) // Give some time to download it
  console.log('1) finished\n')

  // 2) ********************************************************************
  console.log('2) Peer1 disappears--someone requests drive1 and drive2')
  await peer1.close()
  await store1.close() // Not managed by hyperswarm--refactor?
  await reh1.swarm.flush()

  if (await canDownloadCore(driveP1.key)) {
    console.log('2) Finished\n')
  } else {
    throw new Error('Reh1 did not sync?')
  }

  // 3) ********************************************************************
  console.log('3) Rehoster1 and 2 both online, then rehoster1 disappears')
  const reh2Store = new Corestore(REH2_LOC)
  const reh2 = getRehoster(reh2Store)
  const connected = once(reh2.swarm, 'connection')
  await reh2.add(reh1.ownKey, { description: 'reh1 in reh2' })
  await reh2.add(driveP2.key, { description: 'DriveP2 in reh2' })
  await reh2.add(beeP2.feed.key, { description: 'DriveP2 feed in reh2' })
  await connected

  await wait(MS_WAIT_DOWNLOAD)

  await cleanlyCloseRehoster(reh1)

  if (await canDownloadCore(driveP1.key)) {
    console.log('3) Finished\n')
  } else {
    throw new Error('Reh1 did not sync with Reh2?')
  }

  // 4) ********************************************************************
  console.log('4) Rehosters 2-4 online, then only rehoster 4 remains')

  const reh3Store = new Corestore(REH3_LOC)
  const reh3 = getRehoster(reh3Store)
  const reh4Store = new Corestore(REH4_LOC)
  const reh4 = getRehoster(reh4Store)

  const connecteds = [once(reh3.swarm, 'connection'), once(reh4.swarm, 'connection')]
  await reh3.add(reh2.ownKey, { description: 'reh2 in reh3' })

  await reh4.ready()
  await reh3.add(reh4.ownKey, { description: 'reh4 in reh3' })

  await reh3.swarm.flush()
  await reh4.add(reh3.ownKey, { description: 'reh3 in reh4' })
  await Promise.all(connecteds)

  await wait(MS_WAIT_DOWNLOAD)

  await cleanlyCloseRehoster(reh2)
  await cleanlyCloseRehoster(reh3)

  if (await canDownloadCore(driveP1.key)) {
    console.log('4) Finished\n')
  } else {
    throw new Error('Reh4 did not sync with Reh2 and Reh3?')
  }

  // 5) ********************************************************************
  console.log('5) Peer1 and peer2 come online, then leave again')
  await reh4.swarm.flush()

  const peer1RenStore = new Corestore(PEER1_LOC)
  const renewedPeer1 = new SwarmManager(getSwarm(peer1RenStore))
  const peersConnected = [once(renewedPeer1.swarm, 'connection'), once(peer2.swarm, 'connection')]

  renewedPeer1.serve(coreP1.discoveryKey)
  renewedPeer1.serve(driveP1.discoveryKey)

  peer2.serve(beeP2.feed.discoveryKey)
  peer2.serve(driveP2.discoveryKey)

  const reopenedDriveP1 = new Hyperdrive(peer1RenStore)
  await reopenedDriveP1.ready()
  if (!reopenedDriveP1.core.length > 0) throw new Error('Incorrect drive?')

  const driveP1Entry = 'BigFile'
  const bigFileReps = 1000 * 1000 * 10
  await reopenedDriveP1.put(driveP1Entry, 'a'.repeat(bigFileReps))

  await Promise.all(peersConnected)

  await wait(MS_WAIT_DOWNLOAD)
  await Promise.all([renewedPeer1.close(), peer2.close()])

  const readEntry = await getDriveEntry(driveP1.key, driveP1Entry)
  if (readEntry.toString() === 'a'.repeat(bigFileReps)) {
    console.log('5) successfully read updated drive\n')
  } else {
    throw new Error('DriveP1 not propagated recursively?')
  }

  if (await canDownloadCore(driveP2.key)) {
    console.log('5) Finished\n')
  } else {
    throw new Error('DriveP2 request did not propagate to later rehosters?')
  }

  // 6) ********************************************************************
  console.log('6) Passing the updated info back to rehoster2')
  const reh3ReStore = new Corestore(REH3_LOC)
  const reReh3 = getRehoster(reh3ReStore)

  const reReh3Connected = once(reReh3.swarm, 'connection')
  await reReh3.ready()
  await reReh3Connected

  await wait(MS_WAIT_DOWNLOAD)
  await cleanlyCloseRehoster(reh4)

  const reh2ReStore = new Corestore(REH2_LOC)
  const reReh2 = getRehoster(reh2ReStore)
  const reReh2Connected = once(reReh2.swarm, 'connection')
  await reReh2.ready()
  await reReh2Connected

  await wait(MS_WAIT_DOWNLOAD)
  await cleanlyCloseRehoster(reReh3)

  if (await canDownloadCore(beeP2.feed.key)) {
    console.log('6) Finished\n')
  } else {
    throw new Error('Reh2 did not sync beeP2')
  }

  // 7: ********************************************************************
  console.log('7) Rehoster1 removes the peer1 drive')
  await reReh2.swarm.flush()

  const reh1ReStore = new Corestore(REH1_LOC)
  const reReh1 = getRehoster(reh1ReStore)
  const reReh1Connected = once(reReh2.swarm, 'connection')
  await reReh1.ready()
  await reReh1Connected

  await reReh1.delete(driveP1.key)
  await reReh1.delete(driveP2.key)
  await wait(MS_WAIT_DOWNLOAD)

  if (await canDownloadCore(driveP1.key)) {
    throw new Error('DriveP1 still available but should not be hosted anymore\n')
  } else {
    console.log('DriveP1 successfully removed everywere')
  }

  if (await canDownloadCore(driveP2.key)) {
    console.log('7) finished\n')
  } else {
    throw new Error('DriveP2 no longer available, but was present twice in reh2 and removed only once\n')
  }

  // 8) ********************************************************************
  console.log('8) Also removing driveP2 from rehoster2')
  await reReh2.delete(driveP2.key)

  await wait(MS_WAIT_DOWNLOAD)

  if (await canDownloadCore(driveP2.key)) {
    throw new Error('DriveP2 still available but should not be hosted anymore\n')
  } else {
    console.log('8) Finished\n')
  }

  // Shutting down
  console.log('Shutting down')
  await peer2.close()
  await peer1.close()
  await renewedPeer1.close()
  for (const reh of [reh1, reh2, reh3, reh4, reReh3, reReh2, reReh1]) {
    await cleanlyCloseRehoster(reh)
  }
}

async function main () {
  console.log('Setting up filesystem and testnet\n')
  await fs.rm(DIR, { recursive: true, force: true })
  await fs.mkdir(DIR)
  const testnet = await createTestnet(3)

  goodbye(async () => {
    await testnet.destroy()
    console.log('testnet destroyed')
    await fs.rm(DIR, { recursive: true, force: true })
    console.log('corestore directory removed')
  })

  await runIntegrationTest(testnet)
  goodbye.exit()
}

async function wait (ms = MS_WAIT) {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

function getRandomPeer () {
  const store = new Corestore(ram)
  const mgr = new SwarmManager(getSwarm())
  mgr.swarm.on('connection', socket => {
    store.replicate(socket)
    socket.on('error', safetyCatch)
  })
  return { mgr, store }
}

async function canDownloadCore (pubKey, timeout = MS_WAIT) {
  const { mgr, store } = getRandomPeer()
  const core = store.get({ key: pubKey })
  await core.ready()
  mgr.request(core.discoveryKey)

  try {
    await core.get(0, { timeout })
  } catch (e) {
    safetyCatch(e)
    return false
  } finally {
    await mgr.close()
    await store.close()
  }

  return true
}

async function getDriveEntry (pubKey, location) {
  const { mgr, store } = getRandomPeer()
  const drive = new Hyperdrive(store, pubKey)
  await drive.ready()
  const connected = once(mgr.swarm, 'connection')
  const ready = once(drive.core, 'append')

  mgr.request(drive.discoveryKey)
  await connected
  await ready

  const res = await drive.get(location)
  await mgr.close()
  await store.close()
  return res
}

main()
