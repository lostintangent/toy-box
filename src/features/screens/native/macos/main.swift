import Cocoa
import ScreenCaptureKit
import ImageIO
import VideoToolbox

struct ScreenFailure: LocalizedError {
    let message: String
    var errorDescription: String? { message }
}

final class PacketWriter {
    private let lock = NSLock()

    func send(_ metadata: [String: Any], payload: Data = Data()) {
        lock.lock()
        defer { lock.unlock() }
        do {
            let json = try JSONSerialization.data(withJSONObject: metadata, options: [.sortedKeys])
            var packet = Data()
            for number in [UInt32(json.count), UInt32(payload.count)] {
                var value = number.bigEndian
                withUnsafeBytes(of: &value) { packet.append(contentsOf: $0) }
            }
            packet.append(json)
            packet.append(payload)
            try FileHandle.standardOutput.write(contentsOf: packet)
        } catch {
            FileHandle.standardError.write(Data("Screen output failed: \(error.localizedDescription)\n".utf8))
            exit(1)
        }
    }
}

struct FrameGeometry {
    let width: Int
    let height: Int
    let content: CGRect
}

enum ScreenTarget {
    case window(SCWindow)
    case display(SCDisplay)

    var window: SCWindow? {
        if case let .window(window) = self { return window }
        return nil
    }
    var pid: pid_t? { window?.owningApplication?.processID }
    var display: SCDisplay? {
        if case let .display(display) = self { return display }
        return nil
    }
    /// A window captures only itself; a display captures everything on it.
    var filter: SCContentFilter {
        switch self {
        case let .window(window): return SCContentFilter(desktopIndependentWindow: window)
        case let .display(display): return SCContentFilter(display: display, excludingWindows: [])
        }
    }
}

/// The radius of a window's rounded corners in captured pixels, measured from how much of its first
/// row is see-through.
func cornerRadius(_ pixels: UnsafeRawPointer, width: Int) -> Int {
    let row = pixels.assumingMemoryBound(to: UInt8.self)
    var run = 0
    while run < width / 4, row[run * 4 + 3] < 128 { run += 1 }
    // A corner of radius r leaves about r - √r pixels of its first row see-through.
    return run == 0 ? 0 : Int((Double(run) + 0.5 + Double(run).squareRoot()).rounded(.up))
}

/// Encodes captured pixels as JPEG. Anything see-through flattens to white, the encoder's
/// fastest path; any other color costs milliseconds more per frame.
func jpeg(_ image: CGImage, quality: Double) throws -> Data {
    let data = NSMutableData()
    guard let destination = CGImageDestinationCreateWithData(data, "public.jpeg" as CFString, 1, nil) else {
        throw ScreenFailure(message: "JPEG encoding failed.")
    }
    CGImageDestinationAddImage(destination, image, [kCGImageDestinationLossyCompressionQuality: quality] as CFDictionary)
    guard CGImageDestinationFinalize(destination) else { throw ScreenFailure(message: "JPEG encoding failed.") }
    return data as Data
}

/// One screen's stream. Its frame state lives on `queue`, where the stream delivers samples.
final class ScreenCapture: NSObject, SCStreamOutput, SCStreamDelegate, @unchecked Sendable {
    let id: String
    let target: ScreenTarget
    let writer: PacketWriter
    private let queue: DispatchQueue
    private var stream: SCStream!
    private let configuration = SCStreamConfiguration()
    private let pointPixelScale: Double
    private let maximumSize: CGSize
    private var configuredSize: CGSize
    private var sequence = 0
    private var geometry: FrameGeometry?
    /// A window's corner radius in the full frame, measured whenever its geometry changes.
    private var radius = 0
    private var frameStatus: SCFrameStatus?
    private var lastSentPixels = Data()
    private var basePixels = Data()
    /// Bounds of lastSentPixels differing from basePixels; empty after a full frame or restoration.
    private var previousRegion = CGRect.zero
    private var previousFrameTime: Double?
    private let quality: Double
    #if SCREEN_BENCHMARK
    private let benchmark: ScreenBenchmark
    #endif
    /// The pending start, which the stream stopping can settle before startCapture does.
    private var starting: CheckedContinuation<Void, Error>?

