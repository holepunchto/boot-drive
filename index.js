'use strict'

const path = require('path')
const fsp = require('fs/promises')
const ScriptLinker = require('script-linker')
const sodium = require('sodium-native')
const b4a = require('b4a')
const unixResolve = require('unix-path-resolve')
const { createBuiltins } = require('./defaults.js')

module.exports = class Boot {
  constructor (drive, opts = {}) {
    this.drive = drive
    this.cache = opts.cache || {}

    this.entrypoint = opts.entrypoint || null
    this.main = null
    this.dependencies = opts.dependencies || new Map()

    this.cwd = opts.cwd || '.'
    this.absolutePrebuilds = opts.absolutePrebuilds || false
    this.prebuilds = {}

    this.linker = new ScriptLinker({
      readFile: async (name) => {
        const buffer = await this.drive.get(name)
        if (!buffer) throw new Error('ENOENT: ' + name)
        return buffer
      },
      builtins: createBuiltins(opts.additionalBuiltins)
    })
  }

  async _savePrebuildToDisk (mod) {
    const hasBuilds = resolve(mod, 'node-gyp-build')
    if (!hasBuilds) return

    let dirname = mod.dirname
    let buffer = null
    while (true) {
      const entrypath = dirname + '/prebuilds/' + process.platform + '-' + process.arch + '/node.napi.node'
      buffer = await this.drive.get(entrypath)
      if (buffer) break
      if (dirname === '/') return
      dirname = unixResolve(dirname, '..')
    }

    const basename = mod.package?.name + '-' + generichash(buffer) + '.node'
    const filename = path.resolve(this.cwd, 'prebuilds', basename)
    const exists = await fileExists(filename)
    if (!exists) {
      await fsp.mkdir(path.dirname(filename), { recursive: true })
      await atomicWriteFile(filename, buffer)
    }

    this.prebuilds[dirname] = this.absolutePrebuilds ? filename : './prebuilds/' + basename
  }

  async warmup () {
    if (!this.entrypoint) {
      const pkg = await this.drive.get('/package.json')
      this.entrypoint = JSON.parse(pkg || '{}').main
      if (!this.entrypoint) this.entrypoint = 'index.js'
    }
    this.entrypoint = unixResolve('/', this.entrypoint)

    this.main = null

    for await (const dep of this.linker.dependencies(this.entrypoint, {}, new Set(), this.dependencies)) {
      if (!this.main) this.main = dep

      await this._savePrebuildToDisk(dep.module)
    }
  }

  start () {
    const dependencies = this._bundleDeps(this.main.module)
    const builtinRequire = require.builtinRequire || require
    const entrypoint = this.main.module.filename

    return this._run(this._run, dependencies, this.prebuilds, entrypoint, dependencies[entrypoint], this.cache, this._createRequire, builtinRequire)
  }

  _bundleDeps (mod) {
    const dependencies = {}
    const stack = [mod]

    while (stack.length) {
      const mod = stack.pop()
      const dep = dependencies[mod.filename] = {
        filename: mod.filename,
        dirname: mod.dirname,
        type: mod.type,
        requires: {},
        source: mod.source
      }

      for (const r of mod.resolutions) {
        if (r.input === 'node-gyp-build') continue

        const isBuiltin = this.linker.builtins.has(r.input)

        if (isBuiltin || !r.output) {
          dep.requires[r.input] = { output: r.output, isBuiltin }
          continue
        }

        dep.requires[r.input] = { output: r.output }

        stack.push(this.dependencies.get(r.output))
      }
    }

    return dependencies
  }

  stringify () {
    const dependencies = this._bundleDeps(this.main.module)

    return `
    'use strict'

    const prebuilds = ${JSON.stringify(this.prebuilds, null, 2)}
    const dependencies = ${JSON.stringify(dependencies, null, 2)}
    const entrypoint = ${JSON.stringify(this.main.module.filename)}
    const builtinRequire = require.builtinRequire || require

    _run(_run, dependencies, prebuilds, entrypoint, dependencies[entrypoint], {}, _createRequire, builtinRequire)

    function ${this._run.toString()}

    function ${this._createRequire.toString()}
    `.trim()
  }

  _run (run, dependencies, prebuilds, entrypoint, mod, cache, createRequire, builtinRequire) {
    if (cache[mod.filename]) return cache[mod.filename].exports

    const m = cache[mod.filename] = {
      path: mod.dirname,
      filename: mod.filename,
      exports: {}
    }

    if (mod.type === 'json') {
      m.exports = JSON.parse(mod.source)
      return m.exports
    }

    const require = createRequire(mod, dependencies, prebuilds, { run, entrypoint, createRequire, builtinRequire, cache })
    require.main = cache[entrypoint]
    require.cache = cache
    require.builtinRequire = builtinRequire

    const source = mod.source + '\n//# sourceURL=' + mod.filename
    const wrap = new Function('require', '__dirname', '__filename', 'module', 'exports', '__src', 'eval(__src)') // eslint-disable-line no-new-func
    wrap(require, mod.dirname, mod.filename, m, m.exports, source)

    return m.exports
  }

  _createRequire (mod, dependencies, prebuilds, { run, entrypoint, createRequire, builtinRequire, cache }) {
    return function (req) {
      if (req === 'node-gyp-build') {
        return (dirname) => builtinRequire(prebuilds[dirname])
      }

      const r = mod.requires[req]

      if (r.isBuiltin) {
        return builtinRequire(r.output)
      }

      if (!r.output) throw new Error('Could not resolve ' + req + ' from ' + mod.dirname)

      const dep = dependencies[r.output]
      return run(run, dependencies, prebuilds, entrypoint, dep, cache, createRequire, builtinRequire)
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

async function atomicWriteFile (filename, buffer) {
  const tmpfile = filename + '.tmp.' + Math.random()
  await fsp.writeFile(tmpfile, buffer, { flag: 'wx' })
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
