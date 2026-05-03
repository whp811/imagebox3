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
      entrypoint: 'src/electrobun/main.ts',
    },
    copy: {
      'dist-electrobun': 'views/renderer',
    },
    mac: {
      codesign: false,
      notarize: false,
      createDmg: false,
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
