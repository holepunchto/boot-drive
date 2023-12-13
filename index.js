'use strict'
const path = require('path')
const fsp = require('fs/promises')
const ScriptLinker = require('@holepunchto/script-linker')
const unixResolve = require('unix-path-resolve')
const { createBuiltins } = require('./defaults.js')
const PREBUILDS_REGEX = /(^|\/)?prebuilds(\/|$)?/
module.exports = class Boot {
  constructor (drive, opts = {}) {
    this.drive = drive
    this.cache = opts.cache || {}

    this.entrypoint = opts.entrypoint ? unixResolve('/', opts.entrypoint) : null
    this.dependencies = opts.dependencies || new Map()

    this.cwd = opts.cwd || '.'
    this.absolutePrebuilds = opts.absolutePrebuilds || false
    this.prebuilds = {}
    this.forceWarmup = !!opts.dependencies
    this.sourceOverwrites = opts.sourceOverwrites || null
    this.additionalBuiltins = opts.additionalBuiltins || []
    this.builtinsMap = opts.builtinsMap || null
    this.linker = new ScriptLinker(this.drive, {
      sourceOverwrites: this.sourceOverwrites,
      builtins: createBuiltins(this.additionalBuiltins),
      resolveMap: this.builtinsMap === null ? null : (req) => Object.hasOwn(this.builtinsMap, req) ? this.builtinsMap[req] : null
    })
    this.host = opts.host || (opts.platform ? opts.platform + '-' + opts.arch : require.addon ? require.addon.host : process.platform + '-' + process.arch)
    this._isNode = typeof opts.isNode === 'boolean' ? opts.isNode : (process.versions.node && !process.versions.bare)
  }

  _hasBuilds (pkg, mod) {
    if (Array.isArray(pkg?.files)) {
      for (const file of pkg.files) {
        if (PREBUILDS_REGEX.test(file)) return true
      }
    }

    return !!resolve(mod, 'node-gyp-build')
  }

  async _savePrebuildToDisk (mod) {
    const pkg = await mod.loadPackage()

    if (!this._hasBuilds(pkg, mod)) return

    const runtime = this._isNode ? 'node' : 'bare'

    const prebuild = await this._getLocalPrebuild(pkg, runtime)
    if (prebuild) {
      this.prebuilds[mod.dirname] = prebuild.key
      return
    }

    const prebuilds = { node: null, bare: null }
    let dirname = mod.dirname

    while (true) {
      const folder = dirname + '/prebuilds/' + this.host

      for await (const name of this.drive.readdir(folder)) {
        const type = getPrebuildType(name)
        if (prebuilds[type]) continue // First one wins

        if (type === 'node' || type === 'bare') {
          const info = this._prebuildInfo(pkg, type)

          await this._saveLocalPrebuild(unixResolve(folder, name), info.filename)

          prebuilds[type] = { dirname, key: info.key }
        }

        // Avoid breaking the loop in case we want the state for future local queries
      }

      if (dirname === '/' || prebuilds.node || prebuilds.bare) break
      dirname = unixResolve(dirname, '..')
    }

    const saved = this._isNode ? prebuilds.node : (prebuilds.bare || prebuilds.node)
    if (saved) {
      this.prebuilds[saved.dirname] = saved.key
    }
  }

  _prebuildInfo (pkg, extension) {
    const basename = pkg.name.replace(/\//g, '+') + '@' + pkg.version + '.' + extension
    const filename = path.resolve(this.cwd, 'prebuilds', this.host, basename)
    const key = this.absolutePrebuilds ? filename : path.resolve('prebuilds', this.host, basename)
    return { basename, filename, key }
  }

  async _getLocalPrebuild (pkg) {
    let info = this._prebuildInfo(pkg, 'bare')
    let exists = await fileExists(info.filename)
    if (!exists) {
      info = this._prebuildInfo(pkg, 'node')
      exists = await fileExists(info.filename)
    }
    return exists ? info : null
  }

  async _saveLocalPrebuild (key, filename) {
    const exists = await fileExists(filename)
    if (exists) return

    const buffer = await this.drive.get(key)
    await fsp.mkdir(path.dirname(filename), { recursive: true })
    await atomicWriteFile(filename, buffer)
  }

  async _defaultEntrypoint () {
    const pkg = await this.drive.get('/package.json')
    const main = JSON.parse(pkg || '{}').main || 'index.js'
    return unixResolve('/', main)
  }

  async warmup (entrypoint) {
    if (!this.entrypoint) this.entrypoint = await this._defaultEntrypoint()
    entrypoint = entrypoint ? unixResolve('/', entrypoint) : this.entrypoint

    if (this.forceWarmup === false && this.dependencies.has(entrypoint)) return

    for await (const dep of this.linker.dependencies(entrypoint, {}, new Set(), this.dependencies)) {
      await this._savePrebuildToDisk(dep.module)
    }
  }

  start (entrypoint) {
    entrypoint = entrypoint ? unixResolve('/', entrypoint) : this.entrypoint

    const main = this.dependencies.get(entrypoint)
    const boot = {
      cwd: this.cwd,
      absolutePrebuilds: true,
      prebuilds: this.prebuilds,
      dependencies: this._bundleDeps(main),
      builtinsMap: this.builtinsMap,
      entrypoint,
      cache: this.cache,
      createRequire,
      builtinRequire: require.builtinRequire || require
    }

    return run(run, boot, boot.dependencies[boot.entrypoint])
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
        source: mod.source,
        exports: {}
      }

      for (const r of mod.resolutions) {
        if (r.input === null || r.input === 'node-gyp-build') continue

        const isBuiltin = this.linker.builtins.has(r.input)

        if (isBuiltin) {
          dep.requires[r.input] = { output: r.input, isBuiltin }
          continue
        }

        dep.requires[r.input] = { output: r.output }

        const d = this.dependencies.get(r.output)
        if (d) stack.push(d)
      }
    }

    return dependencies
  }

  stringify (entrypoint) {
    entrypoint = entrypoint ? unixResolve('/', entrypoint) : this.entrypoint

    const main = this.dependencies.get(entrypoint)
    const dependencies = this._bundleDeps(main)

    return `
    (function () {
      'use strict'

      const __BOOTDRIVE__ = {
        cwd: ${JSON.stringify(this.absolutePrebuilds ? this.cwd : null)},
        absolutePrebuilds: ${JSON.stringify(this.absolutePrebuilds)},
        prebuilds: ${JSON.stringify(this.prebuilds, null, 2)},
        dependencies: ${JSON.stringify(dependencies, null, 2)},
        builtinsMap: ${JSON.stringify(this.builtinsMap, null, 2)},
        entrypoint: ${JSON.stringify(entrypoint)},
        cache: {},
        createRequire: __BOOTDRIVE_CREATE_REQUIRE__,
        builtinRequire: require.builtinRequire || require
      }

      return __BOOTDRIVE_RUN__(__BOOTDRIVE_RUN__, __BOOTDRIVE__, __BOOTDRIVE__.dependencies[__BOOTDRIVE__.entrypoint])

      ${run.toString().replace('run', '__BOOTDRIVE_RUN__')}

      ${createRequire.toString().replace('createRequire', '__BOOTDRIVE_CREATE_REQUIRE__')}
    })()
    `.trim()
  }
}

