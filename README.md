# boot

Description.

```
npm i user/name
```

## Usage
First you need a drive, you can create one from a folder:
```bash
node folder-to-drive.js --input ./example --store ./drive-corestore
# Cloning folder (./example) into hyperdrive (./drive-corestore)
# Done. { files: 91, add: 91, remove: 0, change: 0 }
```

Share the drive to other peers:
```bash
node replicate-drive.js --store ./drive-corestore
# =>
# Discovery key: 12c9b2d6bb576b674fc0a1d5d5d9aa78587aef18c4cd3e27b0fd6825f85604d1
# Key: d61a1798c8c817899d19dc3fd2b8646d8988ec3f23ea997465ea23c70408f619
# Drive is being shared.
```

Boot a hyperdrive from RAM:
```bash
node boot.js --key d61a1798c8c817899d19dc3fd2b8646d8988ec3f23ea997465ea23c70408f619 --entrypoint /index.js
```

`--add-module`:
```bash
node boot.js --key <drive key> --entrypoint <main file> --add-module sodium-native
```

