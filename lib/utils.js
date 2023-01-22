import { once } from 'events'

const REHOSTER = 'rehoster'

export async function isRehoster (bee) {
  const userData = (await bee.getHeader()).metadata?.userData
  return (userData && userData.toString() === REHOSTER)
}

export async function ensureIsRehoster (bee) {
  await bee.ready()

  if (bee.feed.length === 0) {
    if (bee.feed.writable) {
      bee.metadata ??= {}
      if (bee.metadata.userData && bee.metadata.userData.toString() !== REHOSTER) {
        throw new Error(`Already defined userData for this bee and it is not '${REHOSTER}'`)
      }
      bee.metadata.userData = REHOSTER
      return // The header will be written on the first put
    } else {
      await once(bee.feed, 'append')
    }
  }

  if (!(await isRehoster(bee))) {
    throw new Error('Not a rehoster')
  }
}
