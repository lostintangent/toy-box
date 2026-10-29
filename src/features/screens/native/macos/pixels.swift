import Foundation

let maximumScreenRegionFraction = 0.4

func framesAreContinuous(_ time: Double, previous: Double?, interval: Double) -> Bool {
    guard let previous, time.isFinite, previous.isFinite, interval.isFinite, interval > 0 else { return false }
    let elapsed = time - previous
    // Two frame periods can hide a dropped frame whose damage is absent from the latest metadata.
    return elapsed >= interval * 0.75 && elapsed < interval * 1.5
}

/// ScreenCaptureKit dirty rectangles are already in output pixels, including when scaled.
func dirtyRegion(_ metadata: Any?, width: Int, height: Int) -> CGRect? {
    guard let rectangles = metadata as? [[String: Any]] else { return nil }
    let full = CGRect(x: 0, y: 0, width: width, height: height)
    var bounds = CGRect.null
    for value in rectangles {
        guard let rect = CGRect(dictionaryRepresentation: value as CFDictionary),
              rect.origin.x.isFinite, rect.origin.y.isFinite,
              rect.size.width.isFinite, rect.size.height.isFinite,
              rect.size.width >= 0, rect.size.height >= 0,
              rect.minX >= 0, rect.minY >= 0,
              rect.maxX <= full.maxX, rect.maxY <= full.maxY else { return nil }
        if rect.isEmpty { continue }
        bounds = bounds.union(rect)
        if bounds == full { return full }
    }
    if bounds.isNull { return .zero }
    let left = Int(bounds.minX) / 16 * 16
    let top = Int(bounds.minY) / 16 * 16
    let right = min(width, (Int(bounds.maxX.rounded(.up)) + 15) / 16 * 16)
    let bottom = min(height, (Int(bounds.maxY.rounded(.up)) + 15) / 16 * 16)
    return CGRect(x: left, y: top, width: right - left, height: bottom - top)
}

func comparisonBounds(dirty: CGRect?, previousRegion: CGRect, width: Int, height: Int)
    -> (previous: CGRect, baseline: CGRect) {
    let full = CGRect(x: 0, y: 0, width: width, height: height)
    guard let dirty else { return (full, full) }
    let baseline = previousRegion.isEmpty ? dirty : dirty.isEmpty ? previousRegion : dirty.union(previousRegion)
    if baseline.width * baseline.height > full.width * full.height * maximumScreenRegionFraction {
        return (full, full)
    }
    return (dirty, baseline)
}

func pixelsMatch(_ pixels: UnsafeRawPointer, stride: Int, previous: UnsafeRawPointer,
                 width: Int, bounds: CGRect) -> Bool {
    if bounds.isEmpty { return true }
    let offset = Int(bounds.minX) * 4
    let rowBytes = Int(bounds.width) * 4
    for y in Int(bounds.minY)..<Int(bounds.maxY) {
        if memcmp(pixels.advanced(by: y * stride + offset),
                  previous.advanced(by: y * width * 4 + offset), rowBytes) != 0 { return false }
    }
    return true
}

/// Nil means unchanged; an empty region restores the full-frame baseline.
func compareFrame(_ pixels: UnsafeRawPointer, stride: Int, previous: UnsafeRawPointer,
                  baseline: UnsafeRawPointer, previousRegion: CGRect, dirty: Any?,
                  width: Int, height: Int) -> CGRect? {
    let bounds = comparisonBounds(dirty: dirtyRegion(dirty, width: width, height: height),
                                  previousRegion: previousRegion, width: width, height: height)
    if pixelsMatch(pixels, stride: stride, previous: previous, width: width, bounds: bounds.previous) { return nil }
    return changedRegion(pixels, stride: stride, baseline: baseline,
                         width: width, height: height, bounds: bounds.baseline)
}

/// Finds differences within already block-aligned search bounds.
func changedRegion(_ pixels: UnsafeRawPointer, stride: Int, baseline: UnsafeRawPointer,
                   width: Int, height: Int, bounds: CGRect) -> CGRect {
    if bounds.isEmpty { return .zero }
    let startX = Int(bounds.minX), startY = Int(bounds.minY)
    let endX = Int(bounds.maxX), endY = Int(bounds.maxY)
    let offset = startX * 4
    let rowBytes = (endX - startX) * 4
    var left = endX, top = endY, right = startX, bottom = startY
    for y in startY..<endY {
        let row = pixels.advanced(by: y * stride)
        let old = baseline.advanced(by: y * width * 4)
        if memcmp(row.advanced(by: offset), old.advanced(by: offset), rowBytes) == 0 { continue }
        top = min(top, y); bottom = y + 1
        if left > startX, memcmp(row.advanced(by: offset), old.advanced(by: offset), (left - startX) * 4) != 0 {
            for x in Swift.stride(from: startX, to: left, by: 16) {
                if memcmp(row.advanced(by: x * 4), old.advanced(by: x * 4), min(16, endX - x) * 4) != 0 {
                    left = x
                    break
                }
            }
        }
        if right < endX, memcmp(row.advanced(by: right * 4), old.advanced(by: right * 4), (endX - right) * 4) != 0 {
            var end = endX
            while end > right {
                let x = (end - 1) / 16 * 16
                if memcmp(row.advanced(by: x * 4), old.advanced(by: x * 4), (end - x) * 4) != 0 {
                    right = end
                    break
                }
                end = x
            }
        }
    }
    if top == endY { return .zero }
    top = top / 16 * 16
    bottom = min(height, (bottom + 15) / 16 * 16)
    return CGRect(x: left, y: top, width: right - left, height: bottom - top)
}