    init(id: String, target: ScreenTarget, writer: PacketWriter, options: [String: Any]) throws {
        let filter = target.filter
        self.id = id
        self.target = target
        self.writer = writer
        self.queue = DispatchQueue(label: "toy-box.screen.capture.\(id)", qos: .userInitiated)
        self.quality = options["quality"] as! Double
        self.pointPixelScale = Double(filter.pointPixelScale)
        self.maximumSize = CGSize(width: options["width"] as! Int, height: options["height"] as! Int)
        self.configuredSize = filter.contentRect.size
        #if SCREEN_BENCHMARK
        self.benchmark = try ScreenBenchmark()
        #endif
        super.init()
        guard let bounds = currentBounds() else { throw ScreenFailure(message: "Screen is unavailable.") }
        fit(bounds.size)
        configuration.minimumFrameInterval = CMTime(value: 1, timescale: Int32(options["fps"] as! Int))
        configuration.queueDepth = 3
        configuration.pixelFormat = kCVPixelFormatType_32BGRA
        configuration.colorSpaceName = CGColorSpace.sRGB
        configuration.capturesAudio = false
        configuration.showsCursor = false
        configuration.ignoreShadowsSingleWindow = true
        configuration.includeChildWindows = true
        configuration.scalesToFit = true
        configuration.preservesAspectRatio = true
        stream = SCStream(filter: filter, configuration: configuration, delegate: self)
        try stream.addStreamOutput(self, type: .screen, sampleHandlerQueue: queue)
    }

    private func fit(_ size: CGSize) {
        configuredSize = size
        let width = max(1, size.width * pointPixelScale)
        let height = max(1, size.height * pointPixelScale)
        let scale = min(1, min(maximumSize.width / width, maximumSize.height / height))
        configuration.width = max(1, Int(width * scale))
        configuration.height = max(1, Int(height * scale))
    }

    func start() async throws {
        try await withCheckedThrowingContinuation { continuation in
            queue.sync { starting = continuation }
            stream.startCapture { error in self.queue.async { self.settleStart(error) } }
        }
    }

    /// Settles the pending start once, whichever of its completion or the stream stopping comes first.
    private func settleStart(_ error: Error?) {
        guard let continuation = starting else { return }
        starting = nil
        if let error { continuation.resume(throwing: error) } else { continuation.resume() }
    }

    func stop() async throws {
        defer { stream = nil }
        #if SCREEN_BENCHMARK
        defer { finishBenchmark() }
        #endif
        do { try await stream.stopCapture() }
        // A stream whose source went away has already stopped, which leaves nothing to stop.
        catch let error as SCStreamError where error.code == .attemptToStopStreamState { return }
        try stream.removeStreamOutput(self, type: .screen)
    }

    #if SCREEN_BENCHMARK
    func finishBenchmark() {
        queue.sync {
            do { try benchmark.finish() }
            catch {
                FileHandle.standardError.write(Data("Screen benchmark failed: \(error.localizedDescription)\n".utf8))
                exit(1)
            }
        }
    }
    #endif

    func currentBounds() -> CGRect? {
        if let display = target.display {
            guard CGDisplayIsActive(display.displayID) != 0 else { return nil }
            return CGDisplayBounds(display.displayID)
        }
        guard let window = target.window else { return nil }
        guard let windows = CGWindowListCopyWindowInfo(.optionIncludingWindow, window.windowID) as? [[String: Any]],
              let entry = windows.first,
              let dictionary = entry[kCGWindowBounds as String] as? [String: Any],
              let bounds = CGRect(dictionaryRepresentation: dictionary as CFDictionary),
              let pid = entry[kCGWindowOwnerPID as String] as? Int,
              pid == Int(window.owningApplication?.processID ?? -1) else { return nil }
        return bounds
    }

    func inputGeometry() throws -> (FrameGeometry, CGRect) {
        guard let current = queue.sync(execute: { geometry }),
              let bounds = currentBounds() else {
            throw ScreenFailure(message: "The screen has no current frame or its window has closed.")
        }
        return (current, bounds)
    }

    func stream(_ stream: SCStream, didStopWithError error: Error) {
        // A stream can stop before startCapture completes, which it then never does.
        queue.async { self.settleStart(error) }
        writer.send(["type": "state", "screenId": id, "status": "ended", "reason": error.localizedDescription])
    }

