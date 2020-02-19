import asyncio
import json
import socket
import pynetstring
from asyncio import StreamReader, StreamWriter
from typing import Any, Dict, Optional, Union
from logger import debugLogger, errorLogger


def object_from_string(message_str) -> Optional[Dict[str, Any]]:
    message = json.loads(message_str)
    if "method" in message:
        if "id" in message:
            return message
        else:
            errorLogger.error(
                "invalid messsage, missing 'method' and 'event' fields")
            return None

    elif "event" in message:
        return message

    else:
        errorLogger.error(
            "invalid messsage, missing 'method' and 'event' fields")
        return None

"""
Channel class
"""
class Channel:
    def __init__(self, loop, readfd, writefd) -> None:
        self._loop = loop
        self._readfd = readfd
        self._writefd = writefd
        self._reader = Union[StreamReader, None]
        self._writer = Union[StreamWriter, None]
        self._nsDecoder = pynetstring.Decoder()
        self._connected = False

    async def _connect(self) -> None:
        if (self._connected):
            return

        """
        Create the sender and receivers
        """
        rsock = socket.socket(
            socket.AF_UNIX, socket.SOCK_STREAM, 0, self._readfd)
        self._reader, writer = await asyncio.open_connection(sock=rsock, loop=self._loop)

        wsock = socket.socket(
            socket.AF_UNIX, socket.SOCK_STREAM, 0, self._writefd)
        reader, self._writer = await asyncio.open_connection(sock=wsock, loop=self._loop)

        self._connected = True

    def close(self) -> None:
        if self._writer is not None:
            self._writer.close()
            self._reader = None
            self._writer = None

    # TODO: receive() should return a Request or Notification instance instead of
    # a dictionary
    async def receive(self) -> Optional[Dict[str, Any]]:
        await self._connect()

        try:
            # retrieve chunks of 50 bytes
            data = await self._reader.read(50)
            if len(data) == 0:
                debugLogger.debug("channel socket closed, exiting")
                raise Exception("socket closed")

            decoded_list = self._nsDecoder.feed(data)
            for item in decoded_list:
                return object_from_string(item.decode("utf8"))

        except asyncio.IncompleteReadError:
            pass

        return None

    async def send(self, descr) -> None:
        await self._connect()

        data = descr.encode("utf8")
        data = pynetstring.encode(data)

        self._writer.write(data)

    # TODO: notify() should receive a Notification instance
    async def notify(self, targetId: str, event: str, data=None):
        if data:
            await self.send(json.dumps({"targetId": targetId, "event": event, "data": data}))
        else:
            await self.send(json.dumps({"targetId": targetId, "event": event}))

"""
Request class
"""
class Request:
    def __init__(self, id: str, method: str, internal=None, data=None) -> None:
        self._id = id
        self.method = method
        self.internal = internal
        self.data = data

    # TODO: This should be given in the constructor but I don't know how to deal
    # with it given that the constructor is called with **obj as single argument
    def setChannel(self, channel: Channel):
        self._channel = channel;

    async def succeed(self, data=None) -> None:
        if data:
            await self._channel.send(json.dumps({
                "id": self._id,
                "accepted": True,
                "data": data
            }, sort_keys=True))
        else:
            await self._channel.send(json.dumps({
                "id": self._id,
                "accepted": True
            }, sort_keys=True))

    async def failed(self, error) -> None:
        errorType = "Error"
        if isinstance(error, TypeError):
            errorType = "TypeError"

        await self._channel.send(json.dumps({
            "id": self._id,
            "error": errorType,
            "reason": str(error)
        }, sort_keys=True))

"""
Notification class
"""
class Notification:
    def __init__(self, event: str, internal=None, data=None) -> None:
        self.event = event
        self.internal = internal
        self.data = data
