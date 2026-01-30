import sys
import struct
import json
import subprocess
import os

# Configuration: Path to your Swift executable
SWIFT_EXEC_PATH = "local_app/ata_miner/.build/x86_64-apple-macosx/debug/ata_miner"
# Adjust if needed based on the previous output: "/Users/hyperorchid/ninja/TweetCat/local_app/ata_miner/.build/x86_64-apple-macosx/debug/ata_miner"

FULL_PATH = os.path.abspath(SWIFT_EXEC_PATH)

def send_message(proc, message):
    # Prepare message
    json_bytes = json.dumps(message).encode('utf-8')
    length = len(json_bytes)
    
    # Write length (4 bytes, little-endian)
    proc.stdin.write(struct.pack('<I', length))
    # Write content
    proc.stdin.write(json_bytes)
    proc.stdin.flush()

def read_message(proc):
    # Read length
    raw_length = proc.stdout.read(4)
    if not raw_length:
        return None
    length = struct.unpack('<I', raw_length)[0]
    
    # Read content
    content = proc.stdout.read(length)
    return json.loads(content)

def main():
    if not os.path.exists(FULL_PATH):
        print(f"Error: Executable not found at {FULL_PATH}")
        print("Please verify the path or run `swift build`.")
        return

    print(f"Starting process: {FULL_PATH}")
    proc = subprocess.Popen(
        [FULL_PATH],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=sys.stderr  # Let stderr flow to console directly
    )

    try:
        # Test 1: PING
        print("\n--- Sending PING ---")
        ping_req = {"cmd": "ping", "trace_id": "test-trace-001"}
        send_message(proc, ping_req)
        response = read_message(proc)
        print("Received:", json.dumps(response, indent=2))

        # Test 2: FOLLOW_CLAIM
        print("\n--- Sending FOLLOW_CLAIM ---")
        claim_req = {
            "cmd": "follow_claim",
            "trace_id": "test-trace-002",
            "payload": {
                "task_payload": "{\"kolName\": \"elonmusk\"}",
                "headers": "{\"authorization\": \"Bearer XYZ\"}",
                "cookies": "[{\"name\": \"auth_token\", \"value\": \"123\"}]"
            }
        }
        send_message(proc, claim_req)
        response = read_message(proc)
        print("Received:", json.dumps(response, indent=2))

    except Exception as e:
        print(f"Error: {e}")
    finally:
        proc.terminate()

if __name__ == "__main__":
    main()
