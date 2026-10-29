import Foundation

/// The original pixel detector is a verification oracle, not a production fallback.
func pixelChangedRegion(_ pixels: UnsafeRawPointer, stride: Int, baseline: UnsafeRawPointer,
                        width: Int, height: Int) -> CGRect {
    let rowBytes = width * 4
    var left = width, top = height, right = 0, bottom = 0
    for y in 0..<height {
        let row = pixels.advanced(by: y * stride).assumingMemoryBound(to: UInt32.self)
        let old = baseline.advanced(by: y * rowBytes).assumingMemoryBound(to: UInt32.self)
        if memcmp(row, old, rowBytes) == 0 { continue }
        top = min(top, y); bottom = y + 1
        for x in 0..<width where row[x] != old[x] {
            left = min(left, x); right = max(right, x + 1)
        }
    }
    if right == 0 { return .zero }
    left = left / 16 * 16; top = top / 16 * 16
    right = min(width, (right + 15) / 16 * 16)
    bottom = min(height, (bottom + 15) / 16 * 16)
    return CGRect(x: left, y: top, width: right - left, height: bottom - top)
}

/// Compiled only into the benchmark helper; no clocks, samples or switches ship in normal capture.
final class ScreenBenchmark {
    private let path: String
    private let paired: Bool
    private let started = ProcessInfo.processInfo.systemUptime
    private let initialCPU: Double
    private var marked = 0.0
    private var frame: [String: Double] = [:]
    private var frames: [[String: Double]] = []
    private let stallMilliseconds: Double

    init() throws {
        let environment = ProcessInfo.processInfo.environment
        guard let path = environment["TOY_BOX_SCREEN_BENCHMARK_REPORT"] else {
            throw ScreenFailure(message: "Benchmark requires a report path.")
        }
        self.path = path
        self.paired = environment["TOY_BOX_SCREEN_BENCHMARK_COMPARE"] == "1"
        if let value = environment["TOY_BOX_SCREEN_BENCHMARK_STALL_MS"] {
            guard let milliseconds = Double(value), milliseconds.isFinite, milliseconds >= 0 else {
                throw ScreenFailure(message: "Benchmark stall must be a nonnegative number of milliseconds.")
            }
            stallMilliseconds = milliseconds
        } else {
            stallMilliseconds = 0
        }
        initialCPU = try Self.cpuMilliseconds()
    }

    func beginFrame(width: Int, height: Int, geometryChanged: Bool, resumed: Bool,
                    sourceTime: Double, continuous: Bool) {
        frame = [
            "atMs": Date().timeIntervalSince1970 * 1000, "width": Double(width), "height": Double(height),
            "geometryChanged": geometryChanged ? 1 : 0, "resumed": resumed ? 1 : 0,
            "sourceMs": sourceTime.isFinite ? sourceTime * 1000 : -1, "continuous": continuous ? 1 : 0
        ]
        marked = ProcessInfo.processInfo.systemUptime
    }

    func compare(_ pixels: UnsafeRawPointer, stride: Int, previous: UnsafeRawPointer,
                 baseline: UnsafeRawPointer, previousRegion: CGRect, dirty: Any?,
                 width: Int, height: Int) throws -> CGRect? {
        func measure(_ metadata: Any?, stage: String) -> CGRect? {
            let start = ProcessInfo.processInfo.systemUptime
            let result = compareFrame(pixels, stride: stride, previous: previous, baseline: baseline,
                                      previousRegion: previousRegion, dirty: metadata, width: width, height: height)
            frame[stage] = (ProcessInfo.processInfo.systemUptime - start) * 1000
            return result
        }
        let result: CGRect?
        if paired {
            let blocks: CGRect?
            let adaptive: CGRect?
            // Alternate order so neither detector always benefits from the other's cache reads.
            if frames.count % 2 == 0 {
                blocks = measure(nil, stage: "blockComparisonMs")
                adaptive = measure(dirty, stage: "adaptiveComparisonMs")
            } else {
                adaptive = measure(dirty, stage: "adaptiveComparisonMs")
                blocks = measure(nil, stage: "blockComparisonMs")
            }
            guard blocks == adaptive else {
                frame["mismatch"] = 1
                throw ScreenFailure(message: "Dirty comparison mismatch: blocks \(String(describing: blocks)), adaptive \(String(describing: adaptive)), dirty \(String(describing: dirtyRegion(dirty, width: width, height: height))), previous region \(previousRegion).")
            }
            frame["matched"] = 1
            result = adaptive
        } else {
            result = measure(dirty, stage: "adaptiveComparisonMs")
        }
        let reported = dirtyRegion(dirty, width: width, height: height)
        if let reported { frame["dirtyPixels"] = reported.width * reported.height }
        let bounds = comparisonBounds(dirty: reported, previousRegion: previousRegion, width: width, height: height)
        frame["searchPixels"] = bounds.baseline.width * bounds.baseline.height
        frame["previousRegionPixels"] = previousRegion.width * previousRegion.height
        frame["resultPixels"] = result.map { $0.width * $0.height } ?? -1
        return result
    }

