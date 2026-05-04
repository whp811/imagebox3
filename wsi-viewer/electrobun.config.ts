import type { ElectrobunConfig } from 'electrobun'

const config: ElectrobunConfig = {
  app: {
    name: 'WSI Hive',
    identifier: 'ca.uhn.wsi-hive',
    version: '0.1.0',
    description: 'Portable local whole-slide viewer',
  },
  build: {
    buildFolder: 'build-electrobun',
    artifactFolder: 'artifacts-electrobun',
    bun: {
      entrypoint: 'src/electrobun/index.ts',
    },
    copy: {
      'dist-electrobun': 'views/renderer',
    },
    mac: {
      codesign: false,
      notarize: false,
      createDmg: false,
      // Same artwork as Electron (build/icon.icns); iconset is generated on macOS by ensure-electrobun-mac-iconset.cjs
      icons: 'build/icon.iconset',
    },
    linux: {
      icon: 'build/icon.png',
    },
    win: {
      icon: 'build/icon.ico',
    },
  },
  release: {
    generatePatch: false,
  },
}

export default config
