# boot

Boot a hyperdrive from memory.

```
npm i boot-drive
```

## Usage
First prepare the drive
```js
const Boot = require('boot-drive')

const boot = new Boot(drive)
await boot.warmup()
```

Then you can start it
```js
const exported = boot.start()
console.log(exported)
```

Or you could just bundle it
```js
const source = boot.stringify()
console.log(source) // eval(source) or save it into a file
```

## API

#### `const boot = new Boot(drive, [options])`

Creates a bootloader to run the drive.

Available `options`:
```js
{
  entrypoint: null,
  cwd: '.',
  absolutePrebuilds: false,
  cache: {},
  dependencies: new Map(),
  additionalBuiltins: []
}
```

`cwd` is the working directory for `prebuilds/` (default: `.`).\
`absolutePrebuilds` will make use of `cwd` for the prebuilds path, included on the stringified output.\
`dependencies` is used in `warmup()`, you can share linker deps between boots.\
`additionalBuiltins` is for adding modules to be imported by Node's native `require`.

#### `await boot.warmup()`

Prepares the drive.

If `entrypoint` is not set, then it will try `/package.json` `main` property.

If it fails to find an `entrypoint` then it will use `index.js` by default.

#### `const exports = boot.start()`

Runs the drive.

#### `const source = boot.stringify()`

Bundles and stringifies the dependencies and source code of the drive.

Without `absolutePrebuilds` native modules has to always be in `./prebuilds/` related to the source file.

## License
MIT
