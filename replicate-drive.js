const minimist = require('minimist')
const Hyperdrive = require('hyperdrive')
const Corestore = require('corestore')
const Hyperswarm = require('hyperswarm')

// node replicate-drive.js --store ./drive-corestore

const argv = minimist(process.argv.slice(2))
if (!argv.store) throw new Error('--store <path> is required')

main()

async function main () {
  const corestore = new Corestore(argv.store)
  const drive = new Hyperdrive(corestore)
  await drive.ready()

  console.log('Discovery key:', drive.discoveryKey.toString('hex'))
  console.log('Key:', drive.key.toString('hex'))

  const swarm = new Hyperswarm()
  swarm.on('connection', (conn) => corestore.replicate(conn))
  swarm.join(drive.discoveryKey, { server: true, client: false })
  await swarm.flush()

  console.log('Drive is being shared.')
}
