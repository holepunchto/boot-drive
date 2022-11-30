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
  modules: [],
  cwd: '.',
  cache: {},
  dependencies: new Map()
}
```

`modules` is used to add more native modules.\
`cwd` is the working directory for `prebuilds/` (default: `.`).\
`dependencies` is used in `warmup()`, you can share linker deps between boots.

#### `boot.modules`

List of modules that are included in the boot process.\
By default it contains all the native modules.

Add more by `boot.modules.add(name)` or using `options` from the constructor.

#### `await boot.warmup()`

Prepares the drive.

If `entrypoint` is not set, then it will try `/package.json` `main` property.

If it fails to find an `entrypoint` then it will use `index.js` by default.

#### `const exports = boot.start()`

Runs the drive.

#### `const source = boot.stringify()`

Bundles and stringifies the dependencies and source code of the drive.

`opts.cwd` doesn't apply for `stringify()`:\
Native modules has to always be in `./prebuilds/` related to the source file.

## License
MIT
