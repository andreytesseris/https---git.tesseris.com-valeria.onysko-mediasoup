var express = require('express');
const path = require('path');
const config = require('./config');
const mediasoup = require("mediasoup");
var http = require('http');
const Process = require("child_process");
const FFmpegStatic = require("ffmpeg-static");

const io = require('socket.io');
//var app = express();

// Globals
let worker;
let webServer;
let socketServer;
let app;
let producer;
let consumer;
let producerTransport;
let consumerTransport;
let mediasoupRouter;
let rtp = {
  audioTransport: null,
  audioConsumer: null,
  videoTransport: null,
  videoConsumer: null,
}
let recordingProcess;


let recordingPorts = [
  {
    audioPort: 5004,
    audioPortRtcp: 5005,
    videoPort: 5006,
    videoPortRtcp: 5007,
    isFree: true
  },
  {
    audioPort: 5010,
    audioPortRtcp: 5011,
    videoPort: 5012,
    videoPortRtcp: 5013,
    isFree: true
  },
]
let users = [];

exports.run = async () => {
  try {
    await runExpressApp();
    await runWebServer();
    await runSocketServer();
    await runMediasoupWorker();
  } catch (err) {
    console.error(err);
  }
}

// (async () => {
//     try {
//       await runExpressApp();
//       await runWebServer();
//       await runSocketServer();
//       await runMediasoupWorker();
//     } catch (err) {
//       console.error(err);
//     }
//   })();


async function runExpressApp() {
  app = express();
  app.use(express.json());
  app.use(express.static(__dirname + '/../public/'));

  app.get('/', function (req, res) {
    res.sendFile(path.join(__dirname, '/../public/index.html'));
  });

  app.use((error, req, res, next) => {
    if (error) {
      console.warn('Express app error,', error.message);

      error.status = error.status || (error.name === 'TypeError' ? 400 : 500);

      res.statusMessage = error.message;
      res.status(error.status).send(String(error));
    } else {
      next();
    }
  });
}

async function runWebServer() {
  webServer = http.createServer(app);
  webServer.on('error', (err) => {
    console.error('starting web server failed:', err.message);
  });

  await new Promise((resolve) => {
    const { listenIp, listenPort } = config;
    webServer.listen(listenPort, listenIp, () => {
      const listenIps = config.mediasoup.webRtcTransport.listenIps[0];
      const ip = listenIps.announcedIp || listenIps.ip;
      console.log('server is running');
      console.log(`open https://${ip}:${listenPort} in your web browser`);
      resolve();
    });
  });
}

async function runSocketServer() {
  socketServer = io(webServer, {
    serveClient: false,
    path: '/server',
    log: false,
  });

  socketServer.on('connection', (socket) => {

    console.log('client connected');

    users.push({ socket: socket, rtp: {} });

    // inform the client about existence of producer
    if (producer) {
      socket.emit('newProducer');
    }

    socket.on('disconnect', () => {
      users = users.filter(x => x.socket.id != socket.id)
      console.log('client disconnected');
      console.log(users);
    });

    socket.on('connect_error', (err) => {
      console.error('client connection error', err);
    });

    socket.on('getRouterRtpCapabilities', (data, callback) => {
      callback(mediasoupRouter.rtpCapabilities);
    });

    socket.on('createProducerTransport', async (data, callback) => {
      try {
        const { transport, params } = await createWebRtcTransport();

        users[users.findIndex((x) => x.socket.id === socket.id)].producerTransport = transport;

        callback(params);
      } catch (err) {
        console.error(err);
        callback({ error: err.message });
      }
    });

    socket.on('createConsumerTransport', async (data, callback) => {
      try {
        const { transport, params } = await createWebRtcTransport();
        var otherUser = users.find(x => x.socket.id !== socket.id);
        otherUser.consumerTransport = transport;
        callback(params);
      } catch (err) {
        console.error(err);
        callback({ error: err.message });
      }
    });

    socket.on('connectProducerTransport', async (data, callback) => {
      await users[users.findIndex((x) => x.socket.id === socket.id)].producerTransport.connect({ dtlsParameters: data.dtlsParameters });
      callback();
    });

    socket.on('connectConsumerTransport', async (data, callback) => {
      var otherUser = users.find(x => x.socket.id !== socket.id);
      await otherUser.consumerTransport.connect({ dtlsParameters: data.dtlsParameters });
      callback();
    });

    socket.on('produce', async (data, callback) => {
      const { kind, rtpParameters } = data;
      const userIndex = users.findIndex((x) => x.socket.id === socket.id);
      const producer = await users[userIndex].producerTransport.produce({ kind, rtpParameters });
      users[userIndex].producer = p;
      callback({ id: producer.id });

      // inform clients about new producer
      socket.broadcast.emit('newProducer');
    });

    socket.on('consume', async (data, callback) => {
      // find another user
      try {
        var otherUser = users.find(x => x.socket.id !== socket.id);
        if (otherUser) {
          callback(await createConsumer(otherUser.producer, data.rtpCapabilities, otherUser));
        }
      }
      catch (e) {
        console.log(e);
      }
    });

    socket.on('resume', async (data, callback) => {
      await consumer.resume();
      callback();
    });

    socket.on('startRecording', async (data) => {
      const currentUser = users.find(x => x.socket.id == socket.id);
      await startRtpTransport(currentUser);
    });
  });
}

