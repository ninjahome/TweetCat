#!/bin/bash

# Configuration
HOST_NAME="com.tweetcat.ata_miner"
# Adjust the build path dynamically or use the fixed path if preferred
BUILD_PATH="$(swift build --show-bin-path)/ata_miner"
MANIFEST_NAME="${HOST_NAME}.json"
TARGET_DIR="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"

# Ensure target directory exists
mkdir -p "$TARGET_DIR"

# Generate the manifest with the correct absolute path
echo "Generating manifest for host: $HOST_NAME..."
cat > "$MANIFEST_NAME" <<EOF
{
  "name": "$HOST_NAME",
  "description": "TweetCat ATA Miner Native Host (Dev)",
  "path": "$BUILD_PATH",
  "type": "stdio",
  "allowed_origins": [
    "chrome-extension://gjdlclglpkjibapaafmfifnkjpmgodli/",
    "chrome-extension://nljmkhkgpmecnjoikfcgfkhkbpocceed/" 
  ]
}
EOF
# Note: Added a common development ID placeholder or your specific dev ID above. 
# You might need to check chrome://extensions to get your actual dev ID.

# Copy manifest to Chrome's NativeMessagingHosts directory
cp "$MANIFEST_NAME" "$TARGET_DIR/"

echo "----------------------------------------------------------------"
echo "✅ Installed Native Messaging Host: $HOST_NAME"
echo "   Manifest Path: $TARGET_DIR/$MANIFEST_NAME"
echo "   Executable:    $BUILD_PATH"
echo "----------------------------------------------------------------"
echo "⚠️  IMPORTANT: Please check your extension ID in chrome://extensions"
echo "    and execute: code $TARGET_DIR/$MANIFEST_NAME"
echo "    to add your ID to 'allowed_origins' if it differs."
echo "----------------------------------------------------------------"
