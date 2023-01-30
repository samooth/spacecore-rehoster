const Hyperdrive = require('hyperdrive')
const Hyperswarm = require('hyperswarm')
const ram = require('random-access-memory')
const Corestore = require('corestore')
const Hyperbee = require('hyperbee')
const fs = require('fs/promises')
const createTestnet = require('@hyperswarm/testnet')
const safetyCatch = require('safety-catch')
const { once } = require('events')
const goodbye = require('graceful-goodbye')

const Rehoster = require('.')
const SwarmInterface = require('./lib/swarm-interface')

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

function getSwarm () {
  return new Hyperswarm({ bootstrap })
}

async function runIntegrationTest (testnet) {
  bootstrap = testnet.bootstrap

  const peer1 = new SwarmInterface(getSwarm(), new Corestore(PEER1_LOC))
  const driveP1 = await getDrive(peer1.corestore)
  const coreP1 = peer1.corestore.get({ name: 'coreP1' })
  await coreP1.append('block0')

  const peer2 = new SwarmInterface(getSwarm(), new Corestore(PEER2_LOC))

  const driveP2 = await getDrive(peer2.corestore)
  const beeP2 = new Hyperbee(peer1.corestore.get({ name: 'beeP2' }))
  await beeP2.put('some', 'entry')

  // 1) *******************************************************************
  console.log('1) Peer1 and Reh1 online')

  peer1.serveCore(coreP1.discoveryKey)
  peer1.serveCore(driveP1.discoveryKey)
  // peer1.swarm.on('connection', (conn, info) => console.debug('Peer1 connected with', info.publicKey.toString('hex')))
  await peer1.swarm.flush()

  const reh1 = new Rehoster(new Corestore(REH1_LOC), { swarm: new Hyperswarm({ bootstrap }) })
  // reh1.swarm.on('connection', (conn, info) => console.debug('Rehoster1 connected with', info.publicKey.toString('hex')))

  await reh1.add(driveP1.key)
  await reh1.add(driveP2.key)

  const readCore = reh1.corestore.get(driveP1.key)
  await once(readCore, 'append') // Connected
  await wait(MS_WAIT_DOWNLOAD) // Give some time to download it
  console.log('1) finished\n')

  // 2) ********************************************************************
  console.log('2) Peer1 disappears--someone requests drive1 and drive2')
  await peer1.close()
  await peer1.corestore.close() // Not managed by hyperswarm--refactor?
  await reh1.swarm.flush()

  if (await canDownloadCore(driveP1.key)) {
    console.log('2) Finished\n')
  } else {
    throw new Error('Reh1 did not sync?')
  }

  // 3) ********************************************************************
  console.log('3) Rehoster1 and 2 both online, then rehoster1 disappears')
  const reh2 = new Rehoster(new Corestore(REH2_LOC), { swarm: new Hyperswarm({ bootstrap }) })
  const connected = once(reh2.swarm, 'connection')
  await reh2.add(reh1.ownKey)
  await reh2.add(driveP2.key)
  await reh2.add(beeP2.feed.key)
  await connected

  await wait(MS_WAIT_DOWNLOAD)

  await reh1.close()
  if (await canDownloadCore(driveP1.key)) {
    console.log('3) Finished\n')
  } else {
    throw new Error('Reh1 did not sync with Reh2?')
  }

  // 4) ********************************************************************
  console.log('4) Rehosters 2-4 online, then only rehoster 4 remains')

  const reh3 = new Rehoster(new Corestore(REH3_LOC), { swarm: new Hyperswarm({ bootstrap }) })
  const reh4 = new Rehoster(new Corestore(REH4_LOC), { swarm: new Hyperswarm({ bootstrap }) })

  const connecteds = [once(reh3.swarm, 'connection'), once(reh4.swarm, 'connection')]
  await reh3.add(reh2.ownKey)
  await reh3.add(reh4.ownKey)
  await reh3.swarm.flush()
  await reh4.add(reh3.ownKey)
  await Promise.all(connecteds)

  await wait(MS_WAIT_DOWNLOAD)

  await reh2.close()
  await reh3.close()

  if (await canDownloadCore(driveP1.key)) {
    console.log('4) Finished\n')
  } else {
    throw new Error('Reh4 did not sync with Reh2 and Reh3?')
  }

  // 5) ********************************************************************
  console.log('5) Peer1 and peer2 come online, then leave again')
  await reh4.swarm.flush()

  const renewedPeer1 = new SwarmInterface(getSwarm(), new Corestore(PEER1_LOC))
  renewedPeer1.serveCore(coreP1.discoveryKey)
  renewedPeer1.serveCore(driveP1.discoveryKey)

  peer2.serveCore(beeP2.feed.discoveryKey)
  peer2.serveCore(driveP2.discoveryKey)

  const peersConnected = [once(renewedPeer1.swarm, 'connection'), once(peer2.swarm, 'connection')]
  const reopenedDriveP1 = new Hyperdrive(renewedPeer1.corestore)
  await reopenedDriveP1.ready()
  if (!reopenedDriveP1.core.length > 0) throw new Error('Incorrect drive?')

  const driveP1Entry = 'BigFile'
  await reopenedDriveP1.put(driveP1Entry, 'a'.repeat(1000 * 1000 * 100))

  await Promise.all(peersConnected)

  await wait(MS_WAIT_DOWNLOAD)
  await Promise.all([renewedPeer1.close(), peer2.close()])

  const readEntry = await getDriveEntry(driveP1.key, driveP1Entry)
  if (readEntry.toString() === 'a'.repeat(1000 * 1000 * 100)) {
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
  const reReh3 = new Rehoster(new Corestore(REH3_LOC), { swarm: new Hyperswarm({ bootstrap }) })
  const reReh3Connected = once(reReh3.swarm, 'connection')
  await reReh3.ready()
  await reReh3Connected

  await wait(MS_WAIT_DOWNLOAD)
  await reh4.close()

  const reReh2 = new Rehoster(new Corestore(REH2_LOC), { swarm: new Hyperswarm({ bootstrap }) })
  const reReh2Connected = once(reReh2.swarm, 'connection')
  await reReh2.ready()
  await reReh2Connected

  await wait(MS_WAIT_DOWNLOAD)
  await reReh3.close()

  if (await canDownloadCore(beeP2.feed.key)) {
    console.log('6) Finished\n')
  } else {
    throw new Error('Reh2 did not sync beeP2')
  }

  // 7: ********************************************************************
  console.log('7) Rehoster1 removes the peer1 drive')
  await reReh2.swarm.flush()

  const reReh1 = new Rehoster(new Corestore(REH1_LOC), { swarm: new Hyperswarm({ bootstrap }) })
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
  await Promise.all(
    [peer2, peer1, reh1, reh2, reh3, reh4, renewedPeer1, reReh3, reReh2, reReh1].map(x => x.close())
  )
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
  return new SwarmInterface(getSwarm(), new Corestore(ram))
}

async function canDownloadCore (pubKey, timeout = MS_WAIT) {
  const peer = getRandomPeer()
  const core = peer.corestore.get({ key: pubKey })
  await core.ready()
  peer.requestCore(core.discoveryKey)

  try {
    await core.get(0, { timeout })
  } catch (e) {
    safetyCatch(e)
    return false
  } finally {
    await peer.close()
  }

  return true
}

async function getDriveEntry (pubKey, location) {
  const peer = getRandomPeer()
  const drive = new Hyperdrive(peer.corestore, pubKey)
  await drive.ready()
  const connected = once(peer.swarm, 'connection')
  const ready = once(drive.core, 'append')

  peer.requestCore(drive.discoveryKey)
  await connected
  await ready

  const res = await drive.get(location)
  await peer.close()
  return res
}

main()
