'use strict'

const { builtinModules } = require('module')
const path = require('path')
const fsp = require('fs/promises')
const ScriptLinker = require('script-linker')
const sodium = require('sodium-native')
const b4a = require('b4a')

module.exports = class Boot {
  constructor (drive, opts = {}) {
    this.drive = drive
    this.modules = new Set(builtinModules)

    this.prebuildsPath = opts.prebuildsPath || 'prebuilds'
    this.prebuilds = new Map()

    this.linker = new ScriptLinker({
      cacheSize: Infinity,
      readFile: async (name) => {
        const buffer = await this.drive.get(name)
        if (!buffer) throw new Error('ENOENT: ' + name)
        return buffer
      }
    })

    if (opts.modules) for (const name of opts.modules) this.modules.add(name)
  }

  async _savePrebuildToDisk (mod) {
    const hasBuilds = resolve(mod, 'node-gyp-build')
    if (!hasBuilds) return

    const entrypath = mod.dirname + '/prebuilds/' + process.platform + '-' + process.arch + '/node.napi.node'
    const buffer = await this.drive.get(entrypath)
    if (!buffer) return

    const filename = path.join(this.prebuildsPath, mod.package?.name + '-' + generichash(buffer) + '.node')
    const exists = await fileExists(filename)
    if (!exists) {
      await fsp.mkdir(this.prebuildsPath, { recursive: true })
      await atomicWriteFile(filename, buffer)
    }

    this.prebuilds.set(mod.dirname, path.resolve(filename))
  }

  async start (entrypoint) {
    if (!entrypoint) {
      const pkg = await this.drive.get('/package.json')
      entrypoint = JSON.parse(pkg || '{}').main
      if (!entrypoint) throw new Error('No entrypoint')
      entrypoint = path.resolve('/', entrypoint)
    }

    let first = null

    for await (const dep of this.linker.dependencies(entrypoint)) {
      if (!first) first = dep

      await this._savePrebuildToDisk(dep.module)
    }

    const self = this
    const cache = {}
    const nodeRequire = require
    const { linker, modules } = this

    return run(first.module)

    function run (mod) {
      if (cache[mod.filename]) return cache[mod.filename]

      const m = cache[mod.filename] = {
        exports: {}
      }

      require.cache = cache

      const wrap = new Function('require', '__dirname', '__filename', 'module', 'exports', mod.source) // eslint-disable-line no-new-func
      wrap(require, mod.dirname, mod.filename, m, m.exports)

      return m

      function require (req) {
        if (modules.has(req)) {
          return nodeRequire(req)
        }

        const output = resolve(mod, req)
        if (!output) throw new Error('Could not resolve ' + req + ' from ' + mod.dirname)

        if (req === 'node-gyp-build') return customBinding.bind(self)
        return run(linker.modules.get(output)).exports
      }
    }
  }
}

function resolve (mod, input) {
  for (const r of mod.resolutions) {
    if (r.input === input) {
      if (!r.output) break
      return r.output
    }
  }
  return null
}

function customBinding (dirname) {
  return require(this.prebuilds.get(dirname))
}

async function atomicWriteFile (filename, buffer) {
  const tmpfile = filename + '.tmp.' + Math.random()
  await fsp.writeFile(tmpfile, buffer, { flags: 'wx' })
  await fsp.rename(tmpfile, filename)
}

async function fileExists (filename) {
  try {
    await fsp.stat(filename)
  } catch (error) {
    if (error.code === 'ENOENT') return false
  }
  return true
}

function generichash (data) {
  const out = b4a.allocUnsafe(32)
  sodium.crypto_generichash(out, data)
  return out.toString('hex')
}