    func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of type: SCStreamOutputType) {
        guard type == .screen, sampleBuffer.isValid,
              let attachments = CMSampleBufferGetSampleAttachmentsArray(sampleBuffer, createIfNecessary: false) as? [[SCStreamFrameInfo: Any]],
              let values = attachments.first,
              let status = values[.status] as? Int else { return }
        if status == SCFrameStatus.suspended.rawValue || status == SCFrameStatus.blank.rawValue {
            if frameStatus?.rawValue != status {
                frameStatus = SCFrameStatus(rawValue: status)
                writer.send(["type": "state", "screenId": id, "status": "paused",
                             "reason": "macOS has suspended capture. Unlock the host or restore the source window."])
            }
            return
        }
        guard let bounds = currentBounds() else {
            writer.send(["type": "state", "screenId": id, "status": "ended", "reason": "Screen is unavailable."])
            return
        }
        if bounds.size != configuredSize {
            fit(bounds.size)
            stream.updateConfiguration(configuration) { error in
                if let error {
                    self.writer.send(["type": "state", "screenId": self.id, "status": "ended", "reason": error.localizedDescription])
                }
            }
        }
        guard status == SCFrameStatus.complete.rawValue,
              let pixels = sampleBuffer.imageBuffer else { return }
        let frameTime = sampleBuffer.presentationTimeStamp.seconds
        let continuous = framesAreContinuous(frameTime, previous: previousFrameTime,
                                             interval: configuration.minimumFrameInterval.seconds)
        previousFrameTime = frameTime
        autoreleasepool {
            do {
                guard let contentValue = values[.contentRect] as? [String: Any],
                      let contentPoints = CGRect(dictionaryRepresentation: contentValue as CFDictionary),
                      let scale = values[.scaleFactor] as? Double,
                      contentPoints.width > 0, contentPoints.height > 0 else {
                    throw ScreenFailure(message: "The captured window has no usable geometry.")
                }
                let width = CVPixelBufferGetWidth(pixels)
                let height = CVPixelBufferGetHeight(pixels)
                // ScreenCaptureKit reports points; input mapping uses encoded pixels.
                let content = contentPoints.applying(CGAffineTransform(scaleX: scale, y: scale))
                    .intersection(CGRect(x: 0, y: 0, width: width, height: height))
                let geometryChanged = geometry?.width != width || geometry?.height != height ||
                    geometry?.content != content
                if geometryChanged {
                    geometry = FrameGeometry(width: width, height: height, content: content)
                }
                let locked = CVPixelBufferLockBaseAddress(pixels, .readOnly)
                guard locked == kCVReturnSuccess else {
                    throw ScreenFailure(message: "Unable to lock captured pixels (\(locked)).")
                }
                defer { CVPixelBufferUnlockBaseAddress(pixels, .readOnly) }
                guard let base = CVPixelBufferGetBaseAddress(pixels) else {
                    throw ScreenFailure(message: "Captured pixels are unavailable.")
                }
                // Only a window has rounded corners; a display's frame is square.
                if geometryChanged, target.window != nil { radius = cornerRadius(base, width: width) }
                let stride = CVPixelBufferGetBytesPerRow(pixels)
                let rowBytes = width * 4
                let byteCount = rowBytes * height
                #if SCREEN_BENCHMARK
                benchmark.beginFrame(width: width, height: height, geometryChanged: geometryChanged,
                                     resumed: frameStatus != .complete, sourceTime: frameTime, continuous: continuous)
                defer { benchmark.endFrame() }
                #endif
                let fullBounds = CGRect(x: 0, y: 0, width: width, height: height)
                let compared: CGRect?
                // Resume and geometry changes must be delivered even when pixels match.
                if frameStatus == .complete, !geometryChanged,
                   lastSentPixels.count == byteCount, basePixels.count == byteCount {
                    compared = try lastSentPixels.withUnsafeBytes { previous in
                        try basePixels.withUnsafeBytes { baseline throws -> CGRect? in
                            #if SCREEN_BENCHMARK
                            return try benchmark.compare(base, stride: stride, previous: previous.baseAddress!,
                                                         baseline: baseline.baseAddress!, previousRegion: previousRegion,
                                                         dirty: continuous ? values[.dirtyRects] : nil, width: width, height: height)
                            #else
                            return compareFrame(base, stride: stride, previous: previous.baseAddress!,
                                                baseline: baseline.baseAddress!, previousRegion: previousRegion,
                                                dirty: continuous ? values[.dirtyRects] : nil, width: width, height: height)
                            #endif
                        }
                    }
                } else {
                    compared = fullBounds
                }
                #if SCREEN_BENCHMARK
                benchmark.mark("comparisonMs")
                #endif
                guard var region = compared else { return }
                let full = region.width * region.height > fullBounds.width * fullBounds.height * maximumScreenRegionFraction
                if full { region = fullBounds }
                var payload = Data()
                if !region.isEmpty {
                    var image: CGImage?
                    let result = VTCreateCGImageFromCVPixelBuffer(pixels, options: nil, imageOut: &image)
                    guard result == noErr, let image = full ? image : image?.cropping(to: region) else {
                        throw ScreenFailure(message: "Unable to read captured pixels (\(result)).")
                    }
                    payload = try jpeg(image, quality: quality)
                }
                #if SCREEN_BENCHMARK
                benchmark.mark("encodeMs")
                #endif
                sequence += 1
                if full { basePixels = Data() }
                if frameStatus != .complete {
                    frameStatus = .complete
                    writer.send(["type": "state", "screenId": id, "status": "live"])
                }
                var metadata: [String: Any] = [
                    "type": "frame", "screenId": id, "sequence": sequence, "width": width, "height": height
                ]
                if radius > 0 { metadata["radius"] = radius }
                if !full {
                    metadata["region"] = ["x": Int(region.minX), "y": Int(region.minY),
                                          "width": Int(region.width), "height": Int(region.height)]
                }
                writer.send(metadata, payload: payload)
                #if SCREEN_BENCHMARK
                benchmark.mark("writeMs")
                #endif
                if lastSentPixels.count != byteCount { lastSentPixels = Data(count: byteCount) }
                lastSentPixels.withUnsafeMutableBytes { previous in
                    for row in 0..<height {
                        memcpy(previous.baseAddress!.advanced(by: row * rowBytes),
                               base.advanced(by: row * stride), rowBytes)
                    }
                }
                if full { basePixels = lastSentPixels }
                previousRegion = full ? .zero : region
                #if SCREEN_BENCHMARK
                benchmark.mark("copyMs")
                #endif
            } catch {
                writer.send(["type": "state", "screenId": id, "status": "ended", "reason": error.localizedDescription])
            }
        }
    }
}

