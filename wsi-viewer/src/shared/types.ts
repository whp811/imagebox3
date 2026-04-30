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
}

export type SlidesInfo = {
  applicationRoot: string
  slidesRoot: string
}
