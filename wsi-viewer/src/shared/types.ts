export type ScannedSlide = {
  id: string
  label: string
  absolutePath: string
  relativeToSlides: string
  ext: string
  sizeBytes: number
}

export type SlidesInfo = {
  applicationRoot: string
  slidesRoot: string
}
