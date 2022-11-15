process.on('uncaughtException', console.error)

const fs = require('fs')
const path = require('path')
const ScriptLinker = require('script-linker')

const entrypoint = '/index.js' // + fix path
let resolves = {}

const s = new ScriptLinker({
  cacheSize: Infinity,
  readFile (name) {
    console.log('readFile', path.join(__dirname, 'example', name))
    return fs.promises.readFile(path.join(__dirname, 'example', name))
  }
})

const runtime = ScriptLinker.runtime({
  resolveSync (resolve, dirname, { isImport }) {
    return resolveSync(resolve, dirname, { isImport }, ScriptLinker.link.stringify({ protocol: 'resolve', transform: isImport ? 'esm' : 'cjs', resolve, dirname }))
  },
  getSync
})

require = runtime.require
global.require = runtime.require

main()

async function main () {
  for await (const dep of s.dependencies(entrypoint)) {
    
  }

  console.log(s.modules)
  console.log('=========')
  console.log(s.modules.get(entrypoint)._module.resolutions)
  console.log(s.modules.get('/node_modules/keypear/index.js')._module.resolutions)
  console.log(s.modules.get('/node_modules/keypear/storage.js')._module.resolutions)
  console.log('=========')

  console.log('testing runtime require:')
  require('keypear')
  console.log('after runtime require')

  // eval(s.modules.get(entrypoint).source)
}

function resolveSync (resolve, dirname, { isImport }, url) {
  const u = ScriptLinker.link.parse(url)
  console.log('resolveSync', resolve, dirname, { isImport }, url, u) /* => {
    protocol: 'resolve',
    transform: 'cjs',
    resolve: 'keypear',
    dirname: '/',
    filename: null
  } */

  // resolve => './storage'

  if (u.filename) {
    if (resolves[resolve]) {
      console.log('preresolution match', resolve, resolves[resolve])
      return resolves[resolve]
    }

    return u.filename // => '/node_modules/keypear~./storage'
  }

  const { resolutions } = s.modules.get(entrypoint)._module
  for (const resolution of resolutions) {
    if (resolution.input === u.resolve) { // 'keypear' === 'keypear'
      console.log('resolution match', resolution.input, resolution.output)

      preresolution(resolution.output)

      return resolution.output // => '/node_modules/keypear/index.js'
    }
  }

  console.log('resolveSync failed!')
  return null // ?
}

function getSync (url) {
  const u = ScriptLinker.link.parse(url)
  console.log('getSync', url, u)

  if (u.filename) {
    return s.modules.get(u.filename).source
  }

  /* if (url === 'app://cjs/node_modules/keypear/index.js') {
    return s.modules.get(u.filename).source
  } */

  return null // ?
}

function preresolution (filename) {
  resolves = {} // clear

  const { resolutions } = s.modules.get(filename)._module
  for (const resolution of resolutions) {
    resolves[resolution.input] = resolution.output
  }

  console.log('preresolution', resolves)
}
