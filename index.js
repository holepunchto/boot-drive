'use strict'

const { builtinModules } = require('module')
const path = require('path')
const fsp = require('fs/promises')
const crypto = require('crypto')
const ScriptLinker = require('script-linker')

const prebuilds = new Map()

module.exports = class Boot {
  constructor (drive, opts = {}) {
    this.drive = drive
    this.modules = new Set(builtinModules)

    this.linker = new ScriptLinker({
      cacheSize: Infinity,
      readFile: async (name) => {
        const buffer = await this.drive.get(name)
        if (!buffer) throw new Error('No entry: ' + name)
        return buffer
      }
    })

    if (opts.modules) for (const name of opts.modules) this.modules.add(name)
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

      const hasBuilds = dep.module.resolutions.some(r => r.input === 'node-gyp-build')
      if (hasBuilds) {
        try {
          const entrypath = dep.module.dirname + '/prebuilds/' + process.platform + '-' + process.arch + '/node.napi.node'
          const buffer = await this.drive.get(entrypath)

          const filename = path.join('prebuilds', dep.module.package?.name + '-' + sha1(buffer) + '.node')
          const exists = await fileExists(filename)
          if (!exists) {
            await fsp.mkdir(path.dirname(filename), { recursive: true })
            await atomicWriteFile(filename, buffer)
          }

          prebuilds.set(dep.module.dirname, path.resolve(filename))
        } catch {}
      }
    }

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

        for (const r of mod.resolutions) {
          if (r.input === req) {
            if (!r.output) throw new Error('MODULE_NOT_FOUND: ' + r.input)
            if (req === 'node-gyp-build') return customBinding
            return run(linker.modules.get(r.output)).exports
          }
        }
      }
    }
  }
}

function customBinding (dirname) {
  return require(prebuilds.get(dirname))
}

async function atomicWriteFile (filename, buffer) {
  const tmpfile = filename + '.tmp.' + crypto.randomBytes(16).toString('hex')
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

function sha1 (data) {
  return crypto.createHash('sha1').update(data).digest('hex')
}
