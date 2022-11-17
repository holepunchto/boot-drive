const ScriptLinker = require('script-linker')
const { builtinModules } = require('module')
const path = require('path')

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
    }

    const cache = {}
    const nodeRequire = require
    const { linker, modules } = this

    run(first.module)

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
            return run(linker.modules.get(r.output)).exports
          }
        }
      }
    }
  }
}