@MainActor final class ScreenHost: NSObject {
    let writer = PacketWriter()
    private var captures: [String: ScreenCapture] = [:]
    private let eventSource = CGEventSource(stateID: .privateState)
    private var pressedKeys = Set<CGKeyCode>()
    private var pressedButtons: [Int: Int64] = [:]
    private var lastCapture: ScreenCapture?
    private var lastPoint = CGPoint.zero
    private var lastClick: (screenId: String, button: Int, point: CGPoint, time: TimeInterval, count: Int64)?

    func start() {
        AXUIElementSetMessagingTimeout(AXUIElementCreateSystemWide(), 1)
        Task {
            do {
                for try await line in FileHandle.standardInput.bytes.lines {
                    guard let request = try JSONSerialization.jsonObject(with: Data(line.utf8)) as? [String: Any] else {
                        throw ScreenFailure(message: "Invalid screen command.")
                    }
                    // Commands run one at a time, in order. Lists and thumbnails touch no capture or
                    // held input, so they run alongside instead of waiting their turn.
                    if ["list", "thumbnail"].contains(request["method"] as? String) {
                        Task { await handle(request) }
                    } else {
                        await handle(request)
                    }
                }
                shutdown()
            } catch {
                FileHandle.standardError.write(Data("Screen input failed: \(error.localizedDescription)\n".utf8))
                exit(1)
            }
        }
    }