function run (run, ctx, mod) {
  if (ctx.cache[mod.filename]) return ctx.cache[mod.filename].exports

  const m = ctx.cache[mod.filename] = mod

  if (mod.type === 'json') {
    m.exports = JSON.parse(mod.source)
    return m.exports
  }

  const require = ctx.createRequire(run, ctx, mod)
  require.main = ctx.cache[ctx.entrypoint]
  require.cache = ctx.cache
  require.builtinRequire = ctx.builtinRequire

  const source = mod.source + '\n//# sourceURL=' + mod.filename
  const wrap = new Function('require', '__dirname', '__filename', 'module', 'exports', source) // eslint-disable-line no-new-func
  wrap(require, mod.dirname, mod.filename, m, m.exports, source)

  return m.exports
}

function createRequire (run, ctx, mod) {
  require.addon = () => {
    return ctx.builtinRequire(ctx.prebuilds[mod.dirname])
  }

  function require (req) {
    if (req === 'node-gyp-build') return require.addon

    const r = mod.requires[req]

    if (r.isBuiltin) {
      return ctx.builtinRequire(ctx.builtinsMap === null ? r.output : (Object.hasOwn(ctx.builtinsMap, req) ? ctx.builtinsMap[req] : r.output))
    }

    if (!r.output) throw new Error('Could not resolve ' + req + ' from ' + mod.dirname)

    const dep = ctx.dependencies[r.output]
    return run(run, ctx, dep)
  }

  return require
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

function getPrebuildType (filename) {
  if (filename.endsWith('.bare')) return 'bare'
  if (filename.endsWith('.node')) return 'node'
  return null
}
