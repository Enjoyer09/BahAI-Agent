import Foundation
import WebKit

// Global registry for all spawned processes (so they can be cleaned up on app quit)
final class ProcessRegistry {
    static let shared = ProcessRegistry()
    private var processes: [Process] = []
    private let lock = NSLock()

    private init() {}

    func register(_ process: Process) {
        lock.lock()
        processes.append(process)
        lock.unlock()
    }

    func terminateAll() {
        lock.lock()
        for process in processes where process.isRunning {
            print("[bahAI] Killing registered process (PID: \(process.processIdentifier))")
            process.terminate()
        }
        processes.removeAll()
        lock.unlock()
    }
}

class WKBridgeMessageHandler: NSObject, WKScriptMessageHandler {

    func userContentController(_ userContentController: WKUserContentController,
                             didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any],
              let action = body["action"] as? String else {
            print("[Bridge] Invalid message format")
            return
        }

        print("[Bridge] Received: \(action)")

        switch action {
        case "getSystemInfo":
            respond(message: message, data: getSystemInfo())

        case "getAppVersion":
            respond(message: message, data: [
                "version": Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "1.0.0",
                "build": Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "1"
            ])

        case "getProjectRoot":
            respond(message: message, data: ["path": getProjectRoot()])

        case "openExternal":
            if let urlString = body["url"] as? String,
               let url = URL(string: urlString) {
                NSWorkspace.shared.open(url)
            }

        case "selectDirectory":
            selectDirectory { path in
                self.respond(message: message, data: ["path": path ?? ""])
            }

        case "selectFile":
            selectFile { path in
                self.respond(message: message, data: ["path": path ?? ""])
            }

        case "runCommand":
            if let cmd = body["command"] as? String {
                runBashCommand(cmd) { output in
                    self.respond(message: message, data: ["output": output])
                }
            }

        case "getEnvVars":
            respond(message: message, data: getEnvVars())

        default:
            print("[Bridge] Unknown action: \(action)")
        }
    }

    private func respond(message: WKScriptMessage, data: [String: Any]) {
        guard let webView = message.webView,
              let jsonData = try? JSONSerialization.data(withJSONObject: data),
              let jsonString = String(data: jsonData, encoding: .utf8) else {
            return
        }

        let escapedName = message.name
            .replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "'", with: "\\'")
        let js = "window.bahAIResponse?.('\(escapedName)', \(jsonString))"
        webView.evaluateJavaScript(js) { _, error in
            if let error = error {
                print("[Bridge] Response error: \(error)")
            }
        }
    }

    // MARK: - System Info

    private func getSystemInfo() -> [String: Any] {
        let os = ProcessInfo.processInfo.operatingSystemVersion
        let homeDir = FileManager.default.homeDirectoryForCurrentUser.path

        return [
            "platform": "macos",
            "version": "\(os.majorVersion).\(os.minorVersion).\(os.patchVersion)",
            "homeDir": homeDir,
            "username": NSUserName(),
            "hostname": Host.current().localizedName ?? "unknown",
            "arch": HardwareUtils.getCPUArchitecture(),
            "cpuCount": ProcessInfo.processInfo.processorCount,
            "memory": HardwareUtils.getTotalMemory()
        ]
    }

    // MARK: - File Dialogs

    private func selectDirectory(completion: @escaping (String?) -> Void) {
        DispatchQueue.main.async {
            let panel = NSOpenPanel()
            panel.canChooseFiles = false
            panel.canChooseDirectories = true
            panel.allowsMultipleSelection = false
            panel.message = "Select a directory"

            if panel.runModal() == .OK {
                completion(panel.url?.path)
            } else {
                completion(nil)
            }
        }
    }

    private func selectFile(completion: @escaping (String?) -> Void) {
        DispatchQueue.main.async {
            let panel = NSOpenPanel()
            panel.canChooseDirectories = false
            panel.canChooseFiles = true
            panel.allowsMultipleSelection = false

            if panel.runModal() == .OK {
                completion(panel.url?.path)
            } else {
                completion(nil)
            }
        }
    }

    // MARK: - Bash Commands

    private func runBashCommand(_ command: String, completion: @escaping (String) -> Void) {
        let confirmed = DispatchQueue.main.sync {
            let alert = NSAlert()
            alert.messageText = "Execute command?"
            alert.informativeText = "The web app wants to run:\n\n\(command)"
            alert.alertStyle = .warning
            alert.addButton(withTitle: "Allow")
            alert.addButton(withTitle: "Deny")
            return alert.runModal() == .alertFirstButtonReturn
        }

        guard confirmed else {
            completion("Command denied by user")
            return
        }

        DispatchQueue.global(qos: .userInitiated).async {
            let task = Process()
            task.executableURL = URL(fileURLWithPath: "/bin/bash")
            task.arguments = ["-c", command]
            task.qualityOfService = .userInitiated

            let pipe = Pipe()
            task.standardOutput = pipe
            task.standardError = pipe

            ProcessRegistry.shared.register(task)

            let timeoutWork = DispatchWorkItem { [weak task] in
                if task?.isRunning == true {
                    print("[Bridge] Command timed out, killing process")
                    task?.terminate()
                }
            }

            do {
                try task.run()

                DispatchQueue.global().asyncAfter(deadline: .now() + 30, execute: timeoutWork)

                task.waitUntilExit()
                timeoutWork.cancel()

                pipe.fileHandleForReading.readabilityHandler = nil
                let data = pipe.fileHandleForReading.availableData
                let output = String(data: data, encoding: .utf8) ?? ""

                let maxLength = 100_000
                if output.count > maxLength {
                    let truncated = String(output.prefix(maxLength))
                    completion(truncated + "\n... [output truncated]")
                } else {
                    completion(output)
                }
            } catch {
                timeoutWork.cancel()
                completion("Error: \(error.localizedDescription)")
            }
        }
    }

    // MARK: - Helpers

    private func getProjectRoot() -> String {
        if let bundlePath = Bundle.main.resourcePath {
            return (bundlePath as NSString).deletingLastPathComponent
        }
        return FileManager.default.currentDirectoryPath
    }

    private func getEnvVars() -> [String: String] {
        let keys = ["PATH", "HOME", "USER", "SHELL", "LANG", "PWD"]
        var vars: [String: String] = [:]
        for key in keys {
            vars[key] = ProcessInfo.processInfo.environment[key]
        }
        return vars
    }
}

// MARK: - Hardware Utilities

enum HardwareUtils {
    static func getCPUArchitecture() -> String {
        var size = 0
        sysctlbyname("hw.machine", nil, &size, nil, 0)
        var machine = [CChar](repeating: 0, count: size)
        sysctlbyname("hw.machine", &machine, &size, nil, 0)
        return String(cString: machine)
    }

    static func getTotalMemory() -> Int64 {
        var size: Int64 = 0
        var sizeOfSize = MemoryLayout<Int64>.size
        sysctlbyname("hw.memsize", &size, &sizeOfSize, nil, 0)
        return size
    }
}
