# Project: Boncuk.js

## Project Overview

BoncukJS is a real-time speech-to-text transcription application built with SolidJS, Vite, and Tailwind CSS. It features client-side audio processing and transcription using the Parakeet.js library, which runs Nvidia Nemo Parakeet based (parakeet TDT 0.6 v2 for now) models directly in the browser using WebGPU/WASM. The developer of the Parakeet.js package is also the developer of this project.

The application captures audio from the user's microphone, processes it in real-time, and provides live transcription with sentence boundary detection. It also integrates with Google's Gemini API for post-processing and analysis of transcribed text.

Key features include:
- Real-time audio capture and processing
- Client-side speech transcription using Parakeet.js
- Sentence boundary detection and processing
- Live transcription visualization
- Model configuration and management
- Dark/light theme support
- Audio waveform visualization
- Integration with Google Gemini for text processing

## Building and Running

### Prerequisites

*   Node.js and npm (or pnpm/yarn)

### Installation

```bash
npm install
```

### Development

To run the application in development mode, use the following command:

```bash
npm run dev
```

This will start a Vite development server on `https://localhost:3003`.

### Production

To build the application for production, use the following command:

```bash
npm run build
```

This will create a `dist` directory with the production-ready files. To serve the production build, use the following command:

```bash
npm run serve
```

## Development Conventions

*   **Framework:** Solid.js
*   **Build Tool:** Vite
*   **Styling:** Tailwind CSS
*   **State Management:** Solid.js Stores
*   **Code Style:** The project uses a consistent code style, with a focus on functional components and clear separation of concerns.
*   **Web Workers:** The application is in the process of moving its core ASR functionality to a web worker to improve UI responsiveness. This work is being tracked in `docs/BrowserASRWorkerPlan.md`.
*   **Client-Side:** The application is designed to be fully client-side, with no backend server required for the core transcription functionality.
*   **HTTPS:** The development server is configured to use HTTPS, which is necessary for accessing the user's microphone.


## Usage

Those templates dependencies are maintained via [pnpm](https://pnpm.io) via `pnpm up -Lri`.

This is the reason you see a `pnpm-lock.yaml`. That being said, any package manager will work. This file can be safely be removed once you clone a template.

```bash
$ npm install # or pnpm install or yarn install
```

### Learn more on the [Solid Website](https://solidjs.com) and come chat with us on our [Discord](https://discord.com/invite/solidjs)

## Available Scripts

In the project directory, you can run:

### `npm run dev` or `npm start`

Runs the app in the development mode.<br>
Open [http://localhost:3000](http://localhost:3000) to view it in the browser.

The page will reload if you make edits.<br>

### `npm run build`

Builds the app for production to the `dist` folder.<br>
It correctly bundles Solid in production mode and optimizes the build for the best performance.

The build is minified and the filenames include the hashes.<br>
Your app is ready to be deployed!

## Deployment

You can deploy the `dist` folder to any static host provider (netlify, surge, now, etc.)
