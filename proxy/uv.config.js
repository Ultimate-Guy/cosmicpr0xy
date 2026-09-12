/* global Ultraviolet */
// Served at /uv/uv.config.js, ahead of the copy bundled with the package, so
// the prefix and asset paths match how server/index.js mounts things.
self.__uv$config = {
    prefix: '/service/uv/',
    encodeUrl: Ultraviolet.codec.xor.encode,
    decodeUrl: Ultraviolet.codec.xor.decode,
    handler: '/uv/uv.handler.js',
    client: '/uv/uv.client.js',
    bundle: '/uv/uv.bundle.js',
    config: '/uv/uv.config.js',
    sw: '/uv/uv.sw.js',
};
