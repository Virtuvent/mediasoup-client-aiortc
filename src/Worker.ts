import uuidv4 from 'uuid/v4';
import * as path from 'path';
import { spawn, ChildProcess } from 'child_process';
import { Logger } from 'mediasoup-client/lib/Logger';
import { EnhancedEventEmitter } from 'mediasoup-client/lib/EnhancedEventEmitter';
import { HandlerFactory } from 'mediasoup-client/lib/handlers/HandlerInterface';
import { Channel } from './Channel';
import { Handler } from './Handler';

// Whether the Python subprocess should log via PIPE to Node.js or directly to
// stdout and stderr.
const PYTHON_LOG_VIA_PIPE = process.env.PYTHON_LOG_TO_STDOUT !== 'true';

const logger = new Logger('aiortc:Worker');

export type WorkerSettings =
{
	/**
	 * Logging level for logs generated by the worker.
	 */
	logLevel?: WorkerLogLevel;
}

export type WorkerLogLevel = 'debug' | 'warn' | 'error' | 'none';

export class Worker extends EnhancedEventEmitter
{
	// Python worker child process.
	private _child?: ChildProcess;
	// Worker process PID.
	private readonly _pid: number;
	// Channel instance.
	private readonly _channel: Channel;
	// Closed flag.
	private _closed = false;
	// Handlers set.
	private readonly _handlers: Set<Handler> = new Set();

	/**
	 * @private
	 * @emits died - (error: Error)
	 * @emits @success
	 * @emits @failure - (error: Error)
	 */
	constructor({ logLevel }: WorkerSettings)
	{
		super();

		logger.debug('constructor() [logLevel:%o]', logLevel);

		const spawnBin = process.env.PYTHON3 || 'python3';
		const spawnArgs: string[] = [];

		spawnArgs.push('-u'); // Unbuffered stdio.

		spawnArgs.push(path.join(__dirname, '..', 'worker', 'worker.py'));

		if (logLevel)
			spawnArgs.push(`--logLevel=${logLevel}`);

		logger.debug(
			'spawning worker process: %s %s', spawnBin, spawnArgs.join(' '));

		this._child = spawn(
			// command
			spawnBin,
			// args
			spawnArgs,
			// options
			{
				detached : false,
				// fd 0 (stdin)   : Just ignore it.
				// fd 1 (stdout)  : Pipe it for 3rd libraries that log their own stuff.
				// fd 2 (stderr)  : Same as stdout.
				// fd 3 (channel) : Producer Channel fd.
				// fd 4 (channel) : Consumer Channel fd.
				stdio    :
				[
					'ignore',
					PYTHON_LOG_VIA_PIPE ? 'pipe' : 'inherit',
					PYTHON_LOG_VIA_PIPE ? 'pipe' : 'inherit',
					'pipe',
					'pipe'
				]
			});

		this._pid = this._child.pid;

		this._channel = new Channel(
			{
				sendSocket : this._child.stdio[3],
				recvSocket : this._child.stdio[4],
				pid        : this._pid
			});

		let spawnDone = false;

		// Listen for 'running' notification.
		this._channel.once(String(this._pid), (event: string) =>
		{
			if (!spawnDone && event === 'running')
			{
				spawnDone = true;

				logger.debug('worker process running [pid:%s]', this._pid);

				this.emit('@success');
			}
		});

		this._child.on('exit', (code, signal) =>
		{
			this._child = undefined;
			this.close();

			if (!spawnDone)
			{
				spawnDone = true;

				if (code === 42)
				{
					logger.error(
						'worker process failed due to wrong settings [pid:%s]', this._pid);

					this.emit('@failure', new TypeError('wrong settings'));
				}
				else
				{
					logger.error(
						'worker process failed unexpectedly [pid:%s, code:%s, signal:%s]',
						this._pid, code, signal);

					this.emit(
						'@failure',
						new Error(`[pid:${this._pid}, code:${code}, signal:${signal}]`));
				}
			}
			else
			{
				logger.error(
					'worker process died unexpectedly [pid:%s, code:%s, signal:%s]',
					this._pid, code, signal);

				this.safeEmit(
					'died',
					new Error(`[pid:${this._pid}, code:${code}, signal:${signal}]`));
			}
		});

		this._child.on('error', (error) =>
		{
			this._child = undefined;
			this.close();

			if (!spawnDone)
			{
				spawnDone = true;

				logger.error(
					'worker process failed [pid:%s]: %s', this._pid, error.message);

				this.emit('@failure', error);
			}
			else
			{
				logger.error(
					'worker process error [pid:%s]: %s', this._pid, error.message);

				this.safeEmit('died', error);
			}
		});

		if (PYTHON_LOG_VIA_PIPE)
		{
			// Be ready for 3rd party worker libraries logging to stdout.
			this._child.stdout.on('data', (buffer) =>
			{
				for (const line of buffer.toString('utf8').split('\n'))
				{
					if (line)
						logger.debug(`(stdout) ${line}`);
				}
			});

			// In case of a worker bug, mediasoup will log to stderr.
			this._child.stderr.on('data', (buffer) =>
			{
				for (const line of buffer.toString('utf8').split('\n'))
				{
					if (line)
						logger.error(`(stderr) ${line}`);
				}
			});
		}
	}

	/**
	 * Worker process identifier (PID).
	 */
	get pid(): number
	{
		return this._pid;
	}

	/**
	 * Whether the Worker is closed.
	 */
	get closed(): boolean
	{
		return this._closed;
	}

	/**
	 * Channel instance. Required by the media module.
	 */
	get channel(): Channel
	{
		return this._channel;
	}

	/**
	 * Close the Worker.
	 */
	close(): void
	{
		logger.debug('close()');

		if (this._closed)
			return;

		this._closed = true;

		// Kill the worker process.
		if (this._child)
		{
			// Remove event listeners but leave a fake 'error' hander to avoid
			// propagation.
			if (PYTHON_LOG_VIA_PIPE)
			{
				this._child.stdout.removeAllListeners();
				this._child.stderr.removeAllListeners();
			}
			this._child.removeAllListeners('exit');
			this._child.removeAllListeners('error');
			// eslint-disable-next-line @typescript-eslint/no-empty-function
			this._child.on('error', () => {});
			this._child = undefined;
		}

		// Close the Channel instance.
		this._channel.close();

		// Close every Handler.
		for (const handler of this._handlers)
		{
			handler.close();
		}
		this._handlers.clear();
	}

	/**
	 * Create a mediasoup-client HandlerFactory.
	 */
	createHandlerFactory(): HandlerFactory
	{
		logger.debug('createHandlerFactory()');

		return (): Handler =>
		{
			const internal = { handlerId: uuidv4() };
			const handler = new Handler(
				{
					internal,
					channel : this._channel,
					onClose : (): boolean => this._handlers.delete(handler as Handler)
				});

			this._handlers.add(handler);

			return handler;
		};
	}
}