    private func handle(_ request: [String: Any]) async {
        guard let requestID = request["id"] as? Int, let method = request["method"] as? String else {
            writer.send(["type": "reply", "requestId": 1, "ok": false, "error": "Invalid command identity."])
            return
        }
        let params = request["params"] as? [String: Any] ?? [:]
        do {
            var value: Any = NSNull()
            switch method {
            case "list":
                try requireCapturePermission()
                let content = try await SCShareableContent.excludingDesktopWindows(true, onScreenWindowsOnly: true)
                let displays = content.displays.map { ["id": "display:\($0.displayID)", "title": displayTitle($0)] }
                var windows: [[String: Any]] = []
                // Desktop widgets, the menu bar and overlays sit above or below ordinary windows' layer.
                for window in content.windows where window.windowLayer == 0 {
                    guard let app = window.owningApplication, let id = sourceID(window),
                          window.frame.width > 40, window.frame.height > 40 else { continue }
                    windows.append(["id": id, "title": windowTitle(window), "application": app.applicationName])
                }
                value = ["displays": displays, "windows": windows]
            case "start":
                try requireCapturePermission()
                guard let id = params["screenId"] as? String, captures[id] == nil else {
                    throw ScreenFailure(message: "Missing or duplicate screen.")
                }
                let (target, title) = try await screenTarget(id)
                let capture = try ScreenCapture(id: id, target: target, writer: writer,
                                                options: params["capture"] as! [String: Any])
                captures[id] = capture
                do { try await capture.start() }
                catch { captures.removeValue(forKey: id); throw error }
                value = title
            case "thumbnail":
                try requireCapturePermission()
                guard let id = params["screenId"] as? String, let size = params["size"] as? Double,
                      let quality = params["quality"] as? Double else {
                    throw ScreenFailure(message: "Invalid thumbnail request.")
                }
                let (target, _) = try await screenTarget(id)
                value = try await thumbnail(of: target, size: size, quality: quality).base64EncodedString()
            case "focus":
                try requireInputPermission()
                try await focusScreen(getCapture(params))
            case "input":
                try requireInputPermission()
                let capture = try getCapture(params)
                lastCapture = capture
                guard let actions = params["actions"] as? [[String: Any]] else {
                    throw ScreenFailure(message: "Invalid screen input batch.")
                }
                if let pid = capture.target.pid {
                    guard NSWorkspace.shared.frontmostApplication?.processIdentifier == pid else {
                        throw ScreenFailure(message: "The source app lost focus. Take control again before sending input.")
                    }
                }
                let (geometry, bounds) = try capture.inputGeometry()
                for action in actions {
                    try sendInput(action, capture: capture, geometry: geometry, bounds: bounds)
                }
            case "releaseInput":
                try releaseInput()
            case "stop":
                // Stopping a screen that never started, or already stopped, does nothing.
                if let id = params["screenId"] as? String, let capture = captures.removeValue(forKey: id) {
                    try await capture.stop()
                }
            default:
                throw ScreenFailure(message: "Unsupported screen command: \(method)")
            }
            writer.send(["type": "reply", "requestId": requestID, "ok": true, "value": value])
        } catch {
            writer.send(["type": "reply", "requestId": requestID, "ok": false, "error": error.localizedDescription])
        }
    }

    private func requireCapturePermission() throws {
        if !CGPreflightScreenCaptureAccess() {
            _ = CGRequestScreenCaptureAccess()
            if !CGPreflightScreenCaptureAccess() {
                throw ScreenFailure(message: "Allow the app running Toy Box (for example Terminal or Conduit) in System Settings > Privacy & Security > Screen & System Audio Recording, then retry. Restart Toy Box if required.")
            }
        }
    }

