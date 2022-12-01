const nodeRequire = require.node || require

let builtinModules = null
const builtins = {
  has (req) {
    return getBuiltins().includes(req)
  },
  get (req) {
    return nodeRequire(req)
  },
  keys () {
    return getBuiltins()
  }
}

module.exports = { builtins }

function getBuiltins () {
  if (builtinModules !== null) return builtinModules
  builtinModules = nodeRequire('module').builtinModules || []
  return builtinModules
}
