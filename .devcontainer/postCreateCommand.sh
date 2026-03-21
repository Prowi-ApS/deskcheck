#!/bin/bash

set -e

cd /home/vscode/project

# Ensure correct ownership of key directories
sudo chown -R vscode:vscode /home/vscode/project/node_modules

# Install Node dependencies
if [ -f /home/vscode/project/package.json ]; then
  echo "package.json found, running npm install..."
  npm install
else
  echo "No package.json found, skipping npm install."
fi
