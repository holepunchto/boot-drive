const minimist = require('minimist')
const Hyperdrive = require('hyperdrive')
const Corestore = require('corestore')
const Localdrive = require('localdrive')
const MirrorDrive = require('mirror-drive')

// node folder-to-drive.js --input ./example --store ./drive-corestore

const argv = minimist(process.argv.slice(2))
if (!argv.input) throw new Error('--input <path> is required')
if (!argv.store) throw new Error('--store <path> is required')

const corestore = new Corestore(argv.store)

const src = new Localdrive(argv.input)
const dst = new Hyperdrive(corestore)

console.log('Cloning folder (' + argv.input + ') into hyperdrive (' + argv.store + ')')

const mirror = new MirrorDrive(src, dst)
mirror.done().then(() => console.log('Done.', mirror.count))