    func mark(_ stage: String) {
        let now = ProcessInfo.processInfo.systemUptime
        frame[stage] = (now - marked) * 1000
        marked = now
    }

    func endFrame() {
        frames.append(frame)
        if stallMilliseconds > 0, frames.count % 30 == 0 {
            Thread.sleep(forTimeInterval: stallMilliseconds / 1000)
        }
    }

    func finish() throws {
        let wallMs = (ProcessInfo.processInfo.systemUptime - started) * 1000
        let cpuMs = try Self.cpuMilliseconds() - initialCPU
        let report: [String: Any] = [
            "paired": paired, "wallMs": wallMs, "cpuMs": cpuMs,
            "cpuPercent": cpuMs / wallMs * 100, "frames": frames,
            "stallMilliseconds": stallMilliseconds
        ]
        try JSONSerialization.data(withJSONObject: report, options: [.sortedKeys])
            .write(to: URL(fileURLWithPath: path), options: .atomic)
    }

    private static func cpuMilliseconds() throws -> Double {
        var usage = rusage()
        guard getrusage(RUSAGE_SELF, &usage) == 0 else {
            throw ScreenFailure(message: "Unable to measure native helper CPU: \(errno)")
        }
        return Double(usage.ru_utime.tv_sec + usage.ru_stime.tv_sec) * 1000 +
            Double(usage.ru_utime.tv_usec + usage.ru_stime.tv_usec) / 1000
    }
}

func verifyChangedRegions() throws {
    var cases = 0
    for (width, height) in [(1, 1), (15, 17), (16, 16), (17, 31), (33, 17), (65, 33)] {
        for padding in [0, 7] {
            let stride = width + padding
            let baseline = [UInt32](repeating: 0, count: width * height)
            var pixels = [UInt32](repeating: 0, count: stride * height)
            func check() throws {
                try pixels.withUnsafeBytes { current in
                    try baseline.withUnsafeBytes { previous in
                        let actual = changedRegion(current.baseAddress!, stride: stride * 4,
                                                   baseline: previous.baseAddress!, width: width, height: height,
                                                   bounds: CGRect(x: 0, y: 0, width: width, height: height))
                        let reference = pixelChangedRegion(current.baseAddress!, stride: stride * 4,
                                                           baseline: previous.baseAddress!, width: width, height: height)
                        guard actual == reference else {
                            throw ScreenFailure(message: "Region mismatch at \(width)x\(height), padding \(padding): \(actual), expected \(reference)")
                        }
                        cases += 1
                    }
                }
            }
            try check()
            for y in 0..<height {
                for x in width..<stride { pixels[y * stride + x] = .max }
                for x in 0..<width {
                    pixels[y * stride + x] = 1
                    try check()
                    pixels[y * stride + x] = 0
                }
            }
            try check() // Row padding is not image content.
            for y in 0..<height {
                for x in 0..<width { pixels[y * stride + x] = .max }
            }
            try check()
            for y in 0..<height {
                for x in 0..<width { pixels[y * stride + x] = baseline[y * width + x] }
            }
            try check()
        }
    }
    let adaptiveCases = try verifyDirtyComparisons()
    print("Verified \(cases) baseline-relative regions, reversions, geometry sizes and padded rows; \(adaptiveCases) adaptive comparisons.")
}

func rectMetadata(_ rectangles: [CGRect]) -> [[String: Any]] {
    rectangles.map { ["X": $0.origin.x, "Y": $0.origin.y, "Width": $0.size.width, "Height": $0.size.height] }
}

