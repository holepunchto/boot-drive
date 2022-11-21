const minimist = require('minimist')
const Hyperdrive = require('hyperdrive')
const Corestore = require('corestore')
const Hyperswarm = require('hyperswarm')
const Localdrive = require('localdrive')
const MirrorDrive = require('mirror-drive')

// node download-drive.js --store ./drive-corestore-2 --key 5cf547235384a62afb54ca4d9594ec5726929800e3dcb705dc0332de156c44b2
// or with --out <localdrive output path>
// node download-drive.js --store ./drive-corestore-2 --out ./oout2 --key 5cf547235384a62afb54ca4d9594ec5726929800e3dcb705dc0332de156c44b2

const argv = minimist(process.argv.slice(2))
if (!argv.store) throw new Error('--store <path> is required')
if (!argv.key) throw new Error('--key <drive key> is required')

main()

async function main () {
  const corestore = new Corestore(argv.store)
  const drive = new Hyperdrive(corestore, parsePublicKey(argv.key))
  await drive.ready()

  const swarm = new Hyperswarm()
  swarm.on('connection', (conn) => corestore.replicate(conn))
  swarm.join(drive.discoveryKey, { server: false, client: true })
  const done = drive.findingPeers()
  await swarm.flush().then(done, done)

  const dl = drive.download('/')

  if (argv.out) {
    const out = new Localdrive(argv.out)
    const mirror = new MirrorDrive(drive, out)
    await mirror.done()
    console.log('Added:', mirror.count.add, 'Changed:', mirror.count.change, 'Removed:', mirror.count.remove)
  } else {
    await dl
  }

  await swarm.destroy()
}

function parsePublicKey (key) {
  // if (typeof key === 'string' && key.length === 52) key = z32.decode(key)
  if (typeof key === 'string' && key.length === 64) key = Buffer.from(key, 'hex')
  return key
}
