import { addCollection } from '@iconify/vue'
import glyphs from '@/assets/visitor-icons.json'

let ready = false

export function registerVisitorIcons(): void {
  // Only the fixed visitor widget glyphs are local. Keep Iconify's normal
  // lookup for every other name, and its original missing-glyph result for mac.
  if (!ready)
    ready = addCollection(glyphs)
}
