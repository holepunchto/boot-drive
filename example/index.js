const Keychain = require('keypear')
const keys = new Keychain()
console.log('keys', keys.get().publicKey.toString('hex'))

const z32 = require('z32')
console.log('z32', z32.decode('gr3ugpa'))

const path = require('path')
console.log('is absolute?', path.isAbsolute('/opt/app.js'))
