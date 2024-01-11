# mediasoup-client-aiortc

[![][npm-shield-mediasoup-client-aiortc]][npm-mediasoup-client-aiortc]
[![][github-actions-shield-mediasoup-client-aiortc]][github-actions-mediasoup-client-aiortc]
[![][opencollective-shield-mediasoup]][opencollective-mediasoup]

[mediasoup-client](https://github.com/versatica/mediasoup-client/) handler for [aiortc](https://github.com/aiortc/aiortc/) Python library. Suitable for building Node.js applications that connect to a mediasoup server using WebRTC and exchange real audio, video and DataChannel messages with it in both directions.

## Requirements

- Python 3.

## Installation

Install **mediasoup-client-aiortc** within your Node.js application:

```bash
npm install mediasoup-client-aiortc
```

The "postinstall" script in `package.json` will install the Python libraries (including **aiortc**). You can override the path to `python` executable by setting the `PYTHON` environment variable:

```bash
PYTHON=/home/me/bin/python3.13 npm install mediasoup-client-aiortc
```

Same once you run your Node.js application. **mediasoup-client-aiortc** will spawn Python processes and communicate with them via `UnixSocket`. You can override the `python` executable path by setting the `PYTHON` environment variable:

```bash
PYTHON=/home/me/bin/python3.13 node my_app.js
```

## API

```javascript
// ES6 style.
import {
	createWorker,
	Worker,
	WorkerSettings,
	WorkerLogLevel,
	AiortcMediaStream,
	AiortcMediaStreamConstraints,
	AiortcMediaTrackConstraints,
} from 'mediasoup-client-aiortc';

// CommonJS style.
const {
	createWorker,
	Worker,
	WorkerSettings,
	WorkerLogLevel,
	AiortcMediaStream,
	AiortcMediaStreamConstraints,
	AiortcMediaTrackConstraints,
} = require('mediasoup-client-aiortc');
```

### `async createWorker(settings: WorkerSettings)` function

Creates a **mediasoup-client-aiortc** `Worker` instance. Each `Worker` spawns and manages a Python subprocess.

> `@async`
>
> `@returns` Worker

```typescript
const worker = await createWorker({
	logLevel: 'warn',
});
```

### `Worker` class

The `Worker` class. It represents a separate Python subprocess that can provide the Node.js application with audio/video tracks and **mediasoup-client** `handlers`.

#### `worker.pid` getter

The Python subprocess PID.

> `@type` String, read only

#### `worker.closed` getter

Whether the subprocess is closed.

#### `worker.died` getter

Whether the subprocess died unexpectedly (probably a bug somewhere).

#### `worker.subprocessClosed` getter

Whether the subprocessed is closed. It becomes `true` once the worker subprocess is completely closed and 'subprocessclose' event fires.

> `@type` Boolean, read only

#### `worker.close()` method

Closes the subprocess and all its open resources (such as audio/video tracks and **mediasoup-client** handlers).

#### `async worker.getUserMedia(constraints: AiortcMediaStreamConstraints)` method

Mimics the `navigator.getUserMedia()` API. It creates an `AiortcMediaStream` instance containing audio and/or video tracks. Those tracks can point to different sources such as device microphone, webcam, multimedia files or HTTP streams.

> `@async`
>
> `@returns` AiortcMediaStream

```typescript
const stream = await getUserMedia({
	audio: true,
	video: {
		source: 'file',
		file: 'file:///home/foo/media/foo.mp4',
	},
});

const audioTrack = stream.getAudioTracks()[0];
const videoTrack = stream.getVideoTracks()[0];
```

#### `async worker.createHandlerFactory()` method

Creates a **mediasoup-client** handler factory, suitable for the [handlerFactory](https://mediasoup.org/documentation/v3/mediasoup-client/api/#Device-dictionaries) argument when instantiating a mediasoup-client [Device](https://mediasoup.org/documentation/v3/mediasoup-client/api/#mediasoupClient-Device).

> `@async`
>
> `@returns` HandlerFactory

```typescript
const device = new mediasoupClient.Device({
	handlerFactory: worker.createHandlerFactory(),
});
```

Note that all Python resources (such as audio/video) used within the `Device` must be obtained from the same **mediasoup-client-aiortc** `Worker` instance.

#### `worker.on("died", fn(error: Error)` event

Emitted if the subprocess abruptly dies. This should not happen. If it happens there is a bug in the Python component.

#### `worker.on("subprocessclose", fn())` event

Emitted when the subprocess has closed completely. This event is emitted asynchronously once `worker.close()` has been called (or after 'died' event in case the worker subprocess abnormally died).

<div markdown="1" class="note">
Await for this event if you can to be sure that no Node handler is still open/running after you close a worker.
</div>

### `WorkerSettings` type

```typescript
type WorkerSettings = {
	/**
	 * Logging level for logs generated by the Python subprocess.
	 */
	logLevel?: WorkerLogLevel; // If unset it defaults to "error".
};
```

### `WorkerLogLevel` type

```typescript
type WorkerLogLevel = 'debug' | 'warn' | 'error' | 'none';
```

Logs generated by both, Node.js and Python components of this module, are printed using the mediasoup-client [debugging](https://mediasoup.org/documentation/v3/mediasoup-client/debugging/) system with "mediasoup-client-aiortc" prefix/namespace.

### `AiortcMediaStream` class

A custom implementation of the [W3C MediaStream](https://www.w3.org/TR/mediacapture-streams/#mediastream) class. An instance of `AiortcMediaStream` is generated by calling `worker.getUserMedia()`.

Audio and video tracks within an `AiortcMediaStream` are instances of [FakeMediaStreamTrack](https://github.com/ibc/fake-mediastreamtrack) and reference "native" `MediaStreamTracks` in the Python subprocess (handled by `aiortc` library).

### `AiortcMediaStreamConstraints` type

The argument given to `worker.getUserMedia()`.

```typescript
type AiortcMediaStreamConstraints = {
	audio?: AiortcMediaTrackConstraints | boolean;
	video?: AiortcMediaTrackConstraints | boolean;
};
```

Setting `audio` or `video` to `true` equals to `{source: "device"}` (so default microphone or webcam will be used to obtain the track or tracks).

### `AiortcMediaTrackConstraints` type

```typescript
type AiortcMediaTrackConstraints = {
	source: 'device' | 'file' | 'url';
	device?: string;
	file?: string;
	url?: string;
	format?: string;
	options?: object;
	timeout?: number;
	loop?: boolean;
	decode?: boolean;
};
```

#### `source`

Determines which source **aiortc** will use to generate the audio or video track. These are the possible values:

- "device": System microphone or webcam.
- "file": Path to a multimedia file in the system.
- "url": URL of an HTTP stream.

#### `device`

If `source` is "device" and this field is given, it specifies the device ID of the microphone or webcam to use. If unset, the default one in the system will be used.

- Default values for `Darwin` platform:
  - "none:0" for audio.
  - "default:none" for video.
- Default values for `Linux` platform:
  - "hw:0" for audio.
  - "/dev/video0" for video.

#### `file`

Mandatory if `source` is "file". Must be the absolute path to a multimedia file.

#### `url`

Mandatory if `source` is "url". Must be the URL of an HTTP stream.

#### `format`

Specifies the device format used by `ffmpeg`.

- Default values for `Darwin` platform:

  - "avfoundation" for audio.
  - "avfoundation" for video.

- Default values for `Linux` platform:
  - "alsa" for audio.
  - "v4f2" for video.

#### `options`

Specifies the device options used by `ffmpeg`.

- Default values for `Darwin` platform:

  - `{}` for audio.
  - `{ framerate: "30", video_size: "640x480" }` for video.

- Default values for `Linux` platform:
  - `{}` for audio.
  - `{ framerate: "30", video_size: "640x480" }` for video.

#### `timeout`, `loop` and `decode`

See [documentation](https://aiortc.readthedocs.io/en/latest/helpers.html#media-sources) in **aiortc** site (`decode` option is not documented but you can figure it out by reading usage [examples](https://github.com/aiortc/aiortc/blob/main/examples/webcam/README.rst)).

## Other considerations

### DataChannel

**mediasoup-client-aiortc** supports sending/receiving string and binary DataChannel messages. However, due to the lack of `Blob` support in Node.js, `dataChannel.binaryType` is always "arraybuffer" so received binary messages are always `ArrayBuffer` instances.

When sending, `dataChannel.send()` (and hence `dataProducer.send()`) allows passing a string, a `Buffer` instance or an `ArrayBuffer` instance.

## Development

### Lint

```bash
npm run lint
```

### Test

```bash
npm run test
```

### Check release

```bash
npm run release:check
```

### Make Python log to stdout/stderr while running tests

```bash
PYTHON_LOG_TO_STDOUT=true npm run test
```

## Caveats

See the list of [open issues](https://github.com/versatica/mediasoup-client-aiortc/issues).

## Authors

- José Luis Millán [[github](https://github.com/jmillan/)]
- Iñaki Baz Castillo [[website](https://inakibaz.me)|[github](https://github.com/ibc/)]

## License

[ISC](./LICENSE)

[npm-shield-mediasoup-client-aiortc]: https://img.shields.io/npm/v/mediasoup-client-aiortc.svg
[npm-mediasoup-client-aiortc]: https://npmjs.org/package/mediasoup-client-aiortc
[github-actions-shield-mediasoup-client-aiortc]: https://github.com/versatica/mediasoup-client-aiortc/actions/workflows/mediasoup-client-aiortc.yaml/badge.svg
[github-actions-mediasoup-client-aiortc]: https://github.com/versatica/mediasoup-client-aiortc/actions/workflows/mediasoup-client.yaml
[opencollective-shield-mediasoup]: https://img.shields.io/opencollective/all/mediasoup.svg
[opencollective-mediasoup]: https://opencollective.com/mediasoup/
