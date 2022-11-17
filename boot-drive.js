const minimist = require('minimist')
const Boot = require('./boot.js')
const Hyperdrive = require('hyperdrive')
const Corestore = require('corestore')
const RAM = require('random-access-memory')
const Hyperswarm = require('hyperswarm')

// node boot-drive <drive key>

const argv = minimist(process.argv.slice(2))
// if (!argv.store) throw new Error('--store <path to corestore> is required')
if (!argv._[0]) throw new Error('--key <drive key> is required')
// if (!argv.entrypoint) throw new Error('--entrypoint <main filename of drive> is required')

const corestore = new Corestore(argv.store || RAM)
const drive = new Hyperdrive(corestore, parsePublicKey(argv._[0]))

let modules = []
if (argv['add-module']) {
  const mods = argv['add-module']
  modules = Array.isArray(mods) ? mods : [mods]
}

main()

async function main () {
  await drive.ready()

  const swarm = new Hyperswarm()
  swarm.on('connection', (conn) => corestore.replicate(conn))
  swarm.join(drive.discoveryKey, { server: false, client: true })
  const done = drive.findingPeers()
  swarm.flush().then(done, done)

  await drive.download('/')
  await swarm.destroy()

  const boot = new Boot(drive, { modules })
  await boot.start(argv.entrypoint)
}

function parsePublicKey (key) {
  // if (typeof key === 'string' && key.length === 52) key = z32.decode(key)
  if (typeof key === 'string' && key.length === 64) key = Buffer.from(key, 'hex')
  return key
}