func verifyDirtyComparisons() throws -> Int {
    func require(_ condition: Bool, _ message: String) throws {
        if !condition { throw ScreenFailure(message: message) }
    }
    let interval = 1.0 / 30
    for (time, previous, expected): (Double, Double?, Bool) in [
        (interval, 0, true), (interval * 2, 0, false), (interval, nil, false), (.nan, 0, false)
    ] {
        try require(framesAreContinuous(time, previous: previous, interval: interval) == expected,
                    "Discontinuous capture must not trust the latest dirty rectangles.")
    }
    try require(dirtyRegion(nil, width: 65, height: 33) == nil, "Missing dirty metadata must retain full scans.")
    try require(dirtyRegion([], width: 65, height: 33) == .zero, "Empty metadata must be unchanged.")
    try require(dirtyRegion(rectMetadata([.zero]), width: 65, height: 33) == .zero, "An empty dirty rectangle must be unchanged.")
    try require(dirtyRegion(rectMetadata([CGRect(x: 17.2, y: 16.8, width: 0.3, height: 0.2)]), width: 65, height: 33) ==
                CGRect(x: 16, y: 16, width: 16, height: 16), "Fractional dirty bounds must align outward.")
    try require(dirtyRegion(rectMetadata([CGRect(x: 64, y: 32, width: 1, height: 1)]), width: 65, height: 33) ==
                CGRect(x: 64, y: 32, width: 1, height: 1), "Dirty bounds must clamp to partial edge blocks.")
    for metadata: Any in [
        "invalid", [["X": 1]],
        rectMetadata([CGRect(x: -1, y: 0, width: 1, height: 1)]),
        rectMetadata([CGRect(x: 64, y: 0, width: 2, height: 1)]),
        [["X": Double.nan, "Y": 0.0, "Width": 1.0, "Height": 1.0]],
        [["X": 0.0, "Y": 0.0, "Width": Double.infinity, "Height": 1.0]],
        [["X": 0.0, "Y": 0.0, "Width": -1.0, "Height": 1.0]]
    ] {
        try require(dirtyRegion(metadata, width: 65, height: 33) == nil, "Unusable dirty metadata must retain full scans.")
    }
    var cases = 0
    var random: UInt64 = 123
    for (width, height) in [(1, 1), (17, 31), (65, 33), (129, 65)] {
        for padding in [0, 7] {
            let stride = width + padding
            let full = CGRect(x: 0, y: 0, width: width, height: height)
            var pixels = [UInt32](repeating: 0, count: stride * height)
            var previous = [UInt32](repeating: 0, count: width * height)
            var baseline = previous
            var previousRegion = CGRect.zero
            func packed() -> [UInt32] {
                (0..<height).flatMap { Array(pixels[($0 * stride)..<($0 * stride + width)]) }
            }
            func check(_ dirty: Any?) throws {
                let unchanged = packed() == previous
                let result = try pixels.withUnsafeBytes { current in
                    try previous.withUnsafeBytes { last in
                        try baseline.withUnsafeBytes { base in
                            let reference: CGRect? = unchanged ? nil :
                                pixelChangedRegion(current.baseAddress!, stride: stride * 4,
                                                   baseline: base.baseAddress!, width: width, height: height)
                            let actual = compareFrame(current.baseAddress!, stride: stride * 4, previous: last.baseAddress!,
                                baseline: base.baseAddress!, previousRegion: previousRegion, dirty: dirty, width: width, height: height)
                            try require(actual == reference, "Adaptive mismatch at \(width)x\(height), padding \(padding): \(String(describing: actual)) versus \(String(describing: reference)).")
                            return actual
                        }
                    }
                }
                if let result {
                    previous = packed()
                    if result.width * result.height > full.width * full.height * maximumScreenRegionFraction {
                        baseline = previous
                        previousRegion = .zero
                    } else {
                        previousRegion = result
                    }
                }
                cases += 1
            }
            try check(rectMetadata([]))
            let a = CGRect(x: 0, y: 0, width: 1, height: 1)
            let b = CGRect(x: min(width - 1, 32), y: 0, width: 1, height: 1)
            pixels[0] = 1
            try check(rectMetadata([a]))
            pixels[Int(b.minX)] = 2
            try check(rectMetadata([b]))
            pixels[0] = baseline[0]
            try check(rectMetadata([a]))
            pixels[Int(b.minX)] = baseline[Int(b.minX)]
            try check(rectMetadata([b]))
            try check(rectMetadata([a, b]))
            pixels[(height - 1) * stride + width - 1] ^= 5
            try check("invalid")
            for index in 0..<400 {
                var rectangles: [CGRect] = []
                if index % 5 != 0 {
                    for _ in 0..<(index % 3 + 1) {
                        random = random &* 6364136223846793005 &+ 1
                        let x = Int(random >> 32) % width
                        random = random &* 6364136223846793005 &+ 1
                        let y = Int(random >> 32) % height
                        pixels[y * stride + x] = index % 3 == 0 ? baseline[y * width + x] : UInt32(truncatingIfNeeded: random)
                        rectangles.append(CGRect(x: x, y: y, width: 1, height: 1))
                    }
                }
                let metadata: Any? = index % 13 == 0 ? nil : rectMetadata(rectangles)
                try check(metadata)
                if index % 37 == 0 {
                    // A new full frame replaces the baseline.
                    previous = packed()
                    baseline = previous
                    previousRegion = .zero
                }
            }
            for y in 0..<height {
                for x in 0..<width { pixels[y * stride + x] = baseline[y * width + x] }
            }
            try check(rectMetadata([full]))
        }
    }
    return cases
}
