const builtinRequire = require.builtin || require

let builtinModules = null
const builtins = {
  has (req) {
    return getBuiltins().includes(req)
  },
  get (req) {
    return builtinRequire(req)
  },
  keys () {
    return getBuiltins()
  }
}

module.exports = { builtins }

function getBuiltins () {
  if (builtinModules !== null) return builtinModules
  builtinModules = builtinRequire('module').builtinModules || []
  return builtinModules
}