    private func sourceID(_ window: SCWindow) -> String? {
        guard let pid = window.owningApplication?.processID else { return nil }
        var info = proc_bsdinfo()
        guard proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, &info, Int32(MemoryLayout<proc_bsdinfo>.size)) == MemoryLayout<proc_bsdinfo>.size else { return nil }
        return "window:\(window.windowID):\(pid):\(info.pbi_start_tvsec * 1_000_000 + info.pbi_start_tvusec)"
    }

    private func requireInputPermission() throws {
        guard AXIsProcessTrustedWithOptions([kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary) else {
            throw ScreenFailure(message: "Allow the app running Toy Box (for example Terminal or Conduit) in System Settings > Privacy & Security > Accessibility, then retry.")
        }
    }

    private func displayTitle(_ display: SCDisplay) -> String {
        NSScreen.screens.first {
            ($0.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber)?.uint32Value == display.displayID
        }?.localizedName ?? "Display \(display.displayID)"
    }

    private func windowTitle(_ window: SCWindow) -> String {
        if let title = window.title, !title.isEmpty { return title }
        return window.owningApplication?.applicationName ?? "Window"
    }

    /// Resolves a screen ID to the display or window it names now, and its title.
    private func screenTarget(_ id: String) async throws -> (ScreenTarget, String) {
        let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: false)
        if let window = content.windows.first(where: { sourceID($0) == id }) {
            return (.window(window), windowTitle(window))
        }
        if let display = content.displays.first(where: { "display:\($0.displayID)" == id }) {
            return (.display(display), displayTitle(display))
        }
        throw ScreenFailure(message: "Screen is unavailable. Its display or window may have closed.")
    }

    /// A JPEG thumbnail of a screen, no more than `size` pixels on either side.
    private func thumbnail(of target: ScreenTarget, size: Double, quality: Double) async throws -> Data {
        let filter = target.filter
        let bounds = filter.contentRect.size
        let scale = min(Double(filter.pointPixelScale), size / Double(max(bounds.width, bounds.height)))
        let configuration = SCStreamConfiguration()
        configuration.width = max(1, Int(Double(bounds.width) * scale))
        configuration.height = max(1, Int(Double(bounds.height) * scale))
        configuration.showsCursor = false
        configuration.ignoreShadowsSingleWindow = true
        let image = try await SCScreenshotManager.captureImage(contentFilter: filter, configuration: configuration)
        return try jpeg(image, quality: quality)
    }

    private func focusScreen(_ capture: ScreenCapture) async throws {
        guard let pid = capture.target.pid else { return }
        guard let app = NSRunningApplication(processIdentifier: pid),
              let bounds = capture.currentBounds() else {
            throw ScreenFailure(message: "The source application has closed.")
        }
        guard app.activate(options: []) else {
            throw ScreenFailure(message: "macOS could not activate the source application.")
        }
        for _ in 0..<20 {
            if NSWorkspace.shared.frontmostApplication?.processIdentifier == pid { break }
            try await Task.sleep(nanoseconds: 10_000_000)
        }
        guard NSWorkspace.shared.frontmostApplication?.processIdentifier == pid else {
            throw ScreenFailure(message: "The source application did not receive focus.")
        }
        guard let target = try accessibilityWindow(AXUIElementCreateApplication(pid), bounds: bounds) else {
            throw ScreenFailure(message: "The selected window has no matching Accessibility window.")
        }
        guard AXUIElementPerformAction(target, kAXRaiseAction as CFString) == .success else {
            throw ScreenFailure(message: "macOS could not raise the selected window.")
        }
    }

    private func getCapture(_ params: [String: Any]) throws -> ScreenCapture {
        guard let id = params["screenId"] as? String, let capture = captures[id] else {
            throw ScreenFailure(message: "Screen not found.")
        }
        return capture
    }

    private func accessibilityWindow(_ app: AXUIElement, bounds: CGRect) throws -> AXUIElement? {
        var value: CFTypeRef?
        let result = AXUIElementCopyAttributeValue(app, kAXWindowsAttribute as CFString, &value)
        guard result == .success else {
            throw ScreenFailure(message: "Unable to read the application's windows (\(result.rawValue)).")
        }
        for window in value as? [AXUIElement] ?? [] {
            var values: CFArray?
            guard AXUIElementCopyMultipleAttributeValues(window, [kAXPositionAttribute, kAXSizeAttribute] as CFArray, [], &values) == .success,
                  let attributes = values as? [CFTypeRef], attributes.count == 2,
                  CFGetTypeID(attributes[0]) == AXValueGetTypeID(),
                  CFGetTypeID(attributes[1]) == AXValueGetTypeID() else { continue }
            var position = CGPoint.zero
            var size = CGSize.zero
            if AXValueGetValue(attributes[0] as! AXValue, .cgPoint, &position),
               AXValueGetValue(attributes[1] as! AXValue, .cgSize, &size),
               CGRect(origin: position, size: size) == bounds { return window }
        }
        return nil
    }

    private var modifiers: CGEventFlags {
        var flags: CGEventFlags = []
        if !pressedKeys.isDisjoint(with: [55, 54]) { flags.insert(.maskCommand) }
        if !pressedKeys.isDisjoint(with: [56, 60]) { flags.insert(.maskShift) }
        if !pressedKeys.isDisjoint(with: [58, 61]) { flags.insert(.maskAlternate) }
        if !pressedKeys.isDisjoint(with: [59, 62]) { flags.insert(.maskControl) }
        return flags
    }

    private func post(_ event: CGEvent?, to capture: ScreenCapture, clickCount: Int64 = 0) throws {
        guard let event else {
            throw ScreenFailure(message: "Unable to create a native input event.")
        }
        event.flags = modifiers
        event.setIntegerValueField(.mouseEventClickState, value: clickCount)
        if let window = capture.target.window {
            event.setIntegerValueField(.mouseEventWindowUnderMousePointer, value: Int64(window.windowID))
            event.setIntegerValueField(.mouseEventWindowUnderMousePointerThatCanHandleThisEvent, value: Int64(window.windowID))
        }
        event.post(tap: .cghidEventTap)
    }

    private func sendInput(_ action: [String: Any], capture: ScreenCapture, geometry: FrameGeometry, bounds: CGRect) throws {
        guard let type = action["type"] as? String else { throw ScreenFailure(message: "Missing input type.") }
        if type == "pointer" || type == "scroll" {
            guard let x = action["x"] as? Double, let y = action["y"] as? Double else {
                throw ScreenFailure(message: "Missing pointer coordinates.")
            }
            let pixel = CGPoint(x: x * Double(geometry.width), y: y * Double(geometry.height))
            guard geometry.content.contains(pixel) else { throw ScreenFailure(message: "Pointer is outside the captured content.") }
            lastPoint = CGPoint(x: bounds.minX + (pixel.x - geometry.content.minX) / geometry.content.width * bounds.width,
                                y: bounds.minY + (pixel.y - geometry.content.minY) / geometry.content.height * bounds.height)
        }
        switch type {
        case "pointer":
            guard let phase = action["phase"] as? String else {
                throw ScreenFailure(message: "Invalid pointer phase.")
            }
            let button = phase == "move"
                ? [0, 2, 1].first(where: { pressedButtons[$0] != nil }) ?? 0
                : action["button"] as? Int ?? 0
            try sendPointer(phase, button: button, capture: capture)
        case "scroll":
            let event = CGEvent(scrollWheelEvent2Source: eventSource, units: .pixel, wheelCount: 2,
                                wheel1: Int32(-(action["dy"] as? Double ?? 0)),
                                wheel2: Int32(-(action["dx"] as? Double ?? 0)), wheel3: 0)
            event?.location = lastPoint
            try post(event, to: capture)
        case "key":
            guard let name = action["code"] as? String, let code = keyCodes[name], let down = action["down"] as? Bool else {
                throw ScreenFailure(message: "Unsupported physical key.")
            }
            if down { pressedKeys.insert(code) } else { pressedKeys.remove(code) }
            try post(CGEvent(keyboardEventSource: eventSource, virtualKey: code, keyDown: down), to: capture)
        case "text":
            guard let text = action["text"] as? String else {
                throw ScreenFailure(message: "Invalid text input.")
            }
            let characters = Array(text.utf16)
            for down in [true, false] {
                let event = CGEvent(keyboardEventSource: eventSource, virtualKey: 0, keyDown: down)
                characters.withUnsafeBufferPointer { event?.keyboardSetUnicodeString(stringLength: $0.count, unicodeString: $0.baseAddress) }
                try post(event, to: capture)
            }
        default:
            throw ScreenFailure(message: "Unsupported input type.")
        }
    }

    private func sendPointer(_ phase: String, button: Int, capture: ScreenCapture) throws {
        guard (0...2).contains(button) else { throw ScreenFailure(message: "Invalid pointer input.") }
        let nativeButton: CGMouseButton = button == 1 ? .center : button == 2 ? .right : .left
        let eventType: CGEventType
        var clickCount: Int64 = 0
        if phase == "down" {
            let now = ProcessInfo.processInfo.systemUptime
            if let previous = lastClick, previous.screenId == capture.id, previous.button == button,
               now - previous.time <= NSEvent.doubleClickInterval,
               hypot(lastPoint.x - previous.point.x, lastPoint.y - previous.point.y) <= 4 {
                clickCount = previous.count + 1
            } else {
                clickCount = 1
            }
            lastClick = (capture.id, button, lastPoint, now, clickCount)
            pressedButtons[button] = clickCount
            eventType = button == 0 ? .leftMouseDown : button == 2 ? .rightMouseDown : .otherMouseDown
        } else if phase == "up" {
            clickCount = pressedButtons.removeValue(forKey: button) ?? 1
            eventType = button == 0 ? .leftMouseUp : button == 2 ? .rightMouseUp : .otherMouseUp
        } else if phase == "move" {
            eventType = pressedButtons[0] != nil ? .leftMouseDragged :
                        pressedButtons[2] != nil ? .rightMouseDragged :
                        pressedButtons[1] != nil ? .otherMouseDragged : .mouseMoved
        } else { throw ScreenFailure(message: "Invalid pointer phase.") }
        try post(CGEvent(mouseEventSource: eventSource, mouseType: eventType,
                         mouseCursorPosition: lastPoint, mouseButton: nativeButton),
                 to: capture, clickCount: clickCount)
    }

    private func releaseInput() throws {
        guard let capture = lastCapture else { return }
        for key in Array(pressedKeys) {
            pressedKeys.remove(key)
            try post(CGEvent(keyboardEventSource: eventSource, virtualKey: key, keyDown: false), to: capture)
        }
        for (button, count) in Array(pressedButtons) {
            try post(CGEvent(mouseEventSource: eventSource,
                             mouseType: button == 0 ? .leftMouseUp : button == 2 ? .rightMouseUp : .otherMouseUp,
                             mouseCursorPosition: lastPoint, mouseButton: button == 1 ? .center : button == 2 ? .right : .left), to: capture, clickCount: count)
            pressedButtons.removeValue(forKey: button)
        }
        lastCapture = nil
    }

    private func shutdown() -> Never {
        do { try releaseInput() }
        catch { FileHandle.standardError.write(Data("Unable to release screen input: \(error.localizedDescription)\n".utf8)) }
        #if SCREEN_BENCHMARK
        for capture in captures.values { capture.finishBenchmark() }
        #endif
        exit(0)
    }
}

