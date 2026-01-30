import Foundation

// MARK: - Protocol Types

struct NativeRequest: Codable {
    let cmd: String
    let trace_id: String?
    let payload: [String: String]? // Adjust payload structure as needed based on actual requirements
}

struct NativeResponse: Codable {
    let ok: Bool
    let error_code: Int?
    let trace_id: String?
    let data: [String: String]?
    
    static func success(traceId: String?, data: [String: String]? = nil) -> NativeResponse {
        return NativeResponse(ok: true, error_code: 0, trace_id: traceId, data: data)
    }
    
    static func error(traceId: String?, code: Int, message: String) -> NativeResponse {
        // Returning message in data for now as specific field wasn't requested but usually helpful
        return NativeResponse(ok: false, error_code: code, trace_id: traceId, data: ["message": message])
    }
}

// MARK: - Native Messaging Helpers

class NativeMessagingHost {
    
    func run() {
        log("Native Messaging Host started.")
        let input = FileHandle.standardInput
        
        while true {
            // 1. Read the first 4 bytes (Length)
            let lengthData = input.readData(ofLength: 4)
            if lengthData.count < 4 {
                log("Input stream ended or insufficient data for length prefix.")
                break
            }
            
            // Native messaging length is usually little-endian
            let length = lengthData.withUnsafeBytes { $0.load(as: UInt32.self) }
            
            if length == 0 {
                continue
            }
            
            // 2. Read the content JSON based on length
            let contentData = input.readData(ofLength: Int(length))
            if contentData.count < length {
                log("Failed to complete message read.")
                break
            }
            
            // 3. Process Request
            handleMessage(data: contentData)
        }
    }
    
    private func handleMessage(data: Data) {
        let decoder = JSONDecoder()
        do {
            let request = try decoder.decode(NativeRequest.self, from: data)
            processCommand(request)
        } catch {
            log("Failed to decode JSON: \(error)")
            sendError(traceId: nil, code: 400, message: "Invalid JSON format")
        }
    }
    
    private func processCommand(_ request: NativeRequest) {
        log("Received command: \(request.cmd)")
        
        switch request.cmd {
        case "ping":
            sendResponse(.success(traceId: request.trace_id, data: ["status": "pong"]))
            
        case "follow_claim":
            // TODO: Implement actual MPC-TLS and Prover logic here
            log("Processing follow_claim...")
            // Mock success for now
            sendResponse(.success(traceId: request.trace_id, data: ["status": "claim_initiated"]))
            
        default:
            sendError(traceId: request.trace_id, code: 404, message: "Unknown command: \(request.cmd)")
        }
    }
    
    private func sendResponse(_ response: NativeResponse) {
        let encoder = JSONEncoder()
        do {
            let jsonData = try encoder.encode(response)
            sendMessage(jsonData)
        } catch {
            log("Failed to encode response: \(error)")
        }
    }
    
    private func sendError(traceId: String?, code: Int, message: String) {
        let response = NativeResponse.error(traceId: traceId, code: code, message: message)
        sendResponse(response)
    }
    
    private func sendMessage(_ data: Data) {
        // 1. Prepare Length (4 bytes, little-endian)
        var length = UInt32(data.count)
        let lengthData = Data(bytes: &length, count: 4)
        
        // 2. Write to Standard Output
        FileHandle.standardOutput.write(lengthData)
        FileHandle.standardOutput.write(data)
    }
    
    private func log(_ message: String) {
        let formatter = DateFormatter()
        formatter.dateFormat = "HH:mm:ss"
        let timestamp = formatter.string(from: Date())
        
        let logMessage = "[ATA_MINER \(timestamp)] \(message)\n"
        
        // 1. Write to Stderr (Native Messaging standard for non-protocol output)
        if let data = logMessage.data(using: .utf8) {
            FileHandle.standardError.write(data)
        }
        
        // 2. Write to File (for easier tail -f debugging)
        // Note: For production, this should probably be behind a debug flag or use OS logging.
        let logFileURL = URL(fileURLWithPath: "/tmp/ata_miner.log")
        if let fileHandle = try? FileHandle(forWritingTo: logFileURL) {
            fileHandle.seekToEndOfFile()
            if let data = logMessage.data(using: .utf8) {
                fileHandle.write(data)
            }
            fileHandle.closeFile()

        } else {
            // File setup for the first time
            try? logMessage.write(to: logFileURL, atomically: true, encoding: .utf8)
        }
    }
}

// MARK: - Entry Point

@main
struct ata_miner {
    static func main() {
        let host = NativeMessagingHost()
        host.run()
    }
}
