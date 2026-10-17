import Foundation

final class BackendService {
    private var process: Process?
    private(set) var isRunning = false

    func start(projectRoot: String) {
        guard !isRunning else { return }

        print("[bahAI] Starting backend server...")

        let backendPath = (projectRoot as NSString).appendingPathComponent("backend")
        let indexScript = (backendPath as NSString).appendingPathComponent("index.js")

        guard FileManager.default.fileExists(atPath: indexScript) else {
            print("[bahAI] ERROR: Backend not found at \(indexScript)")
            return
        }

        guard let nodeURL = Self.findNodeExecutable() else {
            print("[bahAI] ERROR: node executable not found")
            return
        }

        let proc = Process()
        proc.executableURL = nodeURL
        proc.arguments = [indexScript]
        proc.currentDirectoryURL = URL(fileURLWithPath: backendPath)

        let pipe = Pipe()
        proc.standardOutput = pipe
        proc.standardError = pipe

        let outHandle = pipe.fileHandleForReading
        outHandle.readabilityHandler = { handle in
            let data = handle.availableData
            if let str = String(data: data, encoding: .utf8), !str.isEmpty {
                print("[backend] \(str.trimmingCharacters(in: .whitespacesAndNewlines))")
            }
        }

        do {
            try proc.run()
            process = proc
            isRunning = true
            print("[bahAI] Backend started (PID: \(proc.processIdentifier))")
        } catch {
            print("[bahAI] ERROR starting backend: \(error)")
        }
    }

    func stop() {
        guard isRunning else { return }
        print("[bahAI] Stopping backend...")
        if let proc = process {
            proc.terminate()
            if proc.isRunning {
                proc.waitUntilExit()
            }
        }
        process = nil
        isRunning = false
    }

    static func findNodeExecutable() -> URL? {
        if let envPath = ProcessInfo.processInfo.environment["PATH"] {
            for dir in envPath.split(separator: ":") {
                let candidate = "\(dir)/node"
                if FileManager.default.isExecutableFile(atPath: candidate) {
                    return URL(fileURLWithPath: candidate)
                }
            }
        }

        let fallbacks = [
            "/opt/homebrew/bin/node",
            "/usr/local/bin/node",
            "/usr/bin/node"
        ]
        for path in fallbacks where FileManager.default.isExecutableFile(atPath: path) {
            return URL(fileURLWithPath: path)
        }
        return nil
    }

    static func findProjectRoot() -> String {
        if let bundlePath = Bundle.main.resourcePath {
            let parent = (bundlePath as NSString).deletingLastPathComponent
            if FileManager.default.fileExists(atPath: (parent as NSString).appendingPathComponent("backend/index.js")) {
                return parent
            }
        }

        if let envProject = ProcessInfo.processInfo.environment["BAHAI_PROJECT_ROOT"],
           FileManager.default.fileExists(atPath: (envProject as NSString).appendingPathComponent("backend/index.js")) {
            return envProject
        }

        return FileManager.default.currentDirectoryPath
    }
}
