module.exports = {
  listenIp: '0.0.0.0',
  listenPort: 1470,
  sslCrt: '/etc/ssl/certs/ssl-cert-snakeoil.pem',
  sslKey: '/etc/ssl/private/ssl-cert-snakeoil.key',
  mediasoup: {
    // Worker settings
    worker: {
      rtcMinPort: 10000,
      rtcMaxPort: 10100,
      logLevel: 'warn',
      logTags: [
        'info',
        'ice',
        'dtls',
        'rtp',
        'srtp',
        'rtcp',
        // 'rtx',
        // 'bwe',
        // 'score',
        // 'simulcast',
        // 'svc'
      ],
    },
    // Router settings
    router: {
      mediaCodecs:
        [
          {
            kind: "audio",
            mimeType: "audio/opus",
            preferredPayloadType: 111,
            clockRate: 48000,
            channels: 2,
            parameters: {
              minptime: 10,
              useinbandfec: 1,
            },
          },
          {
            kind: "video",
            mimeType: "video/VP8",
            preferredPayloadType: 96,
            clockRate: 90000,
          },
          {
            kind: "video",
            mimeType: "video/H264",
            preferredPayloadType: 125,
            clockRate: 90000,
            parameters: {
              "level-asymmetry-allowed": 1,
              "packetization-mode": 1,
              "profile-level-id": "42e01f",
            },
          },
        ]
    },

    recording: {
      ip: "127.0.0.1",

      // GStreamer's sdpdemux only supports RTCP = RTP + 1
     
    },

    // WebRtcTransport settings
    webRtcTransport: {
      listenIps: [
        {
          ip: '127.0.0.1',
          announcedIp: null,
        }
      ],
      maxIncomingBitrate: 1500000,
      initialAvailableOutgoingBitrate: 1000000,
    },

    plainTransport: {
      listenIp: { ip: "127.0.0.1", announcedIp: null },
    },
  }
};
