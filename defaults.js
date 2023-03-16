const builtinRequire = require.builtin || require
let builtinModules = null

function builtinsHooks (builtins) {
  return {
    has (req) {
      return builtins.includes(req)
    },
    get (req) {
      return builtinRequire(req)
    },
    keys () {
      return builtins
    }
  }
}

module.exports = { builtinsHooks, getBuiltins }

function getBuiltins () {
  if (builtinModules !== null) return builtinModules
  builtinModules = builtinRequire('module').builtinModules || []
  return builtinModules
}
