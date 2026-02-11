# Local Development Setup for keet + parakeet.js

This guide explains how to develop keet while simultaneously making changes to the parakeet.js library.

## Prerequisites

Ensure your folder structure looks like this:

```
github/ysdede/
├── keet/              # This project
└── parakeet.js/       # The parakeet.js library source
```

## Installation

### 1. Install dependencies in both projects

```bash
# In keet
cd keet
npm install

# In parakeet.js (if not already done)
cd ../parakeet.js
npm install
```

## Running Modes

### Production Mode (NPM Package)

Uses the official `parakeet.js@1.0.1` from NPM:

```bash
npm run dev
```

This is the standard mode for normal development and testing against the stable library version.

### Local Development Mode (Source Code)

Uses the local parakeet.js source code from `../parakeet.js/src/index.js`:

```bash
npm run dev:local
```

**Benefits:**
- Changes to `parakeet.js/src/*.js` are instantly reflected (HMR)
- No need to rebuild or publish the library
- Perfect for debugging and feature development

## Build Commands

```bash
# Build with NPM parakeet.js
npm run build

# Build with local parakeet.js (for testing)
npm run build:local
```

## How It Works

The `vite.config.js` checks the `USE_LOCAL_PARAKEET` environment variable:

- When `false` (default): Uses `parakeet.js` from `node_modules/`
- When `true`: Aliases `parakeet.js` to `../parakeet.js/src/index.js`

### Console Output

When starting the dev server, you'll see:

```
📦 Using NPM parakeet.js (v1.0.1)      # npm run dev
🔗 Using LOCAL parakeet.js from: ...   # npm run dev:local
```

## Troubleshooting

### "LOCAL mode requested but parakeet.js not found"

Make sure the folder structure is correct:
- `keet` and `parakeet.js` must be sibling directories
- The path should be `../parakeet.js/src/index.js` relative to keet

### HTTPS Certificate Errors

For local development with HTTPS (required for some browser APIs):

```bash
# Install mkcert
choco install mkcert  # Windows
brew install mkcert   # macOS

# Generate certificates
mkcert -install
mkcert localhost
```

Place `localhost.pem` and `localhost-key.pem` in the keet root.

### Model Loading Issues

If models fail to load in local mode, ensure:
1. `onnxruntime-web` version matches in both projects
2. The local parakeet.js has been built at least once (`npm run build` in parakeet.js)

## Version Compatibility

| keet | parakeet.js | onnxruntime-web |
|----------|-------------|-----------------|
| 0.1.0    | 1.0.1       | 1.22.0-dev.20250409-89f8206ba4 |

## Switching Between Modes

You can switch modes at any time by stopping the server and running the other command. No additional setup is needed.

```bash
# Stop current server (Ctrl+C), then:
npm run dev        # Switch to NPM mode
# or
npm run dev:local  # Switch to local mode
```