private let keyCodes: [String: CGKeyCode] = [
    "KeyA": 0, "KeyS": 1, "KeyD": 2, "KeyF": 3, "KeyH": 4, "KeyG": 5, "KeyZ": 6,
    "KeyX": 7, "KeyC": 8, "KeyV": 9, "KeyB": 11, "KeyQ": 12, "KeyW": 13, "KeyE": 14,
    "KeyR": 15, "KeyY": 16, "KeyT": 17, "Digit1": 18, "Digit2": 19, "Digit3": 20,
    "Digit4": 21, "Digit6": 22, "Digit5": 23, "Equal": 24, "Digit9": 25, "Digit7": 26,
    "Minus": 27, "Digit8": 28, "Digit0": 29, "BracketRight": 30, "KeyO": 31, "KeyU": 32,
    "BracketLeft": 33, "KeyI": 34, "KeyP": 35, "Enter": 36, "KeyL": 37, "KeyJ": 38,
    "Quote": 39, "KeyK": 40, "Semicolon": 41, "Backslash": 42, "Comma": 43,
    "Slash": 44, "KeyN": 45, "KeyM": 46, "Period": 47, "Tab": 48, "Space": 49,
    "Backquote": 50, "Backspace": 51, "Escape": 53, "MetaRight": 54, "MetaLeft": 55,
    "ShiftLeft": 56, "CapsLock": 57, "AltLeft": 58, "ControlLeft": 59, "ShiftRight": 60,
    "AltRight": 61, "ControlRight": 62, "NumpadDecimal": 65, "NumpadMultiply": 67,
    "NumpadAdd": 69, "NumLock": 71, "NumpadDivide": 75, "NumpadEnter": 76,
    "NumpadSubtract": 78, "NumpadEqual": 81, "Numpad0": 82, "Numpad1": 83,
    "Numpad2": 84, "Numpad3": 85, "Numpad4": 86, "Numpad5": 87, "Numpad6": 88,
    "Numpad7": 89, "Numpad8": 91, "Numpad9": 92, "F5": 96, "F6": 97, "F7": 98,
    "F3": 99, "F8": 100, "F9": 101, "F11": 103, "F10": 109, "F12": 111,
    "Home": 115, "PageUp": 116, "Delete": 117, "F4": 118, "End": 119, "F2": 120,
    "PageDown": 121, "F1": 122, "ArrowLeft": 123, "ArrowRight": 124, "ArrowDown": 125,
    "ArrowUp": 126
]

#if SCREEN_BENCHMARK
if CommandLine.arguments.contains("--verify") {
    do { try verifyChangedRegions(); exit(0) }
    catch {
        FileHandle.standardError.write(Data("\(error.localizedDescription)\n".utf8))
        exit(1)
    }
}
#endif

signal(SIGPIPE, SIG_IGN)
// Ctrl+C in a terminal signals the server's whole process group. The server ends this
// helper by closing its stdin, so it can release held input first.
signal(SIGINT, SIG_IGN)
MainActor.assumeIsolated {
    let application = NSApplication.shared
    application.setActivationPolicy(.accessory)
    let host = ScreenHost()
    host.start()
    application.run()
}
