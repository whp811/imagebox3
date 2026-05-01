export type ScannedSlide = {
  id: string
  label: string
  specimenId?: string
  stain?: string
  fileName?: string
  absolutePath: string
  relativeToSlides: string
  ext: string
  sizeBytes: number
  sourceType?: 'file' | 'zip'
  zipPath?: string
  zipEntry?: string
  zipCompressionMethod?: number
  requiresExtraction?: boolean
  thumbnailDataUrl?: string
  unsupportedReason?: string
}

export type SlidesInfo = {
  applicationRoot: string
  slidesRoot: string
}

export type PickSlidesFolderResult =
  | { cancelled: true }
  | { cancelled: false; info: SlidesInfo }
