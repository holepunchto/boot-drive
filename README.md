# boot

Boot a hyperdrive from memory.

```
npm i holepunchto/boot
```

## Usage
```js
const boot = new Boot(drive)
await boot.start()
```

## API

#### `const boot = new Boot(drive, [options])`

Creates a bootloader to run the drive.

Available `options`:
```js
{
  modules: []
}
```

`modules` is used to add more native modules.

#### `drive.modules`

List of modules that are included in the boot process.\
By default it contains all the native modules.

Add more by `drive.modules.add(name)` or using `options` from the constructor.

#### `await drive.start([entrypoint])`

Runs the drive.

If `entrypoint` is not set, then it will try `/package.json` `main` property.

If it fails to find an `entrypoint` then the boot process will fail.

## Tools
First you need a drive, you can create one from a folder:
```bash
node folder-to-drive --input ./example --store ./drive-corestore
# Cloning folder (./example) into hyperdrive (./drive-corestore)
# Done. { files: 91, add: 91, remove: 0, change: 0 }
```

Share the drive to other peers:
```bash
node replicate-drive --store ./drive-corestore
# =>
# Discovery key: 12c9b2d6bb576b674fc0a1d5d5d9aa78587aef18c4cd3e27b0fd6825f85604d1
# Key: d61a1798c8c817899d19dc3fd2b8646d8988ec3f23ea997465ea23c70408f619
# Drive is being shared.
```

Boot a hyperdrive from RAM:
```bash
node boot-drive d61a1798c8c817899d19dc3fd2b8646d8988ec3f23ea997465ea23c70408f619 --entrypoint /index.js
```

`--add-module`:
```bash
node boot-drive <drive key> --entrypoint <main file> --add-module sodium-native
```