async function runMediasoupWorker() {
  worker = await mediasoup.createWorker({
    logLevel: config.mediasoup.worker.logLevel,
    logTags: config.mediasoup.worker.logTags,
    rtcMinPort: config.mediasoup.worker.rtcMinPort,
    rtcMaxPort: config.mediasoup.worker.rtcMaxPort,
  });

  worker.on('died', () => {
    console.error('mediasoup worker died, exiting in 2 seconds... [pid:%d]', worker.pid);
    setTimeout(() => process.exit(1), 2000);
  });

  const mediaCodecs = config.mediasoup.router.mediaCodecs;
  mediasoupRouter = await worker.createRouter({ mediaCodecs });
}

async function createWebRtcTransport() {
  const {
    maxIncomingBitrate,
    initialAvailableOutgoingBitrate
  } = config.mediasoup.webRtcTransport;

  const transport = await mediasoupRouter.createWebRtcTransport({
    listenIps: config.mediasoup.webRtcTransport.listenIps,
    enableUdp: true,
    enableTcp: true,
    preferUdp: true,
    initialAvailableOutgoingBitrate,
  });
  if (maxIncomingBitrate) {
    try {
      await transport.setMaxIncomingBitrate(maxIncomingBitrate);
    } catch (error) {
    }
  }
  return {
    transport,
    params: {
      id: transport.id,
      iceParameters: transport.iceParameters,
      iceCandidates: transport.iceCandidates,
      dtlsParameters: transport.dtlsParameters
    },
  };
}

async function createConsumer(producer, rtpCapabilities, consumerUser) {
  if (!mediasoupRouter.canConsume(
    {
      producerId: producer.id,
      rtpCapabilities,
    })
  ) {
    console.error('can not consume');
    return;
  }
  try {
    consumer = await consumerUser.consumerTransport.consume({
      producerId: producer.id,
      rtpCapabilities,
      paused: producer.kind === 'video',
    });
  } catch (error) {
    console.error('consume failed', error);
    return;
  }

  if (consumer.type === 'simulcast') {
    await consumer.setPreferredLayers({ spatialLayer: 2, temporalLayer: 2 });
  }

  return {
    producerId: producer.id,
    id: consumer.id,
    kind: consumer.kind,
    rtpParameters: consumer.rtpParameters,
    type: consumer.type,
    producerPaused: consumer.producerPaused
  };
}

async function startRtpTransport(user) {
  const recordingPort = recordingPorts.find(x => x.isFree);
  if (!recordingPort) {
    return;
  }
  recordingPort.isFree = false;

  await consumeVideoRtp(user, recordingPort, mediasoupRouter);

  // resume consume video
  const consumer = user.rtp.videoConsumer;
  console.log(
    "Resume mediasoup RTP consumer, kind: %s, type: %s",
    consumer.kind,
    consumer.type
  );
  consumer.resume();
}

async function consumeVideoRtp(user, recordingPort, router) {

  const rtpTransport = await router.createPlainTransport({
    // No RTP will be received from the remote side
    comedia: false,

    // FFmpeg and GStreamer don't support RTP/RTCP multiplexing ("a=rtcp-mux" in SDP)
    rtcpMux: false,

    ...config.mediasoup.plainTransport,
  });
  user.rtp.videoTransport = rtpTransport;


  await rtpTransport.connect({
    ip: config.mediasoup.recording.ip,
    port: recordingPort.videoPort,
    rtcpPort: recordingPort.videoPortRtcp,
  });

  console.log(
    "mediasoup VIDEO RTP SEND transport connected: %s:%d <--> %s:%d (%s)",
    rtpTransport.tuple.localIp,
    rtpTransport.tuple.localPort,
    rtpTransport.tuple.remoteIp,
    rtpTransport.tuple.remotePort,
    rtpTransport.tuple.protocol
  );

  console.log(
    "mediasoup VIDEO RTCP SEND transport connected: %s:%d <--> %s:%d (%s)",
    rtpTransport.rtcpTuple.localIp,
    rtpTransport.rtcpTuple.localPort,
    rtpTransport.rtcpTuple.remoteIp,
    rtpTransport.rtcpTuple.remotePort,
    rtpTransport.rtcpTuple.protocol
  );

  const rtpConsumer = await rtpTransport.consume({
    producerId: user.producer.id,
    rtpCapabilities: router.rtpCapabilities, // Assume the recorder supports same formats as mediasoup's router
    paused: true,
  });
  user.rtp.videoConsumer = rtpConsumer;


  console.log(
    "mediasoup VIDEO RTP SEND consumer created, kind: %s, type: %s, paused: %s, SSRC: %s CNAME: %s",
    rtpConsumer.kind,
    rtpConsumer.type,
    rtpConsumer.paused,
    rtpConsumer.rtpParameters.encodings[0].ssrc,
    rtpConsumer.rtpParameters.rtcp.cname
  );

  const consumer = user.rtp.videoConsumer;
  console.log(
    "Resume mediasoup RTP consumer, kind: %s, type: %s",
    consumer.kind,
    consumer.type
  );
  consumer.resume();
}

//ffplay -protocol_whitelist file,rtp,udp -fflags +genpts -i input-vp8.sdp